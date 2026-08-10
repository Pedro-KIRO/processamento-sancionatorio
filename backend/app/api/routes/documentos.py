"""Rotas de Documentos (consulta ao SEI em tempo real)."""
import base64
import io
import logging
import zipfile
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import sei_settings
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.integrations.sei.client import SeiClient

router = APIRouter(tags=["Documentos"])
logger = logging.getLogger(__name__)

# Unidade padrão para consultas (mesma da caixa de entrada)
# Futuro: pegar do usuário logado ou do item
UNIDADES_CONSULTA = ["110051045", "110051042", "110053117", "110051044", "110051043", "110053119"]


class DocumentoOut(BaseModel):
    numero: str
    nome: str
    tipo: str  # "interno" ou "externo"
    data_geracao: str | None = None


def _get_sei_client() -> SeiClient:
    """Cliente SEI compartilhado (reaproveita o token entre requests)."""
    from app.core.sei_shared import get_sei_client
    return get_sei_client(timeout=30)


# Cache simples: última unidade que teve sucesso em consulta de documento.
# Isso funciona porque em geral todos os documentos de um mesmo processo
# pertencem à mesma unidade. O cache sobrevive por toda a vida do processo
# uvicorn (resetado ao reiniciar), o que é suficiente.
_ultima_unidade_sucesso: str | None = None


def _resolver_id_unidade(item: m.CaixaEntrada | None, db: Any = None) -> str | None:
    """Descobre a unidade SEI a usar para um item da caixa de entrada.

    Prioridade:
    1. item.id_unidade_sei (gravado pela varredura) — mais confiável
    2. ConfigUnidade do banco, buscando por agente_regulado do item
    3. None (fallback para tentativa e erro entre UNIDADES_CONSULTA)
    """
    if item and item.id_unidade_sei:
        return item.id_unidade_sei
    if item and item.agente_regulado and db:
        reg = db.query(m.ConfigUnidade).filter_by(agente_regulado=item.agente_regulado).first()
        if reg:
            return reg.id_unidade
    return None


def _consultar_documento_em_unidades(sei: SeiClient, numero_doc: str) -> tuple[dict, str]:
    """Consulta os metadados de um documento tentando cada unidade configurada.

    Usa um cache de "última unidade que funcionou" para evitar testar todas
    desde o início a cada documento — já que documentos do mesmo processo
    normalmente pertencem à mesma unidade. Se a unidade cacheada falhar,
    tenta as demais normalmente.
    """
    global _ultima_unidade_sucesso

    # Montar ordem de tentativa: última que funcionou primeiro
    ordem = list(UNIDADES_CONSULTA)
    if _ultima_unidade_sucesso and _ultima_unidade_sucesso in ordem:
        ordem.remove(_ultima_unidade_sucesso)
        ordem.insert(0, _ultima_unidade_sucesso)

    ultimo_erro: Exception | None = None
    for id_unidade in ordem:
        try:
            resultado = sei.consultar_documento(numero_doc, id_unidade, tentar_novamente=False)
            _ultima_unidade_sucesso = id_unidade
            return resultado, id_unidade
        except Exception as e:  # noqa: BLE001
            ultimo_erro = e
            continue
    raise ultimo_erro if ultimo_erro else RuntimeError("Nenhuma unidade configurada para consulta.")


def _extrair_numero_doc(andamento: dict) -> str | None:
    """Extrai o número do documento dos atributos do andamento."""
    # Primeiro tenta em atributoAndamento (campo real da API)
    atributos = andamento.get("atributoAndamento", andamento.get("atributos", []))
    if isinstance(atributos, list):
        for attr in atributos:
            if isinstance(attr, dict):
                nome = attr.get("nome", "").upper()
                if nome == "DOCUMENTO":
                    valor = str(attr.get("valor", "")).strip()
                    if valor:
                        return valor
    # Fallback: campo documento[].protocoloProcedimento
    docs = andamento.get("documento", [])
    if isinstance(docs, list) and docs:
        proto = docs[0].get("protocoloProcedimento", "")
        if proto:
            return str(proto).strip()
    return None


def listar_documentos_por_procedimento(
    id_procedimento: str,
    sei: SeiClient | None = None,
    id_unidade_hint: str | None = None,
    db=None,
) -> list[DocumentoOut]:
    """Lista os documentos de um procedimento SEI via andamentos (tarefas 2/13/33).

    ``id_unidade_hint``: unidade que sabemos ter acesso ao processo (do banco).
    Se disponível, usamos direto em vez da primeira unidade genérica.

    Se ``db`` for informado, usa o cache persistente com TTL curto. A lista é
    invalidada explicitamente quando o app inclui um documento no processo
    (ver ``cache_sei.invalidar_processo``).
    """
    if not id_procedimento:
        return []

    if db is not None:
        from app.services import cache_sei as _cache
        cacheado = _cache.obter(db, _cache.chave_lista_documentos(id_procedimento), _cache.TTL_LISTA)
        if cacheado is not None:
            return [DocumentoOut(**d) for d in cacheado]

    id_unidade = id_unidade_hint or UNIDADES_CONSULTA[0]
    sei = sei or _get_sei_client()

    # Buscar andamentos com tarefas de documentos (2=interno, 13=externo, 33=excluído)
    docs_encontrados: dict[str, dict] = {}  # numero_doc → info
    docs_excluidos: set[str] = set()
    start = 0

    while True:
        try:
            resp = sei.listar_andamentos(
                id_procedimento, id_unidade,
                tipo_historico="Z", tarefas="2,13,33",
                start=start, limit=100,
            )
        except Exception as e:
            logger.warning("Erro ao listar andamentos (proc %s, start %d): %s", id_procedimento, start, e)
            break

        andamentos = resp.get("Andamentos", [])
        if not andamentos:
            break

        for a in andamentos:
            id_tarefa = str(a.get("idTarefa", ""))
            numero_doc = _extrair_numero_doc(a)
            if not numero_doc:
                continue

            if id_tarefa == "33":
                docs_excluidos.add(numero_doc)
            else:
                if numero_doc not in docs_encontrados:
                    tipo = "interno" if id_tarefa == "2" else "externo"
                    # Extrair nome da descrição: "Gerado documento ... XXXXXXX (NOME), ..."
                    descricao = a.get("descricao", "")
                    nome_doc = f"Documento {numero_doc}"
                    if "(" in descricao and ")" in descricao:
                        try:
                            nome_doc = descricao.split("(")[1].split(")")[0]
                        except (IndexError, ValueError):
                            pass
                    docs_encontrados[numero_doc] = {
                        "numero": numero_doc,
                        "tipo": tipo,
                        "data_geracao": a.get("dataHora"),
                        "nome_descricao": nome_doc,
                    }

        if len(andamentos) < 100:
            break
        start += 1

    # Remover excluídos
    for exc in docs_excluidos:
        docs_encontrados.pop(exc, None)

    # Montar a lista de documentos usando o nome já extraído da descrição
    # dos andamentos — sem fazer chamadas extras à API de documentos aqui.
    # A consulta de metadados completos (que exige testar várias unidades)
    # acontece sob demanda, quando o usuário pedir o conteúdo de um
    # documento específico via obter_conteudo_documento_por_numero().
    documentos: list[DocumentoOut] = []
    for num, info in docs_encontrados.items():
        documentos.append(DocumentoOut(
            numero=num,
            nome=info.get("nome_descricao", f"Documento {num}"),
            tipo=info["tipo"],
            data_geracao=info.get("data_geracao"),
        ))

    # Ordenar: mais antigo primeiro (ordem cronológica)
    documentos.reverse()

    if db is not None and documentos:
        from app.services import cache_sei as _cache
        _cache.gravar(
            db,
            _cache.chave_lista_documentos(id_procedimento),
            [d.model_dump() for d in documentos],
        )

    return documentos


@router.get("/caixa-entrada/{item_id}/documentos", response_model=list[DocumentoOut])
def listar_documentos(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista documentos de um processo via API do SEI (andamentos + metadados)."""
    item = db.get(m.CaixaEntrada, item_id)
    if not item:
        raise HTTPException(404, "Item não encontrado")

    if not item.id_procedimento:
        return []

    return listar_documentos_por_procedimento(
        item.id_procedimento, id_unidade_hint=item.id_unidade_sei, db=db,
    )


def obter_conteudo_documento_por_numero(
    numero_doc: str,
    tipo_doc: str | None = None,
    sei: SeiClient | None = None,
    id_unidade_hint: str | None = None,
    db=None,
) -> dict:
    """Busca metadados + conteúdo (base64) de um documento pelo número.

    Documento interno (tipo "interno" / idTarefa 2): baixa via
    ``/documentos/{numero}/conteudo``.
    Documento externo (tipo "externo" / idTarefa 13): baixa via
    ``/documentos/{numero}/anexos``.

    O parâmetro ``id_unidade_hint`` é a unidade que sabemos ter acesso ao
    processo (gravada no banco pela varredura). Quando disponível, evita a
    tentativa e erro entre as 6 unidades e responde muito mais rápido.

    Se ``db`` for informado, o resultado é cacheado sem expiração: um documento
    já registrado no SEI não muda de conteúdo, então nunca precisa ser baixado
    duas vezes.
    """
    if db is not None:
        from app.services import cache_sei as _cache
        cacheado = _cache.obter(db, _cache.chave_documento(numero_doc), _cache.TTL_INFINITO)
        if cacheado is not None:
            return cacheado

    sei = sei or _get_sei_client()

    try:
        if id_unidade_hint:
            # Tenta direto com a unidade conhecida
            try:
                meta = sei.consultar_documento(numero_doc, id_unidade_hint, tentar_novamente=False)
                id_unidade = id_unidade_hint
            except Exception:
                # Fallback: tenta as outras unidades
                meta, id_unidade = _consultar_documento_em_unidades(sei, numero_doc)
        else:
            meta, id_unidade = _consultar_documento_em_unidades(sei, numero_doc)
    except Exception as e:
        raise HTTPException(502, f"Erro ao consultar documento: {e}")

    eh_externo = tipo_doc == "externo" if tipo_doc else None

    try:
        if eh_externo is True:
            dados = sei.download_anexo(numero_doc, id_unidade)
        elif eh_externo is False:
            dados = sei.download_conteudo(numero_doc, id_unidade)
        else:
            # Tipo desconhecido: tenta conteúdo interno primeiro, depois anexo.
            try:
                dados = sei.download_conteudo(numero_doc, id_unidade)
            except Exception:
                dados = sei.download_anexo(numero_doc, id_unidade)
    except Exception as e:
        raise HTTPException(502, f"Erro ao baixar documento: {e}")

    tipo_resultado = tipo_doc if tipo_doc else ("externo" if eh_externo else "interno")
    resultado = {
        "numero": numero_doc,
        "nome": meta.get("nomeArvore") or meta.get("nome") or f"Documento {numero_doc}",
        "tipo": tipo_resultado,
        "conteudo": dados,  # base64 ou estrutura retornada pela API
    }

    if db is not None:
        from app.services import cache_sei as _cache
        _cache.gravar(db, _cache.chave_documento(numero_doc), resultado)

    return resultado


@router.get("/documentos/{numero_doc}/conteudo")
def obter_conteudo_documento(
    numero_doc: str,
    tipo: str | None = None,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Retorna o conteúdo de um documento (base64). Interno: /conteudo, Externo: /anexos.

    Query param ``tipo`` aceita "interno" ou "externo" para direcionar o
    endpoint correto do SEI. Se omitido, tenta ambos automaticamente.
    """
    return JSONResponse(content=obter_conteudo_documento_por_numero(numero_doc, tipo_doc=tipo, db=db))


# ==============================================================================
# Download de documentos (arquivo binário)
# ==============================================================================


def _obter_bytes_documento(numero_doc: str, tipo_doc: str | None, id_unidade_hint: str | None = None) -> tuple[bytes, str, str]:
    """Baixa o conteúdo binário de um documento e retorna (bytes, nome_arquivo, content_type).

    Documentos internos do SEI são HTML → convertemos para bytes HTML.
    Documentos externos são binários (PDF, XLSX, etc.) → retornamos direto.
    """
    sei = _get_sei_client()

    try:
        if id_unidade_hint:
            try:
                meta = sei.consultar_documento(numero_doc, id_unidade_hint, tentar_novamente=False)
                id_unidade = id_unidade_hint
            except Exception:
                meta, id_unidade = _consultar_documento_em_unidades(sei, numero_doc)
        else:
            meta, id_unidade = _consultar_documento_em_unidades(sei, numero_doc)
    except Exception as e:
        raise HTTPException(502, f"Erro ao consultar documento: {e}")

    nome_base = meta.get("nomeArvore") or meta.get("nome") or f"Documento_{numero_doc}"
    # Limpar caracteres inválidos para nome de arquivo
    nome_base = "".join(c if c.isalnum() or c in " ._-" else "_" for c in nome_base).strip()

    eh_externo = tipo_doc == "externo" if tipo_doc else None

    try:
        if eh_externo is True:
            dados = sei.download_anexo(numero_doc, id_unidade)
            # dados = {"conteudo": base64, "content_type": "application/pdf", "tamanho": N}
            content_type = dados.get("content_type", "application/octet-stream")
            conteudo_bytes = base64.b64decode(dados["conteudo"])
            # Extensão baseada no content-type
            ext = _extensao_por_content_type(content_type)
            nome_arquivo = f"{nome_base}{ext}" if not nome_base.lower().endswith(ext) else nome_base
            return conteudo_bytes, nome_arquivo, content_type
        elif eh_externo is False:
            dados = sei.download_conteudo(numero_doc, id_unidade)
            # dados = {"idDocumento": ..., "conteudo": base64_html}
            conteudo_b64 = dados.get("conteudo", "")
            conteudo_bytes = base64.b64decode(conteudo_b64)
            nome_arquivo = f"{nome_base}.html" if not nome_base.lower().endswith(".html") else nome_base
            return conteudo_bytes, nome_arquivo, "text/html; charset=utf-8"
        else:
            # Tenta interno primeiro
            try:
                dados = sei.download_conteudo(numero_doc, id_unidade)
                conteudo_b64 = dados.get("conteudo", "")
                conteudo_bytes = base64.b64decode(conteudo_b64)
                nome_arquivo = f"{nome_base}.html" if not nome_base.lower().endswith(".html") else nome_base
                return conteudo_bytes, nome_arquivo, "text/html; charset=utf-8"
            except Exception:
                dados = sei.download_anexo(numero_doc, id_unidade)
                content_type = dados.get("content_type", "application/octet-stream")
                conteudo_bytes = base64.b64decode(dados["conteudo"])
                ext = _extensao_por_content_type(content_type)
                nome_arquivo = f"{nome_base}{ext}" if not nome_base.lower().endswith(ext) else nome_base
                return conteudo_bytes, nome_arquivo, content_type
    except Exception as e:
        raise HTTPException(502, f"Erro ao baixar documento: {e}")


def _extensao_por_content_type(content_type: str) -> str:
    """Retorna a extensão de arquivo apropriada para um content-type."""
    ct = content_type.lower().split(";")[0].strip()
    mapa = {
        "application/pdf": ".pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
        "application/vnd.ms-excel": ".xls",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/msword": ".doc",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "text/html": ".html",
        "text/plain": ".txt",
    }
    return mapa.get(ct, ".bin")


@router.get("/documentos/{numero_doc}/download")
def download_documento(
    numero_doc: str,
    tipo: str | None = Query(None, description="'interno' ou 'externo'"),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Baixa um documento como arquivo (binário com Content-Disposition)."""
    conteudo_bytes, nome_arquivo, content_type = _obter_bytes_documento(numero_doc, tipo)

    return Response(
        content=conteudo_bytes,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{nome_arquivo}"',
            "Content-Length": str(len(conteudo_bytes)),
        },
    )


@router.get("/caixa-entrada/{item_id}/documentos/download-todos")
def download_todos_documentos_caixa(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Baixa todos os documentos de um item da caixa de entrada em um ZIP."""
    item = db.get(m.CaixaEntrada, item_id)
    if not item:
        raise HTTPException(404, "Item não encontrado")
    if not item.id_procedimento:
        raise HTTPException(404, "Nenhum documento disponível")

    docs = listar_documentos_por_procedimento(item.id_procedimento, id_unidade_hint=item.id_unidade_sei)
    if not docs:
        raise HTTPException(404, "Nenhum documento encontrado")

    return _gerar_zip_documentos(docs, item.id_unidade_sei, nome_zip=f"documentos_{item.numero_sei or item_id}.zip")


@router.get("/processos-andamento/{item_id}/documentos/download-todos")
def download_todos_documentos_processo(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Baixa todos os documentos de um processo em andamento em um ZIP."""
    from app.api.routes.processos_andamento import _obter_item, _id_procedimento_documento

    item = _obter_item(item_id, db)
    id_procedimento = _id_procedimento_documento(item)
    if not id_procedimento:
        raise HTTPException(404, "Nenhum documento disponível")

    docs = listar_documentos_por_procedimento(id_procedimento, id_unidade_hint=item.id_unidade_sei)
    if not docs:
        raise HTTPException(404, "Nenhum documento encontrado")

    numero = item.numero_processo_sei or item.numero_sei or str(item_id)
    return _gerar_zip_documentos(docs, item.id_unidade_sei, nome_zip=f"documentos_{numero}.zip")


def _gerar_zip_documentos(docs: list[DocumentoOut], id_unidade_hint: str | None, nome_zip: str) -> StreamingResponse:
    """Gera um ZIP com todos os documentos da lista."""
    buffer = io.BytesIO()
    nomes_usados: dict[str, int] = {}

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for doc in docs:
            try:
                conteudo_bytes, nome_arquivo, _ = _obter_bytes_documento(
                    doc.numero, doc.tipo, id_unidade_hint=id_unidade_hint,
                )
                # Evitar nomes duplicados no ZIP
                if nome_arquivo in nomes_usados:
                    nomes_usados[nome_arquivo] += 1
                    base, ext = nome_arquivo.rsplit(".", 1) if "." in nome_arquivo else (nome_arquivo, "bin")
                    nome_arquivo = f"{base}_{nomes_usados[nome_arquivo]}.{ext}"
                else:
                    nomes_usados[nome_arquivo] = 0

                zf.writestr(nome_arquivo, conteudo_bytes)
            except Exception as e:
                logger.warning("Erro ao incluir documento %s no ZIP: %s", doc.numero, e)
                # Inclui um arquivo de erro no lugar
                zf.writestr(f"ERRO_{doc.numero}.txt", f"Não foi possível baixar: {e}")

    buffer.seek(0)
    # Limpar caracteres inválidos do nome do ZIP
    nome_zip_limpo = "".join(c if c.isalnum() or c in " ._-" else "_" for c in nome_zip).strip()

    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{nome_zip_limpo}"',
        },
    )


# ==============================================================================
# Gerar PDF unificado e incluir como documento externo no SEI
# ==============================================================================


def _html_para_pdf(html_content: bytes) -> bytes:
    """Converte HTML para PDF usando xhtml2pdf."""
    from io import BytesIO
    from xhtml2pdf import pisa

    resultado = BytesIO()
    # xhtml2pdf espera string
    html_str = html_content.decode("iso-8859-1", errors="replace")
    pisa.CreatePDF(html_str, dest=resultado)
    return resultado.getvalue()


@dataclass
class ResultadoPdfUnificado:
    """Resultado da geração do PDF unificado (conjunto probatório).

    Atributos:
        pdf_bytes: conteúdo do PDF concatenado.
        total_docs: quantidade de documentos encontrados no processo.
        docs_incluidos: quantidade efetivamente incluída no PDF.
        docs_falha: lista de documentos que não puderam ser baixados/convertidos,
            com número e motivo — para informar o usuário.
    """
    pdf_bytes: bytes
    total_docs: int
    docs_incluidos: int
    docs_falha: list[dict]  # [{"numero": "...", "nome": "...", "motivo": "..."}]


def _gerar_pdf_unificado(id_procedimento: str, id_unidade: str) -> ResultadoPdfUnificado:
    """Baixa todos os documentos de um processo e concatena em um único PDF.

    Documentos que não puderem ser baixados (ex.: série 1266 sem liberação)
    são registrados em ``docs_falha`` em vez de abortar todo o processo.
    O PDF é gerado com os documentos que foram baixados com sucesso.
    """
    from pypdf import PdfReader, PdfWriter

    sei = _get_sei_client()
    docs = listar_documentos_por_procedimento(id_procedimento, id_unidade_hint=id_unidade)

    # Inverter: mais antigo primeiro, mais recente por último
    docs = list(reversed(docs))

    writer = PdfWriter()
    docs_incluidos = 0
    docs_falha: list[dict] = []

    for doc in docs:
        try:
            conteudo_bytes, _, content_type = _obter_bytes_documento(
                doc.numero, doc.tipo, id_unidade_hint=id_unidade,
            )

            if "pdf" in content_type.lower():
                # Já é PDF — adiciona direto
                reader = PdfReader(io.BytesIO(conteudo_bytes))
                for page in reader.pages:
                    writer.add_page(page)
                docs_incluidos += 1
            elif "html" in content_type.lower() or conteudo_bytes[:5] == b"<!DOC" or conteudo_bytes[:5] == b"<html":
                # HTML — converte para PDF
                pdf_bytes = _html_para_pdf(conteudo_bytes)
                if pdf_bytes and len(pdf_bytes) > 100:
                    reader = PdfReader(io.BytesIO(pdf_bytes))
                    for page in reader.pages:
                        writer.add_page(page)
                    docs_incluidos += 1
                else:
                    docs_falha.append({
                        "numero": doc.numero,
                        "nome": doc.nome,
                        "motivo": "Conversão HTML→PDF resultou em arquivo vazio",
                    })
            else:
                # Outros formatos (xlsx etc.) — não concatenável em PDF
                docs_falha.append({
                    "numero": doc.numero,
                    "nome": doc.nome,
                    "motivo": f"Formato não suportado para PDF ({content_type})",
                })
        except Exception as e:
            logger.warning("Erro ao incluir documento %s no PDF: %s", doc.numero, e)
            docs_falha.append({
                "numero": doc.numero,
                "nome": doc.nome,
                "motivo": str(e)[:200],
            })
            continue

    if len(writer.pages) == 0:
        raise HTTPException(
            404,
            f"Nenhum documento pôde ser convertido para PDF. "
            f"{len(docs_falha)} documento(s) falharam: "
            + "; ".join(f"{d['numero']} ({d['motivo']})" for d in docs_falha[:5]),
        )

    buffer = io.BytesIO()
    writer.write(buffer)
    return ResultadoPdfUnificado(
        pdf_bytes=buffer.getvalue(),
        total_docs=len(docs),
        docs_incluidos=docs_incluidos,
        docs_falha=docs_falha,
    )


@router.post("/processos-andamento/{item_id}/incluir-conjunto-probatorio")
def incluir_conjunto_probatorio(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Gera PDF unificado dos documentos do processo de fiscalização e o inclui
    como documento externo no processo instaurado (novo).

    Fluxo:
    1. Baixa todos os documentos do processo de fiscalização original
    2. Concatena em um único PDF
    3. Faz upload para o SEI (POST /arquivos)
    4. Inclui como documento externo (tipo R) no processo instaurado
    """
    item = db.get(m.CaixaEntrada, item_id)
    if not item:
        raise HTTPException(404, "Item não encontrado")
    if not item.id_procedimento:
        raise HTTPException(400, "Processo de fiscalização sem id_procedimento")
    if not item.id_procedimento_processo:
        raise HTTPException(400, "Processo ainda não foi instaurado (sem id_procedimento_processo)")

    id_unidade = item.id_unidade_sei or "110053117"

    # 1. Gerar PDF unificado dos documentos do processo de fiscalização
    try:
        resultado_pdf = _gerar_pdf_unificado(item.id_procedimento, id_unidade)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Erro ao gerar PDF unificado: {e}")

    # 2. Upload do PDF para o SEI
    sei = _get_sei_client()
    nome_arquivo = f"Conjunto_probatorio_{item.numero_sei or item_id}.pdf"

    try:
        id_arquivo = sei.upload_arquivo(id_unidade, nome_arquivo, resultado_pdf.pdf_bytes)
    except Exception as e:
        raise HTTPException(502, f"Erro ao fazer upload do arquivo: {e}")

    # 3. Incluir como documento externo no processo instaurado
    try:
        resultado = sei.incluir_documento_externo(
            id_procedimento=item.id_procedimento_processo,
            id_unidade=id_unidade,
            id_arquivo=id_arquivo,
            nome_arvore="Conjunto probatório",
            id_serie="1917",  # Anexo
            descricao=f"Documentos do processo de fiscalização {item.numero_sei}",
        )
    except Exception as e:
        raise HTTPException(502, f"Erro ao incluir documento externo: {e}")

    # Montar resposta com info sobre docs que falharam
    resposta = {
        "sucesso": True,
        "id_documento": resultado.get("idDocumento"),
        "documento_formatado": resultado.get("documentoFormatado"),
        "link_acesso": resultado.get("linkAcesso"),
        "tamanho_pdf": len(resultado_pdf.pdf_bytes),
        "total_docs": resultado_pdf.total_docs,
        "docs_incluidos": resultado_pdf.docs_incluidos,
        "docs_falha": resultado_pdf.docs_falha,
        "mensagem": (
            f"Conjunto probatório incluído com sucesso "
            f"({resultado_pdf.docs_incluidos}/{resultado_pdf.total_docs} documentos, "
            f"{len(resultado_pdf.pdf_bytes) // 1024} KB)."
        ),
    }
    if resultado_pdf.docs_falha:
        nomes_falha = ", ".join(d["numero"] for d in resultado_pdf.docs_falha[:5])
        resposta["aviso"] = (
            f"{len(resultado_pdf.docs_falha)} documento(s) não puderam ser incluídos no PDF: "
            f"{nomes_falha}. Esses documentos precisam ser anexados manualmente se necessário."
        )
    return resposta
