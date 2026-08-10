"""Testes do cliente SEI (sem rede: a sessão HTTP é mockada)."""
from unittest.mock import MagicMock

import pytest
import requests

from app.integrations.sei import (
    SeiClient,
    SeiErroDefinitivoError,
    SeiIndisponivelError,
    SeiSettings,
)


def make_settings() -> SeiSettings:
    return SeiSettings(
        token_url="https://idp/token",
        client_id="cid",
        client_secret="secret",
        api_base="https://sei.example/",
        sigla_sistema="CSDR_PROCESSAMENTO",
        identificacao_servico="ident",
        trace_id="trace",
    )


def _resp(json_data, status=200):
    r = MagicMock()
    r.json.return_value = json_data
    r.raise_for_status.return_value = None
    r.status_code = status
    return r


def test_autentica_e_cacheia_token():
    s = MagicMock()
    s.post.return_value = _resp({"access_token": "abc", "expires_in": 3600})
    s.get.return_value = _resp({"listaProcessos": []})
    cli = SeiClient(make_settings(), session=s)

    cli.listar_processos("110051045")
    cli.listar_processos("110051045")

    # Autenticou apenas uma vez (token reaproveitado).
    assert s.post.call_count == 1
    _, kwargs = s.get.call_args
    assert kwargs["headers"]["Authorization"] == "Bearer abc"
    assert kwargs["headers"]["X-IdUnidade"] == "110051045"
    assert kwargs["headers"]["X-SiglaSistema"] == "CSDR_PROCESSAMENTO"


def test_listar_processos_url_e_params():
    s = MagicMock()
    s.post.return_value = _resp({"access_token": "abc"})
    s.get.return_value = _resp({"listaProcessos": [{"x": 1}]})
    cli = SeiClient(make_settings(), session=s)

    out = cli.listar_processos("99", limit=500, start=0, tipo="T")

    args, kwargs = s.get.call_args
    assert args[0] == "https://sei.example/processos"
    assert kwargs["params"] == {"limit": 500, "start": 0, "tipo": "T"}
    assert out == {"listaProcessos": [{"x": 1}]}


def test_consultar_processo_limpa_numero():
    s = MagicMock()
    s.post.return_value = _resp({"access_token": "abc"})
    s.get.return_value = _resp({"procedimentoFormatado": "x"})
    cli = SeiClient(make_settings(), session=s)

    cli.consultar_processo("0001.123456/2026-00", "99", ultimo_andamento=True)

    args, kwargs = s.get.call_args
    assert args[0] == "https://sei.example/processos/0001123456202600"
    assert kwargs["params"] == {"sinRetornarUltimoAndamento": "true"}


def test_listar_andamentos_usa_query_params():
    s = MagicMock()
    s.post.return_value = _resp({"access_token": "abc"})
    s.get.return_value = _resp({"Andamentos": []})
    cli = SeiClient(make_settings(), session=s)

    cli.listar_andamentos("12345", "99", tipo_historico="R", start=0, limit=50)

    args, kwargs = s.get.call_args
    assert args[0].endswith("/andamentos/completo")
    assert kwargs["params"]["protocoloProcedimento"] == "12345"
    assert kwargs["params"]["tipoHistorico"] == "R"
    assert kwargs["params"]["limit"] == 50


def test_limpar_numero():
    assert SeiClient.limpar_numero("0001.123456/2026-00") == "0001123456202600"
    assert SeiClient.limpar_numero(None) == ""


def test_criar_processo_monta_corpo_esperado():
    s = MagicMock()
    s.post.side_effect = [
        _resp({"access_token": "abc"}),
        _resp({"idProcedimento": "1", "procedimentoFormatado": "140.00000001/2026-01"}),
    ]
    cli = SeiClient(make_settings(), session=s)

    out = cli.criar_processo("110053117", "100003458", "Empresa X - CNPJ 123")

    args, kwargs = s.post.call_args
    assert args[0] == "https://sei.example/processos"
    body = kwargs["json"]["procedimento"]
    assert body["idTipoProcedimento"] == "100003458"
    assert body["especificacao"] == "Empresa X - CNPJ 123"
    assert body["assuntos"] == [{"codigoEstruturado": "015.02.06.002", "descricao": "Processo Administrativo Sancionatório"}]
    assert body["idHipoteseLegal"] == "114"
    assert body["nivelAcesso"] == "1"
    assert out["procedimentoFormatado"] == "140.00000001/2026-01"


def test_receber_processo_url_correta():
    s = MagicMock()
    s.post.side_effect = [_resp({"access_token": "abc"}), _resp({}, status=204)]
    cli = SeiClient(make_settings(), session=s)

    cli.receber_processo("140.00286276/2026-27", "110053117")

    args, _ = s.post.call_args
    numero_limpo = SeiClient.limpar_numero("140.00286276/2026-27")
    assert args[0] == f"https://sei.example/processos/{numero_limpo}/recebimento"


def make_settings_sei_processos() -> SeiSettings:
    """Settings com api_base seguindo o padrão real (sei-processos...), para
    testar a derivação da base de documentos/parametros."""
    s = make_settings()
    s.api_base = "https://sei-processos.api.example/"
    return s


def test_incluir_documento_envia_base64_e_url_documentos():
    s = MagicMock()
    s.post.side_effect = [
        _resp({"access_token": "abc"}),
        _resp({"idDocumento": "9", "documentoFormatado": "0009999"}),
    ]
    cli = SeiClient(make_settings_sei_processos(), session=s)

    out = cli.incluir_documento("123456", "110053117", "2403", "<p>ola</p>", nome_arvore="Arvore")

    args, kwargs = s.post.call_args
    assert args[0] == "https://sei-documentos.api.example/documentos"
    body = kwargs["json"]
    assert body["idProcedimento"] == "123456"
    assert body["idSerie"] == "2403"
    assert body["tipo"] == "G"
    assert body["nomeArvore"] == "Arvore"
    import base64
    assert base64.b64decode(body["conteudo"]).decode("utf-8") == "<p>ola</p>"
    assert out["documentoFormatado"] == "0009999"


def test_incluir_documento_bloco_usa_base_parametros():
    s = MagicMock()
    s.post.side_effect = [_resp({"access_token": "abc"}), _resp({}, status=204)]
    cli = SeiClient(make_settings_sei_processos(), session=s)

    cli.incluir_documento_bloco("999", "0009999", "110053117")

    args, kwargs = s.post.call_args
    assert args[0] == "https://sei-parametros.api.example/blocos/999/documentos/0009999"
    assert kwargs["json"] == {"anotacao": ""}


# ---------------------------------------------------------------------------
# Classificação de erro + retry (tratamento de instabilidade do SEI)
# ---------------------------------------------------------------------------
def _resp_http_erro(status: int):
    """Mock de resposta HTTP cujo raise_for_status() levanta requests.HTTPError."""
    r = MagicMock()
    r.status_code = status
    r.text = f"corpo do erro {status}"
    erro = requests.HTTPError(f"{status} error")
    erro.response = r
    r.raise_for_status.side_effect = erro
    return r


def _cliente_sem_espera(session: MagicMock, **kwargs) -> SeiClient:
    """Cliente com sleep mockado (não espera de verdade nos testes de retry)."""
    return SeiClient(make_settings(), session=session, sleep_fn=lambda _: None, **kwargs)


@pytest.mark.parametrize("status", [500, 502, 503, 504, 429])
def test_leitura_com_erro_temporario_repete_e_eventualmente_sucede(status):
    s = MagicMock()
    s.post.return_value = _resp({"access_token": "abc"})
    # Falha duas vezes com erro temporário, sucede na terceira.
    s.get.side_effect = [_resp_http_erro(status), _resp_http_erro(status), _resp({"listaProcessos": []})]
    cli = _cliente_sem_espera(s)

    out = cli.listar_processos("99")

    assert out == {"listaProcessos": []}
    assert s.get.call_count == 3


def test_leitura_com_erro_temporario_esgota_tentativas_levanta_indisponivel():
    s = MagicMock()
    s.post.return_value = _resp({"access_token": "abc"})
    s.get.side_effect = [_resp_http_erro(503), _resp_http_erro(503), _resp_http_erro(503)]
    cli = _cliente_sem_espera(s, max_tentativas=3)

    with pytest.raises(SeiIndisponivelError):
        cli.listar_processos("99")
    assert s.get.call_count == 3


def test_leitura_com_erro_definitivo_nao_repete():
    s = MagicMock()
    s.post.return_value = _resp({"access_token": "abc"})
    s.get.side_effect = [_resp_http_erro(400)]
    cli = _cliente_sem_espera(s)

    with pytest.raises(SeiErroDefinitivoError):
        cli.listar_processos("99")
    # Erro definitivo não é retentado, mesmo em uma leitura.
    assert s.get.call_count == 1


def test_escrita_com_erro_temporario_nao_repete_automaticamente():
    """Escritas (POST) nunca repetem sozinhas: repetir sem confirmar que a
    anterior falhou de fato poderia duplicar processos/documentos no SEI."""
    s = MagicMock()
    s.post.side_effect = [_resp({"access_token": "abc"}), _resp_http_erro(503)]
    cli = _cliente_sem_espera(s)

    with pytest.raises(SeiIndisponivelError):
        cli.criar_processo("110053117", "100003458", "Empresa X")
    # Uma chamada para o token + uma para criar_processo = 2 no total.
    assert s.post.call_count == 2


def test_escrita_com_erro_definitivo_levanta_erro_definitivo():
    s = MagicMock()
    s.post.side_effect = [_resp({"access_token": "abc"}), _resp_http_erro(422)]
    cli = _cliente_sem_espera(s)

    with pytest.raises(SeiErroDefinitivoError):
        cli.criar_processo("110053117", "100003458", "Empresa X")


def test_falha_de_conexao_e_classificada_como_indisponivel():
    s = MagicMock()
    s.post.return_value = _resp({"access_token": "abc"})
    s.get.side_effect = requests.ConnectionError("conexão recusada")
    cli = _cliente_sem_espera(s)

    with pytest.raises(SeiIndisponivelError):
        cli.listar_processos("99")


def test_timeout_e_classificado_como_indisponivel():
    s = MagicMock()
    s.post.return_value = _resp({"access_token": "abc"})
    s.get.side_effect = requests.Timeout("tempo esgotado")
    cli = _cliente_sem_espera(s)

    with pytest.raises(SeiIndisponivelError):
        cli.listar_processos("99")


def test_excluir_processo_tenta_numero_apos_protocolo_falhar():
    s = MagicMock()
    s.post.return_value = _resp({"access_token": "abc"})
    # Primeira tentativa (protocolo) falha definitivamente; segunda (número) sucede.
    s.delete.side_effect = [_resp_http_erro(404), _resp({}, status=204)]
    cli = _cliente_sem_espera(s)

    cli.excluir_processo("110053117", protocolo_procedimento="999999", numero="140.00000001/2026-01")

    assert s.delete.call_count == 2
    primeira_url = s.delete.call_args_list[0].args[0]
    segunda_url = s.delete.call_args_list[1].args[0]
    assert primeira_url.endswith("/processos/999999")
    assert segunda_url.endswith(f"/processos/{SeiClient.limpar_numero('140.00000001/2026-01')}")
