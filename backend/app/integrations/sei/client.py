"""Cliente da API do SEI: autenticação (OAuth2 client_credentials) e consultas.

Portado e organizado a partir das automações existentes em `codigod`
(sei_client.py e caixaEntradaProd.py).

Observação importante a validar contra a doc/homologação do SEI:
os parâmetros de /andamentos/completo são enviados como QUERY STRING
(como faz a automação de produção caixaEntradaProd.py). Uma versão antiga
(sei_client.py) os enviava como headers. Mantivemos query string aqui.
"""
from __future__ import annotations

import base64
import json
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional, TypeVar

import requests


@dataclass
class SeiSettings:
    """Configuração de conexão com o SEI (lida de variáveis de ambiente)."""

    token_url: str
    client_id: str
    client_secret: str
    api_base: str
    sigla_sistema: str
    identificacao_servico: str
    trace_id: str

    @property
    def api_base_norm(self) -> str:
        return self.api_base.rstrip("/")


class SeiAuthError(RuntimeError):
    """Falha ao obter o token de acesso do SEI."""


class SeiApiError(RuntimeError):
    """Erro ao chamar a API do SEI. Base para os dois tipos abaixo."""

    def __init__(self, message: str, status_code: int | None = None, resposta: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.resposta = resposta


class SeiIndisponivelError(SeiApiError):
    """Erro TEMPORÁRIO do SEI (servidor fora do ar, timeout, instabilidade de rede).

    Indica que vale a pena tentar novamente depois de algum tempo — não é um
    problema com os dados enviados. Códigos HTTP 500, 502, 503, 504, além de
    timeouts e falhas de conexão, caem aqui.
    """


class SeiErroDefinitivoError(SeiApiError):
    """Erro DEFINITIVO do SEI (dados inválidos, permissão, processo não encontrado etc.).

    Tentar novamente sem alterar os dados enviados provavelmente vai falhar
    de novo. Requer intervenção manual (corrigir dados, verificar permissão
    da unidade, ou seguir manualmente pelo site do SEI).
    """


_CODIGOS_TEMPORARIOS = {500, 502, 503, 504, 429}

_T = TypeVar("_T")


class SeiClient:
    """Cliente HTTP do SEI com cache de token.

    A sessão HTTP pode ser injetada (útil para testes).
    """

    def __init__(
        self,
        settings: SeiSettings,
        session: Optional[Any] = None,
        timeout: int = 60,
        max_tentativas: int = 3,
        espera_base_s: float = 1.5,
        sleep_fn: Optional[Callable[[float], None]] = None,
    ):
        self.settings = settings
        self.session = session or requests.Session()
        self.timeout = timeout
        self.max_tentativas = max_tentativas
        self.espera_base_s = espera_base_s
        self._sleep = sleep_fn or time.sleep
        self._token: Optional[str] = None
        self._token_exp: float = 0.0
        # Protege a renovação de token quando o cliente é compartilhado entre
        # requests/threads (ver app.core.sei_shared.get_sei_client). Sem isso,
        # várias threads poderiam autenticar em paralelo desnecessariamente.
        self._token_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Execução de requisições com classificação de erro + retry
    # ------------------------------------------------------------------
    def _classificar_e_levantar(self, exc: Exception) -> None:
        """Converte uma exceção de rede/HTTP em SeiIndisponivelError ou
        SeiErroDefinitivoError, com o corpo da resposta quando disponível."""
        if isinstance(exc, requests.HTTPError):
            resp = exc.response
            status = resp.status_code if resp is not None else None
            try:
                corpo = resp.text if resp is not None else None
            except Exception:  # noqa: BLE001
                corpo = None
            if status in _CODIGOS_TEMPORARIOS:
                raise SeiIndisponivelError(
                    f"O servidor do SEI respondeu com erro {status}. "
                    "Isso costuma ser uma instabilidade temporária.",
                    status_code=status, resposta=corpo,
                ) from exc
            raise SeiErroDefinitivoError(
                f"O SEI recusou a solicitação (HTTP {status}). Verifique os dados enviados "
                "ou a permissão da unidade.",
                status_code=status, resposta=corpo,
            ) from exc
        if isinstance(exc, (requests.ConnectionError, requests.Timeout)):
            raise SeiIndisponivelError(
                "Não foi possível conectar ao SEI (timeout ou conexão recusada). "
                "O servidor pode estar temporariamente indisponível.",
            ) from exc
        # Erro inesperado: não reclassifica, deixa subir como está.
        raise exc

    def _executar(self, fn: Callable[[], _T], *, pode_repetir: bool) -> _T:
        """Executa `fn` (uma chamada HTTP) com classificação de erro.

        Quando `pode_repetir=True` (operações de LEITURA, idempotentes), tenta
        novamente com backoff exponencial em caso de erro classificado como
        temporário. Operações de ESCRITA (criar processo/documento etc.) nunca
        repetem automaticamente aqui — repetir uma escrita sem confirmar que a
        anterior falhou de fato pode duplicar processos/documentos no SEI.
        """
        tentativas = self.max_tentativas if pode_repetir else 1
        ultimo_erro: Optional[SeiApiError] = None
        for tentativa in range(1, tentativas + 1):
            try:
                return fn()
            except SeiApiError:
                raise
            except Exception as exc:  # noqa: BLE001
                try:
                    self._classificar_e_levantar(exc)
                except SeiIndisponivelError as e:
                    ultimo_erro = e
                    if tentativa < tentativas:
                        self._sleep(self.espera_base_s * (2 ** (tentativa - 1)))
                        continue
                    raise
                except SeiErroDefinitivoError:
                    raise
        # Não deve chegar aqui, mas por segurança:
        if ultimo_erro:
            raise ultimo_erro
        raise SeiIndisponivelError("Falha desconhecida ao chamar o SEI.")

    # ------------------------------------------------------------------
    # Autenticação
    # ------------------------------------------------------------------
    def _autenticar(self) -> str:
        def _chamar() -> dict:
            resp = self.session.post(
                self.settings.token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.settings.client_id,
                    "client_secret": self.settings.client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()

        # Autenticação é idempotente (só consulta um token) — pode repetir em
        # caso de instabilidade temporária do IdP.
        corpo = self._executar(_chamar, pode_repetir=True)
        token = corpo.get("access_token")
        if not token:
            raise SeiAuthError("Resposta de token sem 'access_token'.")
        self._token = token
        self._token_exp = time.time() + int(corpo.get("expires_in", 3600))
        return token

    def _token_valido(self) -> str:
        # Renova com 60s de folga antes de expirar.
        if not self._token or time.time() >= self._token_exp - 60:
            with self._token_lock:
                # Recheca dentro do lock: outra thread pode já ter renovado
                # enquanto esperávamos.
                if not self._token or time.time() >= self._token_exp - 60:
                    self._autenticar()
        return self._token  # type: ignore[return-value]

    def _headers(self, id_unidade: Any, extras: Optional[dict] = None) -> dict:
        cabecalho = {
            "X-SiglaSistema": self.settings.sigla_sistema,
            "X-IdentificacaoServico": self.settings.identificacao_servico,
            "X-IdUnidade": str(id_unidade),
            "X-TraceId-SP": self.settings.trace_id,
            "Authorization": f"Bearer {self._token_valido()}",
            "Accept": "application/json",
        }
        if extras:
            cabecalho.update(extras)
        return cabecalho

    @staticmethod
    def limpar_numero(numero: Any) -> str:
        """Remove pontuação do número SEI (ex.: 0001.123456/2026-00 -> 0001123456202600)."""
        if numero is None:
            return ""
        resultado = str(numero)
        for ch in (".", "/", "-", " "):
            resultado = resultado.replace(ch, "")
        return resultado

    # ------------------------------------------------------------------
    # Consultas
    # ------------------------------------------------------------------
    def listar_processos(self, id_unidade: Any, limit: int = 500, start: int = 0, tipo: str = "T") -> dict:
        """Lista processos de uma unidade. 'start' é o índice da página."""
        url = f"{self.settings.api_base_norm}/processos"

        def _chamar() -> dict:
            resp = self.session.get(
                url,
                headers=self._headers(id_unidade),
                params={"limit": limit, "start": start, "tipo": tipo},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()

        return self._executar(_chamar, pode_repetir=True)

    def listar_tipos_procedimento(self, id_unidade: Any) -> dict:
        """Tipos de procedimento disponíveis para a unidade.

        ``GET /processos/tipos`` — o resultado varia por unidade. O
        ``idTipoProcedimento`` obtido aqui é o que ``criar_processo`` espera, e é
        por ele que se sabe qual tipo de processo sancionatório abrir para cada
        agente regulado.
        """
        url = f"{self.settings.api_base_norm}/processos/tipos"

        def _chamar() -> dict:
            resp = self.session.get(
                url, headers=self._headers(id_unidade), timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()

        return self._executar(_chamar, pode_repetir=True)

    def consultar_processo(self, numero: Any, id_unidade: Any, ultimo_andamento: bool = False) -> dict:
        """Consulta os detalhes de um processo pelo número (com ou sem pontuação)."""
        num = self.limpar_numero(numero)
        url = f"{self.settings.api_base_norm}/processos/{num}"
        params: dict = {}
        if ultimo_andamento:
            params["sinRetornarUltimoAndamento"] = "true"

        def _chamar() -> dict:
            resp = self.session.get(
                url,
                headers=self._headers(id_unidade),
                params=params,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()

        return self._executar(_chamar, pode_repetir=True)

    def listar_andamentos(
        self,
        id_procedimento: Any,
        id_unidade: Any,
        tipo_historico: str = "Z",
        start: int = 0,
        limit: int = 90,
        retorna_atributos: str = "S",
        tarefas: Optional[str] = None,
    ) -> dict:
        """Lista o histórico de andamentos de um procedimento."""
        url = f"{self.settings.api_base_norm}/andamentos/completo"
        params = {
            "protocoloProcedimento": str(id_procedimento),
            "retornaAtributos": retorna_atributos,
            "tipoHistorico": tipo_historico,
            "start": start,
            "limit": limit,
        }
        if tarefas:
            params["tarefas"] = tarefas

        def _chamar() -> dict:
            resp = self.session.get(
                url,
                headers=self._headers(id_unidade),
                params=params,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()

        return self._executar(_chamar, pode_repetir=True)

    @staticmethod
    def _json(resp: Any) -> dict:
        """Interpreta a resposta como JSON, tolerando caracteres de controle.

        O SEI às vezes devolve JSON com quebra de linha crua dentro de uma
        string (visto no nome de documentos cadastrados com Enter no meio do
        texto). O parser padrão recusa, e a leitura do documento falhava com
        ``JSONDecodeError`` — indistinguível, para quem chama, de documento
        inexistente. ``strict=False`` aceita esses caracteres.
        """
        try:
            return resp.json()
        except ValueError:
            return json.loads(resp.text, strict=False)

    # ------------------------------------------------------------------
    # Documentos (base URL separada: sei-documentos.api.rota.sp.gov.br)
    # ------------------------------------------------------------------
    @property
    def _docs_base(self) -> str:
        """Base URL para a API de documentos (derivada da base de processos)."""
        # sei-processos.api.rota.sp.gov.br → sei-documentos.api.rota.sp.gov.br
        return self.settings.api_base_norm.replace("sei-processos", "sei-documentos")

    def consultar_documento(self, numero_doc: Any, id_unidade: Any, tentar_novamente: bool = True) -> dict:
        """Consulta metadados de um documento (nome, tipo, etc.).

        `tentar_novamente=False` desliga o retry automático em erro temporário
        — útil quando quem chama já está tentando várias unidades em sequência
        (a API do SEI responde 500 "instabilidade" quando na verdade é a
        unidade que não tem acesso ao documento; repetir a mesma unidade não
        ajuda, e tentar outra unidade é bem mais rápido).
        """
        url = f"{self._docs_base}/documentos/{numero_doc}"

        def _chamar() -> dict:
            resp = self.session.get(url, headers=self._headers(id_unidade), timeout=self.timeout)
            resp.raise_for_status()
            return self._json(resp)

        return self._executar(_chamar, pode_repetir=tentar_novamente)

    def download_conteudo(self, numero_doc: Any, id_unidade: Any, tentar_novamente: bool = True) -> dict:
        """Baixa o conteúdo de um documento interno (retorna base64)."""
        url = f"{self._docs_base}/documentos/{numero_doc}/conteudo"

        def _chamar() -> dict:
            resp = self.session.get(url, headers=self._headers(id_unidade), timeout=self.timeout)
            resp.raise_for_status()
            return self._json(resp)

        return self._executar(_chamar, pode_repetir=tentar_novamente)

    def download_anexo(self, numero_doc: Any, id_unidade: Any, tentar_novamente: bool = True) -> dict:
        """Baixa o anexo de um documento externo (retorna conteúdo em base64).

        Diferente de ``download_conteudo`` (que retorna JSON com base64
        diretamente), o endpoint ``/anexos`` do SEI retorna o arquivo binário
        puro (ex.: PDF). Aqui convertemos para base64 para manter a interface
        uniforme com o frontend.
        """
        import base64 as b64

        url = f"{self._docs_base}/documentos/{numero_doc}/anexos"

        def _chamar() -> dict:
            resp = self.session.get(url, headers=self._headers(id_unidade), timeout=self.timeout)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
            conteudo_b64 = b64.b64encode(resp.content).decode("ascii")
            return {"conteudo": conteudo_b64, "content_type": content_type, "tamanho": len(resp.content)}

        return self._executar(_chamar, pode_repetir=tentar_novamente)

    # ------------------------------------------------------------------
    # Escrita: criação de processos e documentos
    # (portado dos fluxos incluirTAC / testeCriacaoDOC / salvarFasesDOC)
    # ------------------------------------------------------------------
    def criar_processo(
        self,
        id_unidade: Any,
        id_tipo_procedimento: Any,
        especificacao: str,
        id_hipotese_legal: str = "114",
        nivel_acesso: str = "1",
        codigo_assunto: str = "015.02.06.002",
        descricao_assunto: str = "Processo Administrativo Sancionatório",
    ) -> dict:
        """Cria um novo processo SEI (usado na Instauração).

        Resposta: {"idProcedimento": "...", "procedimentoFormatado": "...", "linkAcesso": "..."}
        """
        url = f"{self.settings.api_base_norm}/processos"
        body = {
            "procedimento": {
                "idTipoProcedimento": str(id_tipo_procedimento),
                "especificacao": especificacao,
                "assuntos": [{"codigoEstruturado": codigo_assunto, "descricao": descricao_assunto}],
                "sinArquivamento": "N",
                "observacao": "",
                "idHipoteseLegal": id_hipotese_legal,
                "nivelAcesso": nivel_acesso,
            }
        }

        def _chamar() -> dict:
            resp = self.session.post(url, headers=self._headers(id_unidade), json=body, timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()

        # Escrita: NÃO repete automaticamente (evita criar processo duplicado
        # se a primeira tentativa já tiver ido adiante no servidor do SEI).
        return self._executar(_chamar, pode_repetir=False)

    def receber_processo(self, numero: Any, id_unidade: Any) -> None:
        """Marca um processo como recebido na unidade (POST /processos/{numero}/recebimento)."""
        num = self.limpar_numero(numero)
        url = f"{self.settings.api_base_norm}/processos/{num}/recebimento"

        def _chamar() -> None:
            resp = self.session.post(url, headers=self._headers(id_unidade), timeout=self.timeout)
            resp.raise_for_status()

        self._executar(_chamar, pode_repetir=False)

    def definir_prazo(
        self,
        numero: Any,
        id_unidade: Any,
        data_prazo: str | None = None,
        dias: int | None = None,
        dias_uteis: bool = False,
    ) -> None:
        """Define um prazo no processo SEI (POST /processos/{numero}/prazo).

        Parâmetros (pelo menos um obrigatório):
        - data_prazo: data de vencimento no formato "dd/mm/yyyy"
        - dias: quantidade de dias a partir de hoje
        - dias_uteis: se True usa dias úteis, se False usa corridos (padrão)

        Baseado no fluxo `definirPrazo` do Power Automate original.
        """
        num = self.limpar_numero(numero)
        url = f"{self.settings.api_base_norm}/processos/{num}/prazo"

        body: dict = {}
        if data_prazo:
            body["dataPrazo"] = data_prazo
        if dias is not None:
            body["dias"] = str(dias)
        body["sinDiasUteis"] = "S" if dias_uteis else "N+"

        def _chamar() -> None:
            resp = self.session.post(url, headers=self._headers(id_unidade), json=body, timeout=self.timeout)
            resp.raise_for_status()

        self._executar(_chamar, pode_repetir=False)

    def upload_arquivo(self, id_unidade: Any, nome: str, conteudo_bytes: bytes) -> str:
        """Faz upload de um arquivo para o SEI (POST /arquivos).

        Retorna o `idArquivo` gerado pelo SEI, que deve ser usado em
        `incluir_documento_externo` para vincular o arquivo ao documento.

        IMPORTANTE: a unidade usada aqui deve ser a mesma usada em
        `incluir_documento_externo` — o SEI valida isso.
        """
        import hashlib

        url = f"{self._docs_base}/arquivos"
        conteudo_b64 = base64.b64encode(conteudo_bytes).decode("ascii")
        tamanho = len(conteudo_bytes)
        hash_md5 = hashlib.md5(conteudo_bytes).hexdigest()

        body = {
            "nome": nome,
            "tamanho": str(tamanho),
            "hash": hash_md5,
            "conteudo": conteudo_b64,
        }

        def _chamar() -> str:
            resp = self.session.post(url, headers=self._headers(id_unidade), json=body, timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()
            id_arquivo = data.get("idArquivo", "")
            if not id_arquivo:
                # Fallback: extrair do message
                msg = data.get("message", "")
                if "ID:" in msg:
                    id_arquivo = msg.split("ID:")[-1].strip()
            return id_arquivo

        return self._executar(_chamar, pode_repetir=False)

    def incluir_documento_externo(
        self,
        id_procedimento: Any,
        id_unidade: Any,
        id_arquivo: str,
        nome_arvore: str = "",
        id_serie: str = "1917",
        data: str = "",
        descricao: str = "",
        observacao: str = "",
        nivel_acesso: str = "0",
    ) -> dict:
        """Inclui um documento externo (tipo R) em um processo, a partir de um arquivo já uploadado.

        O `id_arquivo` vem do retorno de `upload_arquivo()`. A mesma unidade
        usada no upload deve ser usada aqui.

        Resposta: {"idDocumento": "...", "documentoFormatado": "...", "linkAcesso": "..."}
        """
        from datetime import date as dt_date

        url = f"{self._docs_base}/documentos"
        if not data:
            data = dt_date.today().strftime("%d/%m/%Y")

        body = {
            "idProcedimento": str(id_procedimento),
            "idSerie": id_serie,
            "tipo": "R",
            "numero": "",
            "nomeArvore": nome_arvore,
            "data": data,
            "descricao": descricao,
            "sinArquivamento": "N",
            "observacao": observacao,
            "nivelAcesso": nivel_acesso,
            "idArquivo": id_arquivo,
        }

        def _chamar() -> dict:
            resp = self.session.post(url, headers=self._headers(id_unidade), json=body, timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()

        return self._executar(_chamar, pode_repetir=False)

    def incluir_documento(
        self,
        id_procedimento: Any,
        id_unidade: Any,
        id_serie: str,
        html: str,
        nome_arvore: str = "",
        nivel_acesso: str = "1",
        id_hipotese_legal: Optional[str] = "114",
        descricao: str = "",
    ) -> dict:
        """Inclui um documento gerado (tipo 'G') em um processo, a partir de HTML.

        Resposta: {"idDocumento": "...", "documentoFormatado": "...", "linkAcesso": "..."}
        """
        url = f"{self._docs_base}/documentos"
        conteudo_b64 = base64.b64encode(html.encode("utf-8")).decode("ascii")
        body: dict = {
            "idProcedimento": str(id_procedimento),
            "idSerie": str(id_serie),
            "tipo": "G",
            "idTipoDocumento": "",
            "nomeArvore": nome_arvore,
            "descricao": descricao,
            "sinArquivamento": "N",
            "observacao": "",
            "nivelAcesso": nivel_acesso,
            "conteudo": conteudo_b64,
        }
        if id_hipotese_legal:
            body["idHipoteseLegal"] = id_hipotese_legal

        def _chamar() -> dict:
            resp = self.session.post(url, headers=self._headers(id_unidade), json=body, timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()

        return self._executar(_chamar, pode_repetir=False)

    def incluir_documento_bloco(self, id_bloco: Any, documento_formatado: str, id_unidade: Any) -> None:
        """Inclui um documento em um bloco de assinatura (POST /blocos/{id}/documentos/{doc})."""
        base_parametros = self.settings.api_base_norm.replace("sei-processos", "sei-parametros")
        url = f"{base_parametros}/blocos/{id_bloco}/documentos/{documento_formatado}"

        def _chamar() -> None:
            resp = self.session.post(url, headers=self._headers(id_unidade), json={"anotacao": ""}, timeout=self.timeout)
            resp.raise_for_status()

        self._executar(_chamar, pode_repetir=False)

    def excluir_documento(self, numero_doc: Any, id_unidade: Any) -> None:
        """Exclui um documento pelo número (usado para reverter testes/erros)."""
        url = f"{self._docs_base}/documentos/{numero_doc}"

        def _chamar() -> None:
            resp = self.session.delete(url, headers=self._headers(id_unidade), timeout=self.timeout)
            resp.raise_for_status()

        # Exclusão é idempotente na prática (excluir de novo um já excluído dá
        # erro definitivo, não repete infinitamente) — mas mantemos sem retry
        # automático por ser uma operação de escrita.
        self._executar(_chamar, pode_repetir=False)

    def excluir_processo(
        self,
        id_unidade: Any,
        protocolo_procedimento: Any = None,
        numero: Any = None,
    ) -> None:
        """Exclui um processo (usado para reverter testes/erros).

        Tenta primeiro com `protocolo_procedimento` (se fornecido); se a API
        retornar erro, tenta novamente com `numero` sem máscara. Levanta o
        erro da ÚLTIMA tentativa (com a resposta da API) se nenhuma funcionar.

        Atenção: irreversível em produção. Confirme antes de chamar.
        """
        identificadores: list[str] = []
        if protocolo_procedimento:
            identificadores.append(str(protocolo_procedimento))
        if numero:
            num_limpo = self.limpar_numero(numero)
            if num_limpo and num_limpo not in identificadores:
                identificadores.append(num_limpo)
        if not identificadores:
            raise ValueError("Informe protocolo_procedimento ou numero para excluir o processo.")

        ultimo_erro: Optional[SeiApiError] = None
        for identificador in identificadores:
            url = f"{self.settings.api_base_norm}/processos/{identificador}"

            def _chamar() -> None:
                resp = self.session.delete(url, headers=self._headers(id_unidade), timeout=self.timeout)
                resp.raise_for_status()

            try:
                self._executar(_chamar, pode_repetir=False)
                return
            except SeiApiError as e:
                ultimo_erro = e
                continue
        if ultimo_erro:
            raise ultimo_erro

    # ------------------------------------------------------------------
    # Acesso externo
    # ------------------------------------------------------------------
    def disponibilizar_acesso_externo(
        self,
        protocolo_procedimento: Any,
        id_unidade: Any,
        *,
        email_unidade: str,
        destinatario: str,
        email_destinatario: str,
        motivo: str,
        tipo: str = "E",
        sin_inclusao: str = "S",
        series: str = "264",
        dias: str = "365",
        senha: str = "",
        id_contato: str = "",
        id_participante: str = "",
        id_usuario_externo: str = "",
        protocolos: str = "",
    ) -> dict:
        """Disponibiliza acesso externo a um processo no SEI.

        POST /processos/{protocoloProcedimento}/disponibilizacaoAcessoExterno

        Parâmetros:
            protocolo_procedimento: número do processo (com ou sem máscara)
            id_unidade: unidade que está disponibilizando
            email_unidade: email da unidade (ex.: sancionatorio.ecv.piv@detran.sp.gov.br)
            destinatario: nome do destinatário (razão social / nome do interessado)
            email_destinatario: email do destinatário
            motivo: motivo da disponibilização
            tipo: "E" = externo (acesso externo ao interessado)
            sin_inclusao: "S" = permite incluir documentos, "N" = somente visualização
            series: idSerie dos documentos que podem ser incluídos pelo externo
            dias: quantidade de dias de validade do acesso
            senha: token gerado pelo PlataformaSP
            id_contato: ID do contato no SEI (obtido via listar_contato)
            id_participante: ID do participante (geralmente vazio)
            id_usuario_externo: ID do usuário externo (geralmente vazio)
            protocolos: protocolos específicos para acesso (geralmente vazio)

        Retorno: resposta da API do SEI (estrutura depende da versão da API)
        """
        num = self.limpar_numero(protocolo_procedimento)
        url = f"{self.settings.api_base_norm}/processos/{num}/disponibilizacaoAcessoExterno"

        body = {
            "EmailUnidade": email_unidade,
            "Destinatario": destinatario,
            "EmailDestinatario": email_destinatario,
            "IdContato": id_contato,
            "IdParticipante": id_participante,
            "IdUsuarioExterno": id_usuario_externo,
            "Motivo": motivo,
            "Tipo": tipo,
            "SinInclusao": sin_inclusao,
            "Series": series,
            "Protocolos": protocolos,
            "Senha": senha,
            "Dias": dias,
        }

        def _chamar() -> dict:
            resp = self.session.post(
                url, headers=self._headers(id_unidade), json=body, timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()

        # Escrita: não repete automaticamente para evitar duplicações
        return self._executar(_chamar, pode_repetir=False)

    def listar_disponibilizacoes_acesso_externo(
        self,
        protocolo_procedimento: Any,
        id_unidade: Any,
    ) -> dict:
        """Lista as disponibilizações de acesso externo de um processo.

        GET /processos/{protocoloProcedimento}/disponibilizacaoAcessoExterno
        """
        num = self.limpar_numero(protocolo_procedimento)
        url = f"{self.settings.api_base_norm}/processos/{num}/disponibilizacaoAcessoExterno"

        def _chamar() -> dict:
            resp = self.session.get(
                url, headers=self._headers(id_unidade), timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()

        return self._executar(_chamar, pode_repetir=True)

    def cancelar_disponibilizacao_acesso_externo(
        self,
        protocolo_procedimento: Any,
        id_unidade: Any,
        id_disponibilizacao: str,
    ) -> None:
        """Cancela uma disponibilização de acesso externo.

        DELETE /processos/{protocoloProcedimento}/disponibilizacaoAcessoExterno/{idDisponibilizacao}
        """
        num = self.limpar_numero(protocolo_procedimento)
        url = (
            f"{self.settings.api_base_norm}/processos/{num}"
            f"/disponibilizacaoAcessoExterno/{id_disponibilizacao}"
        )

        def _chamar() -> None:
            resp = self.session.delete(
                url, headers=self._headers(id_unidade), timeout=self.timeout,
            )
            resp.raise_for_status()

        self._executar(_chamar, pode_repetir=False)

    # ------------------------------------------------------------------
    # Contatos (endpoint sei-parametros)
    # ------------------------------------------------------------------
    @property
    def _parametros_base(self) -> str:
        """Base URL para a API de parâmetros (sei-parametros.api.rota.sp.gov.br)."""
        return self.settings.api_base_norm.replace("sei-processos", "sei-parametros")

    def listar_series(self, id_unidade: Any) -> dict:
        """Tipos de documento (séries) disponíveis para a unidade.

        ``GET /series`` — o resultado varia por unidade, então descobrir todas
        as séries do órgão exige uma chamada por unidade. O ``idSerie`` obtido
        aqui é o que ``incluir_documento`` espera.
        """
        url = f"{self._parametros_base}/series"

        def _chamar() -> dict:
            resp = self.session.get(
                url, headers=self._headers(id_unidade), timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()

        return self._executar(_chamar, pode_repetir=True)

    def listar_contato(self, cpf: str, id_unidade: Any) -> dict:
        """Consulta um contato pelo CPF (somente números).

        GET /contatos?Cpf={cpf}

        Retorna o JSON da API. Espera-se que contenha idContato e dados do
        contato. Se não encontrar, retorna estrutura vazia ou lista vazia
        dependendo da versão da API.
        """
        cpf_limpo = "".join(c for c in cpf if c.isdigit())
        url = f"{self._parametros_base}/contatos"

        def _chamar() -> dict:
            resp = self.session.get(
                url,
                headers=self._headers(id_unidade),
                params={"Cpf": cpf_limpo},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()

        return self._executar(_chamar, pode_repetir=True)
