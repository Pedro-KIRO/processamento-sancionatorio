"""Textos-padrão: consulta e edição pelo coordenador.

Os modelos de documento vêm dos textos-padrão oficiais do SEI, importados por
``scripts/importar_textos_padroes.py``. Esta tela é onde a coordenação ajusta o
texto que o app usa e escolhe, entre as variantes de uma função, qual é o
padrão — há quatro saneadores de autoescola e nove arquivamentos de relatório de
perito, e a marca define qual vem selecionada para o analista.

Acesso restrito ao perfil de coordenação: o texto vale para o app inteiro e
termina assinado num processo administrativo. Ver ``exigir_coordenador``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, exigir_coordenador
from app.db import models as m
from app.db.models import _agora
from app.schemas.textos_padroes import (
    FuncaoResumo,
    TextoPadraoDetalhe,
    TextoPadraoResumo,
    TextoPadraoUpdate,
)
from app.services import classificacao_modelos as cm

router = APIRouter(prefix="/textos-padroes", tags=["textos-padrao"])


def _resumo(registro: m.ConfigTemplateDespacho) -> dict:
    funcao, rotulo = cm.partes_da_chave(registro.descricao_doc)
    editado = registro.editado_em is not None
    return {
        "id": registro.id,
        "agente_regulado": registro.agente_regulado,
        "funcao": funcao,
        "funcao_titulo": cm.titulo_da_funcao(funcao),
        "rotulo": rotulo or registro.descricao_doc,
        "nome_arvore": registro.nome_arvore,
        "padrao": bool(registro.padrao),
        "editado": editado,
        "editado_em": registro.editado_em,
        "editado_por": registro.editado_por,
        # Só faz sentido avisar de divergência em modelo editado: sem edição, o
        # texto em uso é o original, e a reimportação mantém os dois iguais.
        "divergente_do_original": bool(
            editado
            and registro.html_original is not None
            and registro.html_original != registro.template_html
        ),
    }


def _buscar(db: Session, texto_id: int) -> m.ConfigTemplateDespacho:
    registro = db.get(m.ConfigTemplateDespacho, texto_id)
    if registro is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Texto-padrão não encontrado.")
    return registro


@router.get("", response_model=list[TextoPadraoResumo])
def listar(
    agente: str | None = Query(None, description="Agente regulado ou 'Qualquer'."),
    funcao: str | None = Query(None, description="Função do documento."),
    busca: str | None = Query(None, description="Trecho do rótulo ou da função."),
    somente_editados: bool = Query(False),
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> list[TextoPadraoResumo]:
    """Lista os modelos, sem o HTML. Ordem: agente, função e rótulo."""
    consulta = db.query(m.ConfigTemplateDespacho)

    if agente:
        consulta = consulta.filter(m.ConfigTemplateDespacho.agente_regulado == agente)
    if funcao:
        consulta = consulta.filter(
            m.ConfigTemplateDespacho.descricao_doc.like(f"{funcao}{cm.SEPARADOR}%")
        )
    if busca:
        consulta = consulta.filter(
            m.ConfigTemplateDespacho.descricao_doc.ilike(f"%{busca.strip()}%")
        )
    if somente_editados:
        consulta = consulta.filter(m.ConfigTemplateDespacho.editado_em.is_not(None))

    registros = consulta.order_by(
        m.ConfigTemplateDespacho.agente_regulado,
        m.ConfigTemplateDespacho.descricao_doc,
    ).all()
    return [TextoPadraoResumo(**_resumo(r)) for r in registros]


@router.get("/agentes", response_model=list[str])
def listar_agentes(
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> list[str]:
    """Agentes que têm modelo, para o filtro."""
    valores = db.query(m.ConfigTemplateDespacho.agente_regulado).distinct().all()
    return sorted(v[0] for v in valores if v[0])


@router.get("/funcoes", response_model=list[FuncaoResumo])
def listar_funcoes(
    agente: str | None = Query(None),
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> list[FuncaoResumo]:
    """Funções com modelo, com a contagem de variantes."""
    consulta = db.query(m.ConfigTemplateDespacho.descricao_doc)
    if agente:
        consulta = consulta.filter(m.ConfigTemplateDespacho.agente_regulado == agente)

    contagem: dict[str, int] = {}
    for (descricao,) in consulta.all():
        funcao, _rotulo = cm.partes_da_chave(descricao)
        contagem[funcao] = contagem.get(funcao, 0) + 1

    return sorted(
        (
            FuncaoResumo(
                funcao=funcao, titulo=cm.titulo_da_funcao(funcao), quantidade=quantidade
            )
            for funcao, quantidade in contagem.items()
        ),
        key=lambda f: f.titulo,
    )


@router.get("/{texto_id}", response_model=TextoPadraoDetalhe)
def obter(
    texto_id: int,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> TextoPadraoDetalhe:
    registro = _buscar(db, texto_id)
    return TextoPadraoDetalhe(
        **_resumo(registro),
        template_html=registro.template_html,
        html_original=registro.html_original,
    )


@router.put("/{texto_id}", response_model=TextoPadraoDetalhe)
def salvar(
    texto_id: int,
    dados: TextoPadraoUpdate,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> TextoPadraoDetalhe:
    """Grava o texto editado e marca quem editou.

    A marca de edição é o que impede a reimportação de sobrescrever o ajuste na
    próxima coleta dos textos-padrão do SEI.
    """
    registro = _buscar(db, texto_id)

    # Guarda o original na primeira edição: nos registros importados antes das
    # colunas novas, ele pode estar vazio, e sem isso não há como restaurar.
    if registro.html_original is None:
        registro.html_original = registro.template_html

    registro.template_html = dados.template_html
    registro.editado_em = _agora()
    registro.editado_por = usuario.email or usuario.nome
    db.commit()
    db.refresh(registro)

    return TextoPadraoDetalhe(
        **_resumo(registro),
        template_html=registro.template_html,
        html_original=registro.html_original,
    )


@router.post("/{texto_id}/padrao", response_model=list[TextoPadraoResumo])
def definir_padrao(
    texto_id: int,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> list[TextoPadraoResumo]:
    """Fixa este modelo como padrão da função para o agente.

    A marca é exclusiva dentro de (agente, função): marcar um desmarca o
    anterior, senão a escolha ficaria ambígua e a ordenação, imprevisível.
    Devolve as variantes irmãs já atualizadas.
    """
    registro = _buscar(db, texto_id)
    funcao, _rotulo = cm.partes_da_chave(registro.descricao_doc)

    irmas = (
        db.query(m.ConfigTemplateDespacho)
        .filter(
            m.ConfigTemplateDespacho.agente_regulado == registro.agente_regulado,
            m.ConfigTemplateDespacho.descricao_doc.like(f"{funcao}{cm.SEPARADOR}%"),
        )
        .all()
    )
    for irma in irmas:
        irma.padrao = irma.id == registro.id
    db.commit()

    irmas.sort(key=lambda r: r.descricao_doc)
    return [TextoPadraoResumo(**_resumo(r)) for r in irmas]


@router.delete("/{texto_id}/padrao", response_model=TextoPadraoResumo)
def remover_padrao(
    texto_id: int,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> TextoPadraoResumo:
    """Desfaz a marca de padrão. Sem marca, vale a ordem alfabética."""
    registro = _buscar(db, texto_id)
    registro.padrao = False
    db.commit()
    db.refresh(registro)
    return TextoPadraoResumo(**_resumo(registro))


@router.put("/{texto_id}/agente", response_model=TextoPadraoResumo)
def alterar_agente(
    texto_id: int,
    novo_agente: str = Query(..., description="Novo agente regulado (ou 'Qualquer' para global)."),
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> TextoPadraoResumo:
    """Altera o agente regulado de um texto-padrão.

    Usar 'Qualquer' torna o modelo global (disponível para todos os agentes
    quando não existe versão específica).
    """
    registro = _buscar(db, texto_id)
    registro.agente_regulado = novo_agente.strip()
    db.commit()
    db.refresh(registro)
    return TextoPadraoResumo(**_resumo(registro))


@router.put("/{texto_id}/rotulo", response_model=TextoPadraoResumo)
def alterar_rotulo(
    texto_id: int,
    novo_rotulo: str = Query(..., min_length=1, description="Novo rótulo (nome legível) do modelo."),
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> TextoPadraoResumo:
    """Renomeia o rótulo do texto-padrão (a parte legível que diferencia as variantes).

    O rótulo é a porção após o separador em ``descricao_doc``. A função (papel
    no fluxo) permanece inalterada.
    """
    registro = _buscar(db, texto_id)
    funcao, _rotulo_antigo = cm.partes_da_chave(registro.descricao_doc)
    registro.descricao_doc = cm.chave(funcao, novo_rotulo.strip())
    db.commit()
    db.refresh(registro)
    return TextoPadraoResumo(**_resumo(registro))


@router.put("/{texto_id}/nome-arvore", response_model=TextoPadraoResumo)
def alterar_nome_arvore(
    texto_id: int,
    novo_nome: str = Query(..., min_length=1, description="Novo nome na árvore do SEI (tipo de documento)."),
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> TextoPadraoResumo:
    """Altera o nome que aparece na árvore do processo no SEI ao gerar o documento.

    É o campo ``nomeArvore`` enviado na inclusão de documentos via API do SEI.
    Exemplo: "Despacho Saneador", "Certidão de Decurso de Prazo".
    """
    registro = _buscar(db, texto_id)
    registro.nome_arvore = novo_nome.strip()
    db.commit()
    db.refresh(registro)
    return TextoPadraoResumo(**_resumo(registro))


@router.post("/{texto_id}/restaurar", response_model=TextoPadraoDetalhe)
def restaurar(
    texto_id: int,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> TextoPadraoDetalhe:
    """Volta ao texto como veio do SEI e limpa a marca de edição.

    Com a marca limpa, a reimportação passa a atualizar este modelo de novo.
    """
    registro = _buscar(db, texto_id)
    if not registro.html_original:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Este modelo não tem o texto original guardado, então não há o que "
            "restaurar. Rode scripts/importar_textos_padroes.py para trazer o "
            "texto do SEI.",
        )

    registro.template_html = registro.html_original
    registro.editado_em = None
    registro.editado_por = None
    db.commit()
    db.refresh(registro)

    return TextoPadraoDetalhe(
        **_resumo(registro),
        template_html=registro.template_html,
        html_original=registro.html_original,
    )
