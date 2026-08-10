"""Rotas da Biblioteca: acervo de referência da área.

Três classificações, fixas porque correspondem a fontes distintas de autoridade:
estoque normativo (o que a norma manda), pareceres da Consultoria Jurídica (como
a CJ leu a norma) e notas técnicas (posição técnica da área).

O conteúdo de cada item pode ser link, PDF anexado, texto digitado — ou a
combinação deles. A regra é só uma: não aceitar registro vazio de conteúdo, para
o acervo não virar lista de títulos sem lastro.

O cadastro (``POST``) é multipart, para o PDF entrar junto dos demais campos; a
edição de campos é JSON (``PUT``) e o PDF de um item já existente tem endpoint
próprio (``POST``/``DELETE`` em ``/{id}/arquivo``).
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, undefer

from app.api.deps import get_db
from app.core.security import PERFIL_COORDENADOR, UsuarioAutenticado, get_current_user
from app.db import models as m

router = APIRouter(prefix="/biblioteca", tags=["Biblioteca"])

#: Classificações aceitas, com o rótulo que a tela mostra.
CLASSIFICACOES: dict[str, str] = {
    "estoque_normativo": "Estoque normativo",
    "parecer_cj": "Pareceres da Consultoria Jurídica",
    "nota_tecnica": "Notas técnicas",
    "decisao_administrativa": "Decisões Administrativas",
}

#: Teto do PDF anexado. Mesmo limite do upload de medida cautelar.
TAMANHO_MAXIMO_ARQUIVO = 10 * 1024 * 1024

MIMES_PDF = {"application/pdf", "application/x-pdf", "application/acrobat"}


# ==============================================================================
# Schemas
# ==============================================================================


class BibliotecaTextoIn(BaseModel):
    """Edição de um item do acervo (o cadastro é multipart, por causa do PDF).

    Sem validadores no schema: as regras de título, link e classificação valem
    igual para o cadastro (multipart) e para a edição (JSON), então moram em
    ``_validar_campos``, e não em metade dos caminhos.
    """

    classificacao: str
    titulo: str
    tema: str | None = None
    data_referencia: date | None = None
    link: str | None = None
    texto: str | None = None


class BibliotecaTextoResumo(BaseModel):
    """Item na listagem: sem o texto e sem os bytes do PDF."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    classificacao: str
    classificacao_label: str
    titulo: str
    tema: str | None = None
    data_referencia: date | None = None
    link: str | None = None
    arquivo_nome: str | None = None
    arquivo_tamanho: int | None = None
    tem_texto: bool
    tem_arquivo: bool
    autor: str | None = None
    versao_atual: int = 1
    criado_em: datetime | None = None
    atualizado_em: datetime | None = None


class BibliotecaTextoDetalhe(BibliotecaTextoResumo):
    """Item aberto na tela: inclui o texto."""

    texto: str | None = None


class BibliotecaVersaoOut(BaseModel):
    """Uma versão no histórico de edições."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    numero: int
    autor: str | None = None
    criado_em: datetime | None = None
    titulo: str | None = None
    classificacao: str | None = None
    tema: str | None = None
    data_referencia: date | None = None
    link: str | None = None
    texto: str | None = None


# ==============================================================================
# Helpers
# ==============================================================================


def _validar_campos(
    classificacao: str,
    titulo: str,
    tema: str | None,
    link: str | None,
    texto: str | None,
) -> dict[str, str | None]:
    """Valida e normaliza os campos de texto, para cadastro e edição.

    Campo em branco no formulário é ausência de valor, não string vazia — se
    fosse gravado como "", os filtros e o ``tem_texto`` da listagem passariam a
    mentir.
    """
    if classificacao not in CLASSIFICACOES:
        raise HTTPException(
            400,
            f"Classificação inválida. Use uma destas: {', '.join(CLASSIFICACOES)}.",
        )

    titulo_limpo = (titulo or "").strip()
    if not titulo_limpo:
        raise HTTPException(400, "Informe o título.")

    link_limpo = (link or "").strip() or None
    if link_limpo and not link_limpo.startswith(("http://", "https://")):
        raise HTTPException(400, "O link deve começar com http:// ou https://.")

    return {
        "classificacao": classificacao,
        "titulo": titulo_limpo,
        "tema": (tema or "").strip() or None,
        "link": link_limpo,
        "texto": (texto or "").strip() or None,
    }


def _buscar(db: Session, texto_id: int, com_texto: bool = False) -> m.BibliotecaTexto:
    stmt = select(m.BibliotecaTexto).where(m.BibliotecaTexto.id == texto_id)
    if com_texto:
        stmt = stmt.options(undefer(m.BibliotecaTexto.texto))
    registro = db.scalars(stmt).first()
    if not registro:
        raise HTTPException(404, "Item da biblioteca não encontrado.")
    return registro


def _resumo(registro: m.BibliotecaTexto, texto: str | None = None) -> dict:
    """Monta os campos derivados que o modelo não guarda.

    ``texto=None`` na listagem: quem chama informa ``tem_texto`` por fora, sem
    tocar na coluna deferred.
    """
    return {
        "id": registro.id,
        "classificacao": registro.classificacao,
        "classificacao_label": CLASSIFICACOES.get(
            registro.classificacao, registro.classificacao,
        ),
        "titulo": registro.titulo,
        "tema": registro.tema,
        "data_referencia": registro.data_referencia,
        "link": registro.link,
        "arquivo_nome": registro.arquivo_nome,
        "arquivo_tamanho": registro.arquivo_tamanho,
        "tem_texto": bool(texto),
        "tem_arquivo": bool(registro.arquivo_nome),
        "autor": registro.autor,
        "versao_atual": registro.versao_atual or 1,
        "criado_em": registro.criado_em,
        "atualizado_em": registro.atualizado_em,
    }


async def _ler_pdf(arquivo: UploadFile) -> tuple[str, bytes]:
    """Lê e confere o PDF enviado. Devolve (nome, conteúdo)."""
    nome = (arquivo.filename or "").strip() or "documento.pdf"
    tipo = (arquivo.content_type or "").split(";")[0].strip().lower()
    if tipo not in MIMES_PDF and not nome.lower().endswith(".pdf"):
        raise HTTPException(400, "Anexe um arquivo PDF.")

    conteudo = await arquivo.read()
    if not conteudo:
        raise HTTPException(400, "Arquivo vazio.")
    if len(conteudo) > TAMANHO_MAXIMO_ARQUIVO:
        raise HTTPException(400, "Arquivo excede o limite de 10 MB.")
    # Extensão e content-type são só a promessa de quem envia: um HTML salvo
    # como .pdf não abriria no visualizador da tela.
    if not conteudo.lstrip()[:5].startswith(b"%PDF-"):
        raise HTTPException(400, "O arquivo não parece ser um PDF válido.")

    return nome, conteudo


def _pode_excluir(registro: m.BibliotecaTexto, usuario: UsuarioAutenticado) -> bool:
    """Autor ou coordenação. O acervo é compartilhado, mas apagar é definitivo."""
    if PERFIL_COORDENADOR in [p.lower() for p in usuario.roles]:
        return True
    nome = usuario.nome or usuario.email
    return bool(nome and registro.autor == nome)


# ==============================================================================
# Rotas
# ==============================================================================


@router.get("/classificacoes")
def listar_classificacoes(
    _usuario: UsuarioAutenticado = Depends(get_current_user),
) -> list[dict]:
    """Classificações aceitas, na ordem em que a tela mostra."""
    return [{"valor": valor, "label": label} for valor, label in CLASSIFICACOES.items()]


@router.get("/temas")
def listar_temas(
    classificacao: str | None = Query(None),
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
) -> list[str]:
    """Temas já usados, para o filtro e para o autocompletar do cadastro."""
    stmt = select(m.BibliotecaTexto.tema).where(m.BibliotecaTexto.tema.is_not(None))
    if classificacao:
        stmt = stmt.where(m.BibliotecaTexto.classificacao == classificacao)
    temas = {t.strip() for t in db.scalars(stmt.distinct()).all() if t and t.strip()}
    return sorted(temas, key=str.casefold)


@router.get("", response_model=list[BibliotecaTextoResumo])
def listar(
    classificacao: str | None = Query(None, description="Filtra por classificação"),
    tema: str | None = Query(None, description="Filtra por tema (exato)"),
    busca: str | None = Query(None, description="Busca em título, tema e texto"),
    limit: int = Query(200, le=500),
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista o acervo, do documento mais recente para o mais antigo.

    Ordena por ``data_referencia`` (a data do documento) e usa a data de cadastro
    só como desempate — quem procura referência quer a mais nova sobre o tema.
    Itens sem data ficam no fim.
    """
    stmt = select(m.BibliotecaTexto)

    if classificacao:
        if classificacao not in CLASSIFICACOES:
            raise HTTPException(400, "Classificação inválida.")
        stmt = stmt.where(m.BibliotecaTexto.classificacao == classificacao)

    if tema:
        stmt = stmt.where(m.BibliotecaTexto.tema == tema.strip())

    if busca and busca.strip():
        termo = f"%{busca.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(m.BibliotecaTexto.titulo).like(termo),
                func.lower(m.BibliotecaTexto.tema).like(termo),
                func.lower(m.BibliotecaTexto.texto).like(termo),
                func.lower(m.BibliotecaTexto.arquivo_nome).like(termo),
            )
        )

    stmt = stmt.order_by(
        m.BibliotecaTexto.data_referencia.is_(None),
        m.BibliotecaTexto.data_referencia.desc(),
        m.BibliotecaTexto.criado_em.desc(),
    ).limit(limit)

    registros = db.scalars(stmt).all()

    # `texto` é deferred: ler o atributo item por item só para saber se existe
    # conteúdo dispararia uma consulta por linha, cada uma trazendo o texto
    # inteiro. Uma consulta só resolve os indicadores da lista.
    com_texto: set[int] = set()
    if registros:
        com_texto = set(
            db.scalars(
                select(m.BibliotecaTexto.id).where(
                    m.BibliotecaTexto.id.in_([r.id for r in registros]),
                    m.BibliotecaTexto.texto.is_not(None),
                    m.BibliotecaTexto.texto != "",
                )
            ).all()
        )

    return [
        {**_resumo(r, texto=None), "tem_texto": r.id in com_texto} for r in registros
    ]


@router.get("/{texto_id}", response_model=BibliotecaTextoDetalhe)
def obter(
    texto_id: int,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Item completo, com o texto."""
    registro = _buscar(db, texto_id, com_texto=True)
    return {**_resumo(registro, registro.texto), "texto": registro.texto}


@router.post("", response_model=BibliotecaTextoDetalhe, status_code=201)
async def criar(
    classificacao: str = Form(..., description="estoque_normativo | parecer_cj | nota_tecnica"),
    titulo: str = Form(...),
    tema: str | None = Form(None),
    data_referencia: date | None = Form(None, description="Data do documento (AAAA-MM-DD)"),
    link: str | None = Form(None),
    texto: str | None = Form(None),
    arquivo: UploadFile | None = File(None, description="PDF, até 10 MB"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Cadastra um item do acervo com link, texto e/ou PDF.

    É **multipart**, não JSON, para o PDF entrar junto dos demais campos: se o
    arquivo fosse um segundo passo, um item que só tem PDF ficaria salvo sem
    conteúdo no intervalo entre as duas chamadas — e para sempre, se a segunda
    falhasse.
    """
    dados = _validar_campos(classificacao, titulo, tema, link, texto)

    nome_arquivo: str | None = None
    conteudo: bytes | None = None
    if arquivo is not None and arquivo.filename:
        nome_arquivo, conteudo = await _ler_pdf(arquivo)

    if not (dados["link"] or dados["texto"] or conteudo):
        raise HTTPException(400, "Informe ao menos um conteúdo: link, texto ou PDF.")

    registro = m.BibliotecaTexto(
        classificacao=dados["classificacao"],
        titulo=dados["titulo"],
        tema=dados["tema"],
        data_referencia=data_referencia,
        link=dados["link"],
        texto=dados["texto"],
        arquivo_nome=nome_arquivo,
        arquivo_mime="application/pdf" if conteudo else None,
        arquivo_tamanho=len(conteudo) if conteudo else None,
        arquivo_conteudo=conteudo,
        autor=usuario.nome or usuario.email,
    )
    db.add(registro)
    db.commit()
    db.refresh(registro)
    return {**_resumo(registro, dados["texto"]), "texto": dados["texto"]}


@router.put("/{texto_id}", response_model=BibliotecaTextoDetalhe)
def atualizar(
    texto_id: int,
    dados: BibliotecaTextoIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Atualiza os campos do item e cria uma versão do estado anterior."""
    registro = _buscar(db, texto_id, com_texto=True)
    campos = _validar_campos(
        dados.classificacao, dados.titulo, dados.tema, dados.link, dados.texto,
    )

    if not (campos["link"] or campos["texto"] or registro.arquivo_nome):
        raise HTTPException(
            400,
            "O item ficaria sem conteúdo. Informe link, texto ou anexe um PDF.",
        )

    # Snapshot do estado anterior como versão
    versao = m.BibliotecaVersao(
        item_id=registro.id,
        numero=registro.versao_atual or 1,
        autor=registro.autor,
        classificacao=registro.classificacao,
        titulo=registro.titulo,
        tema=registro.tema,
        data_referencia=registro.data_referencia,
        link=registro.link,
        texto=registro.texto,
    )
    db.add(versao)

    # Aplica a edição
    registro.classificacao = campos["classificacao"]
    registro.titulo = campos["titulo"]
    registro.tema = campos["tema"]
    registro.data_referencia = dados.data_referencia
    registro.link = campos["link"]
    registro.texto = campos["texto"]
    registro.versao_atual = (registro.versao_atual or 1) + 1
    registro.autor = usuario.nome or usuario.email
    db.commit()
    db.refresh(registro)
    return {**_resumo(registro, registro.texto), "texto": registro.texto}


@router.get("/{texto_id}/versoes", response_model=list[BibliotecaVersaoOut])
def listar_versoes(
    texto_id: int,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Histórico de versões do item, da mais recente para a mais antiga."""
    _buscar(db, texto_id)  # 404 se não existe
    stmt = (
        select(m.BibliotecaVersao)
        .where(m.BibliotecaVersao.item_id == texto_id)
        .order_by(m.BibliotecaVersao.numero.desc())
    )
    return db.scalars(stmt).all()


@router.post("/{texto_id}/versoes/{numero}/restaurar", response_model=BibliotecaTextoDetalhe)
def restaurar_versao(
    texto_id: int,
    numero: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Restaura o item ao estado de uma versão anterior.

    Cria uma nova versão com o estado atual antes de restaurar (para não perder
    o que estava), depois aplica os campos da versão escolhida.
    """
    registro = _buscar(db, texto_id, com_texto=True)
    versao = db.scalars(
        select(m.BibliotecaVersao).where(
            m.BibliotecaVersao.item_id == texto_id,
            m.BibliotecaVersao.numero == numero,
        )
    ).first()
    if not versao:
        raise HTTPException(404, f"Versão {numero} não encontrada.")

    # Snapshot do estado atual antes de restaurar
    snapshot = m.BibliotecaVersao(
        item_id=registro.id,
        numero=registro.versao_atual or 1,
        autor=registro.autor,
        classificacao=registro.classificacao,
        titulo=registro.titulo,
        tema=registro.tema,
        data_referencia=registro.data_referencia,
        link=registro.link,
        texto=registro.texto,
    )
    db.add(snapshot)

    # Aplica a versão escolhida
    registro.classificacao = versao.classificacao
    registro.titulo = versao.titulo
    registro.tema = versao.tema
    registro.data_referencia = versao.data_referencia
    registro.link = versao.link
    registro.texto = versao.texto
    registro.versao_atual = (registro.versao_atual or 1) + 1
    registro.autor = usuario.nome or usuario.email
    db.commit()
    db.refresh(registro)
    return {**_resumo(registro, registro.texto), "texto": registro.texto}


@router.delete("/{texto_id}", status_code=204)
def excluir(
    texto_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Exclui um item. Somente quem cadastrou ou a coordenação."""
    registro = _buscar(db, texto_id)
    if not _pode_excluir(registro, usuario):
        raise HTTPException(
            403,
            "Somente quem cadastrou o item ou a coordenação pode excluí-lo.",
        )
    db.delete(registro)
    db.commit()


# ==============================================================================
# PDF anexado
# ==============================================================================


@router.post("/{texto_id}/arquivo", response_model=BibliotecaTextoDetalhe)
async def enviar_arquivo(
    texto_id: int,
    arquivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Anexa (ou substitui) o PDF de um item já cadastrado. Máximo de 10 MB."""
    registro = _buscar(db, texto_id, com_texto=True)
    nome, conteudo = await _ler_pdf(arquivo)

    registro.arquivo_nome = nome
    registro.arquivo_mime = "application/pdf"
    registro.arquivo_tamanho = len(conteudo)
    registro.arquivo_conteudo = conteudo
    db.commit()
    db.refresh(registro)
    return {**_resumo(registro, registro.texto), "texto": registro.texto}


@router.get("/{texto_id}/arquivo")
def baixar_arquivo(
    texto_id: int,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Devolve o PDF anexado, para exibir na tela ou baixar."""
    registro = db.scalars(
        select(m.BibliotecaTexto)
        .where(m.BibliotecaTexto.id == texto_id)
        .options(undefer(m.BibliotecaTexto.arquivo_conteudo))
    ).first()
    if not registro:
        raise HTTPException(404, "Item da biblioteca não encontrado.")
    if not registro.arquivo_conteudo:
        raise HTTPException(404, "Este item não tem PDF anexado.")

    nome = registro.arquivo_nome or f"biblioteca-{texto_id}.pdf"
    return Response(
        content=registro.arquivo_conteudo,
        media_type=registro.arquivo_mime or "application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nome}"'},
    )


@router.delete("/{texto_id}/arquivo", response_model=BibliotecaTextoDetalhe)
def remover_arquivo(
    texto_id: int,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Remove o PDF anexado, desde que sobre link ou texto no item."""
    registro = _buscar(db, texto_id, com_texto=True)
    if not registro.arquivo_nome:
        raise HTTPException(404, "Este item não tem PDF anexado.")
    if _sem_conteudo_apos_remover_arquivo(registro):
        raise HTTPException(
            400,
            "O item ficaria sem conteúdo. Informe link ou texto antes de remover o PDF.",
        )

    registro.arquivo_nome = None
    registro.arquivo_mime = None
    registro.arquivo_tamanho = None
    registro.arquivo_conteudo = None
    db.commit()
    db.refresh(registro)
    return {**_resumo(registro, registro.texto), "texto": registro.texto}


def _sem_conteudo_apos_remover_arquivo(registro: m.BibliotecaTexto) -> bool:
    return not (registro.link or registro.texto)
