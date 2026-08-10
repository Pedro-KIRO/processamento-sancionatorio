"""Testes do serviço de despachos SEI (Arquivar, TAC, Instaurar). Sem rede (mocks)."""
from datetime import date
from unittest.mock import MagicMock

import pytest

from app.db import models as m
from app.integrations.sei.client import SeiErroDefinitivoError, SeiIndisponivelError
from app.services import despachos_sei as svc


def _item(**kwargs) -> m.CaixaEntrada:
    base = dict(
        id=1,
        numero_sei="140.00286276/2026-27",
        id_procedimento="123456",
        razao_social="Auto Escola Modelo Ltda",
        agente_regulado="Autoescola",
        cnpj_cpf="12.345.678/0001-99",
        tipo_documento="CNPJ",
        data_recebimento=date(2026, 1, 10),
    )
    base.update(kwargs)
    return m.CaixaEntrada(**base)


def _graph_com_template(html: str = "<p>[NOME COMPLETO] [CNPJ] [LINK_DOCUMENTO]</p>",
                         id_bloco: str = "999", id_tipo_procedimento: str = "100003458"):
    graph = MagicMock()

    def fake_filtered(site_id, list_id, filtro, top=5):
        if list_id == svc.LISTA_SEI_DESPACHOS_ID:
            return [{"fields": {"HTML": html}}]
        if list_id == svc.LISTA_BLOCOS_ASSINATURA_ID:
            return [{"fields": {"idBloco": id_bloco}}]
        if list_id == svc.LISTA_CODIGOS_API_ID:
            return [{"fields": {"idTipoProcedimento": id_tipo_procedimento}}]
        return []

    graph.get_list_items_filtered.side_effect = fake_filtered
    return graph


def test_substituir_placeholders_basico():
    item = _item()
    html = svc._substituir_placeholders(
        "Empresa: NOME COMPLETO DO COMPROMISSÁRIO CNPJ [CNPJ]", item, "http://link"
    )
    assert "AUTO ESCOLA MODELO LTDA" in html
    assert "12.345.678/0001-99" in html


def test_montar_template_arquivar_usa_agente_do_item():
    """O arquivamento passou a ser por agente.

    Era um modelo genérico ("Qualquer") quando os textos eram coletados à mão.
    Os modelos oficiais do SEI têm uma versão por agente e por motivo do
    arquivamento — nove só para perito —, então a busca parte do agente do item
    e só cai em "Qualquer" se não houver nada.
    """
    item = _item(agente_regulado="Autoescola")
    graph = _graph_com_template()

    html = svc.montar_template_arquivar(graph, "site-id", item, "https://sei.sp.gov.br/sei")

    assert "AUTO ESCOLA MODELO LTDA" in html
    assert "12.345.678/0001-99" in html
    primeiro_filtro = graph.get_list_items_filtered.call_args_list[0].args[2]
    assert "Autoescola" in primeiro_filtro
    assert "DETRAN - Decisão 743 - Arquivamento" in primeiro_filtro


def test_montar_template_instaurar_usa_agente_do_item():
    item = _item(agente_regulado="Autoescola")
    graph = _graph_com_template()
    svc.montar_template_instaurar(graph, "site-id", item, "https://sei.sp.gov.br/sei")
    primeiro_filtro = graph.get_list_items_filtered.call_args_list[0].args[2]
    assert "Autoescola" in primeiro_filtro
    assert "DETRAN - Termo de instauração" in primeiro_filtro


def test_template_nao_encontrado_levanta_erro():
    item = _item()
    graph = MagicMock()
    graph.get_list_items_filtered.return_value = []
    with pytest.raises(svc.TemplateNaoEncontradoError):
        svc.montar_template_tac(graph, "site-id", item, "")


def test_executar_arquivar_chama_sei_na_ordem_correta():
    item = _item()
    sei = MagicMock()
    sei.consultar_processo.return_value = {"idProcedimento": "123456"}
    sei.incluir_documento.return_value = {"idDocumento": "9", "documentoFormatado": "0009999"}
    graph = _graph_com_template()

    resultado = svc.executar_arquivar(sei, graph, "site-id", item, "<p>html final</p>", "110053117")

    sei.receber_processo.assert_called_once_with(item.numero_sei, "110053117")
    sei.consultar_processo.assert_called_once_with(item.numero_sei, "110053117")
    sei.incluir_documento.assert_called_once()
    args, kwargs = sei.incluir_documento.call_args
    assert args[0] == "123456"  # idProcedimento
    assert args[2] == svc.ID_SERIE_ARQUIVAR  # idSerie
    sei.incluir_documento_bloco.assert_called_once_with("999", "0009999", "110053117")

    assert resultado.numero_sei == item.numero_sei
    assert resultado.id_procedimento == "123456"
    assert resultado.documento_formatado == "0009999"


def test_executar_tac_usa_id_serie_tac():
    item = _item()
    sei = MagicMock()
    sei.consultar_processo.return_value = {"idProcedimento": "123456"}
    sei.incluir_documento.return_value = {"idDocumento": "9", "documentoFormatado": "0009999"}
    graph = _graph_com_template()

    svc.executar_tac(sei, graph, "site-id", item, "<p>html</p>", "110053117")

    args, _ = sei.incluir_documento.call_args
    assert args[2] == svc.ID_SERIE_TAC


def test_executar_instaurar_cria_processo_novo_sem_copiar_documentos():
    item = _item()
    sei = MagicMock()
    sei.criar_processo.return_value = {
        "idProcedimento": "999999",
        "procedimentoFormatado": "140.00999999/2026-01",
    }
    sei.incluir_documento.return_value = {"idDocumento": "5", "documentoFormatado": "0005555"}
    graph = _graph_com_template()

    resultado = svc.executar_instaurar(
        sei, graph, "site-id", item, "<p>termo</p>", "110053117", cautelar=False,
    )

    sei.criar_processo.assert_called_once()
    args, kwargs = sei.criar_processo.call_args
    assert args[0] == "110053117"
    assert args[1] == "100003458"  # idTipoProcedimento

    sei.receber_processo.assert_called_once_with("140.00999999/2026-01", "110053117")

    args_doc, _ = sei.incluir_documento.call_args
    assert args_doc[0] == "999999"  # idProcedimento do processo NOVO
    assert args_doc[2] == svc.ID_SERIE_INSTAURAR

    # Não deve existir nenhuma chamada de cópia/movimentação de documentos
    # (esse comportamento não existe nos fluxos de referência do app original).
    from app.integrations.sei.client import SeiClient
    assert not hasattr(SeiClient, "copiar_documentos")
    assert not hasattr(SeiClient, "mover_documentos")

    assert resultado.numero_sei == "140.00999999/2026-01"
    assert resultado.id_procedimento == "999999"


def test_executar_instaurar_cautelar_usa_cargo_coordenador():
    item = _item()
    sei = MagicMock()
    sei.criar_processo.return_value = {
        "idProcedimento": "1", "procedimentoFormatado": "140.00000001/2026-01",
    }
    sei.incluir_documento.return_value = {"idDocumento": "1", "documentoFormatado": "0000001"}
    graph = _graph_com_template()

    svc.executar_instaurar(sei, graph, "site-id", item, "<p>termo</p>", "110053117", cautelar=True)

    filtro_bloco = graph.get_list_items_filtered.call_args_list[-1].args[2]
    assert "Coordenador" in filtro_bloco


# ---------------------------------------------------------------------------
# Tratamento de erros temporários/definitivos da API SEI
# ---------------------------------------------------------------------------
def test_arquivar_com_sei_indisponivel_no_consultar_processo_e_temporario():
    item = _item()
    sei = MagicMock()
    sei.consultar_processo.side_effect = SeiIndisponivelError("SEI fora do ar")
    graph = _graph_com_template()

    with pytest.raises(svc.DespachoSeiError) as exc_info:
        svc.executar_arquivar(sei, graph, "site-id", item, "<p>html</p>", "110053117")

    erro = exc_info.value
    assert erro.temporario is True
    assert erro.numero_sei_criado is None
    # Nada foi criado ainda — não deve tentar incluir documento.
    sei.incluir_documento.assert_not_called()


def test_arquivar_com_erro_definitivo_no_incluir_documento_nao_e_temporario():
    item = _item()
    sei = MagicMock()
    sei.consultar_processo.return_value = {"idProcedimento": "123456"}
    sei.incluir_documento.side_effect = SeiErroDefinitivoError("dados inválidos")
    graph = _graph_com_template()

    with pytest.raises(svc.DespachoSeiError) as exc_info:
        svc.executar_arquivar(sei, graph, "site-id", item, "<p>html</p>", "110053117")

    erro = exc_info.value
    assert erro.temporario is False
    # Arquivar/TAC não criam processo novo, então não há numero_sei_criado.
    assert erro.numero_sei_criado is None


def test_arquivar_com_recebimento_ja_feito_erro_definitivo_segue_o_fluxo():
    """Se o processo já estava recebido (erro definitivo do SEI ao tentar
    receber de novo), o fluxo deve continuar normalmente, não abortar."""
    item = _item()
    sei = MagicMock()
    sei.receber_processo.side_effect = SeiErroDefinitivoError("processo já recebido")
    sei.consultar_processo.return_value = {"idProcedimento": "123456"}
    sei.incluir_documento.return_value = {"idDocumento": "9", "documentoFormatado": "0009999"}
    graph = _graph_com_template()

    resultado = svc.executar_arquivar(sei, graph, "site-id", item, "<p>html</p>", "110053117")

    assert resultado.documento_formatado == "0009999"
    sei.incluir_documento.assert_called_once()


def test_arquivar_com_falha_no_bloco_de_assinatura_gera_aviso_nao_erro():
    """Falha ao incluir no bloco de assinatura não deve derrubar a ação —
    o documento já foi criado; o usuário só precisa ser avisado."""
    item = _item()
    sei = MagicMock()
    sei.consultar_processo.return_value = {"idProcedimento": "123456"}
    sei.incluir_documento.return_value = {"idDocumento": "9", "documentoFormatado": "0009999"}
    sei.incluir_documento_bloco.side_effect = SeiIndisponivelError("bloco indisponível")
    graph = _graph_com_template()

    resultado = svc.executar_arquivar(sei, graph, "site-id", item, "<p>html</p>", "110053117")

    assert resultado.documento_formatado == "0009999"
    assert any("bloco de assinatura" in aviso for aviso in resultado.avisos)


def test_arquivar_sem_bloco_cadastrado_gera_aviso():
    item = _item()
    sei = MagicMock()
    sei.consultar_processo.return_value = {"idProcedimento": "123456"}
    sei.incluir_documento.return_value = {"idDocumento": "9", "documentoFormatado": "0009999"}
    # Nenhuma lista retorna bloco (força id_bloco = None).
    graph = _graph_com_template(id_bloco=None)

    resultado = svc.executar_arquivar(sei, graph, "site-id", item, "<p>html</p>", "110053117")

    assert any("Nenhum bloco de assinatura cadastrado" in aviso for aviso in resultado.avisos)
    sei.incluir_documento_bloco.assert_not_called()


def test_arquivar_avisa_que_a_conclusao_do_relatorio_e_manual():
    """A API do SEI não tem operação de conclusão de processo.

    O arquivamento gera despacho e termo, mas quem conclui o relatório é o
    analista, no SEI. Se isso não aparecesse na resposta, o relatório ficaria
    aberto sem ninguém perceber.
    """
    item = _item()
    sei = MagicMock()
    sei.consultar_processo.return_value = {"idProcedimento": "123456"}
    sei.incluir_documento.return_value = {"idDocumento": "9", "documentoFormatado": "0009999"}
    graph = _graph_com_template()

    resultado = svc.executar_arquivar(sei, graph, "site-id", item, "<p>html</p>", "110053117")

    assert any("conclua o relatório no SEI" in aviso for aviso in resultado.avisos)


def test_instaurar_falha_ao_criar_processo_e_temporario_sem_numero_criado():
    item = _item()
    sei = MagicMock()
    sei.criar_processo.side_effect = SeiIndisponivelError("SEI fora do ar")
    graph = _graph_com_template()

    with pytest.raises(svc.DespachoSeiError) as exc_info:
        svc.executar_instaurar(sei, graph, "site-id", item, "<p>termo</p>", "110053117", cautelar=False)

    erro = exc_info.value
    assert erro.temporario is True
    assert erro.numero_sei_criado is None


def test_instaurar_falha_ao_incluir_documento_apos_criar_processo_bloqueia_repeticao():
    """Quando o processo NOVO já foi criado mas a inclusão do documento falha,
    o erro deve trazer numero_sei_criado e temporario=False (não repetir)."""
    item = _item()
    sei = MagicMock()
    sei.criar_processo.return_value = {
        "idProcedimento": "999999", "procedimentoFormatado": "140.00999999/2026-01",
    }
    # Mesmo sendo um erro classificado como temporário no SEI, a camada de
    # negócio bloqueia a repetição porque o processo já existe.
    sei.incluir_documento.side_effect = SeiIndisponivelError("SEI instável")
    graph = _graph_com_template()

    with pytest.raises(svc.DespachoSeiError) as exc_info:
        svc.executar_instaurar(sei, graph, "site-id", item, "<p>termo</p>", "110053117", cautelar=False)

    erro = exc_info.value
    assert erro.temporario is False
    assert erro.numero_sei_criado == "140.00999999/2026-01"
    assert erro.id_procedimento_criado == "999999"
    assert "NÃO tente instaurar de novo" in str(erro)


def test_instaurar_com_falha_no_recebimento_gera_aviso_mas_continua():
    item = _item()
    sei = MagicMock()
    sei.criar_processo.return_value = {
        "idProcedimento": "999999", "procedimentoFormatado": "140.00999999/2026-01",
    }
    sei.receber_processo.side_effect = SeiIndisponivelError("instável")
    sei.incluir_documento.return_value = {"idDocumento": "5", "documentoFormatado": "0005555"}
    graph = _graph_com_template()

    resultado = svc.executar_instaurar(
        sei, graph, "site-id", item, "<p>termo</p>", "110053117", cautelar=False,
    )

    assert resultado.numero_sei == "140.00999999/2026-01"
    assert any("recebimento" in a for a in resultado.avisos)


class TestTipoProcedimentoPorSubclasse:
    """Perito exige tipo de procedimento distinto por subclasse.

    O SEI tem Clínica (100002002), Médico (100002001) e Psicólogo (100002006),
    e nenhum tipo único de "Perito" — conferido em GET /processos/tipos. A
    configuração usa a chave "Perito | <subclasse>", montada a partir do nome
    original do agente guardado em ``agente_origem``.
    """

    def _config(self, chave: str, id_tipo: str):
        registro = MagicMock()
        registro.id_tipo_procedimento = id_tipo
        consulta = MagicMock()
        consulta.filter_by.side_effect = lambda agente_regulado: MagicMock(
            first=lambda: registro if agente_regulado == chave else None
        )
        db = MagicMock()
        db.query.return_value = consulta
        return db

    def test_usa_a_chave_com_subclasse_quando_o_agente_de_origem_permite(self):
        db = self._config("Perito | Médico", "100002001")

        achado = svc._buscar_id_tipo_procedimento(
            None, "", "Perito", db=db, agente_origem="Médicos",
        )

        assert achado == "100002001"

    def test_clinica_nao_e_confundida_com_medico(self):
        db = self._config("Perito | Clínica", "100002002")

        achado = svc._buscar_id_tipo_procedimento(
            None, "", "Perito", db=db, agente_origem="Clínica de Medicina do Tráfego",
        )

        assert achado == "100002002"

    def test_sem_subclasse_cai_na_chave_da_classe(self):
        db = self._config("ECV", "100001998")

        achado = svc._buscar_id_tipo_procedimento(
            None, "", "ECV", db=db, agente_origem="Empresas credenciadas de vistoria – Remota",
        )

        assert achado == "100001998"

    def test_perito_sem_agente_de_origem_nao_encontra_tipo(self):
        # Melhor não encontrar do que escolher entre médico, psicólogo e clínica
        # ao acaso: o processo sairia no SEI com o tipo errado.
        db = self._config("Perito | Médico", "100002001")

        achado = svc._buscar_id_tipo_procedimento(None, "", "Perito", db=db, agente_origem=None)

        assert achado is None
