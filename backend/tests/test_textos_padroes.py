"""Testes da limpeza dos textos-padrão do SEI.

O que importa aqui é o que **não** pode sobrar: timbre, cabeçalho institucional,
faixa de autoria e bloco de assinatura. O SEI aplica os quatro sozinho ao criar
o documento — o cabeçalho vem do tipo escolhido e a assinatura de quem assina.
Se algum deles passar, o documento sai com cabeçalho duplicado, com o nome de
quem redigiu o modelo no rodapé ou com duas assinaturas.

O texto do modelo termina na linha "São Paulo, <data>", que precisa ficar.
"""
import re
from datetime import date

from app.services.textos_padroes import extrair_corpo, preencher_variaveis

CABECALHO = (
    '<p class="Titulo_centralizado_maiusculas" style="margin-top: 5px;">'
    '<img alt="Timbre" src="data:image/png;base64,iVBORw0KGgoAAAA"></p>\n'
    '<p class="Titulo_centralizado_maiusculas">Governo do Estado de São Paulo</p>\n'
    '<p class="Titulo_centralizado_maiusculas">DEPARTAMENTO ESTADUAL DE TRÂNSITO</p>\n'
    '<p class="Titulo_centralizado_maiusculas">'
    'Coordenadoria de Processamento Sancionatório dos Agentes Regulados</p>\n'
    '<p class="Texto_Justificado_Recuo_Primeira_Linha">&nbsp;</p>\n'
)

RODAPE = (
    '<div unselectable="on" style="-webkit-touch-callout:none;">\n'
    '<hr style="border:1px solid #c0c0c0;">Criado por '
    '<a onclick="alert(\'YAN CARVALHO SILVA\')">07631639531</a>, versão 2 em 26/03/2026 14:51:52.\n'
    '</div>\n'
)

CORPO = (
    '<p class="Texto_Centralizado_Maiusculas"><strong>Termo de encerramento</strong></p>\n'
    '<p class="Texto_Justificado_Recuo_Primeira_Linha">Nesta data, '
    '<strong>encerrou-se o documento SEI n° 140.00146432/2026-18</strong>.</p>\n'
    '<p class="Texto_Alinhado_Direita">São Paulo, @dia@ de @mes_extenso@ de @ano@.</p>\n'
)


def _documento(corpo: str = CORPO, com_numero_no_topo: bool = False) -> str:
    topo = '<p class="Texto_Alinhado_Direita">140.00146432/2026-18</p>\n' if com_numero_no_topo else ""
    return f"<body>\n{topo}{CABECALHO}{corpo}{RODAPE}</body>"


class TestExtrairCorpo:
    def test_remove_timbre_e_cabecalho_institucional(self):
        corpo = extrair_corpo(_documento())

        assert "Timbre" not in corpo
        assert "base64" not in corpo
        assert "Governo do Estado" not in corpo
        assert "DEPARTAMENTO ESTADUAL" not in corpo

    def test_remove_rodape_de_autoria(self):
        corpo = extrair_corpo(_documento())

        assert "Criado por" not in corpo
        assert "unselectable" not in corpo
        assert "07631639531" not in corpo

    def test_preserva_o_corpo_e_as_classes_de_estilo_do_sei(self):
        corpo = extrair_corpo(_documento())

        assert "encerrou-se o documento SEI" in corpo
        assert "Texto_Justificado_Recuo_Primeira_Linha" in corpo
        assert "@dia@ de @mes_extenso@ de @ano@" in corpo

    def test_remove_o_titulo_do_documento(self):
        """O SEI aplica o título a partir do `idSerie` informado na criação."""
        corpo = extrair_corpo(_documento())

        assert "Termo de encerramento" not in corpo
        assert "encerrou-se o documento SEI" in corpo

    def test_remove_titulo_em_qualquer_caixa(self):
        for titulo in ("TERMO de instauração", "Certidão", "NOTIFICAÇÃO", "Relatório"):
            corpo = extrair_corpo(
                f'<body><p class="Texto_Centralizado_Maiusculas"><strong>{titulo}'
                "</strong></p><p>CERTIFICO que nada consta.</p></body>"
            )

            assert titulo not in corpo
            assert "CERTIFICO que nada consta." in corpo

    def test_remove_o_titulo_com_a_identificacao_do_ato(self):
        """Mesma coisa que o título puro, com o número e a data atrás."""
        for linha in (
            "DECISÃO DETRAN-SP nº 2500, de 29 de julho de 2026",
            "Despacho nº 47/2026-DETRAN/DGR/CPSAR/DSPSD/DPSARC",
            "PORTARIA DETRAN-SP Nº 0115855345, DE 29 DE julho DE 2026",
            "PORTARIA DETRAN-SP Nº xxxxxxx, DE 29 DE julho DE 2026",
            "EDITAL DETRAN-SP nº 508, de 28 de julho de 2026",
            "termo de ajuste de conduta deTRAN-SP nº 426, de 29 de julho de 2026",
        ):
            corpo = extrair_corpo(
                f'<body><p class="Texto_Justificado">{linha}</p>'
                "<p>Texto do ato.</p></body>"
            )

            assert linha not in corpo
            assert "Texto do ato." in corpo

    def test_nao_confunde_citacao_de_documento_com_titulo(self):
        """O casamento é no parágrafo inteiro, não em prefixo."""
        for linha in (
            "Certidão nº 4 juntada aos autos, conforme se verifica.",
            "nos termos da Resolução CONTRAN nº 941, de 2022.",
            "Art. 4º Esta Portaria entra em vigor na data de sua publicação.",
        ):
            corpo = extrair_corpo(f"<body><p>{linha}</p></body>")

            assert linha in corpo

    def test_remove_marca_de_agua_de_minuta_do_editor(self):
        """Estamparia "MINUTA" na diagonal sobre o ato assinado."""
        ancora = (
            '<p class="Texto_Alinhado_Esquerda"><span class="minutaAncora" '
            'contenteditable="false" data-type="manual"><a class="ancoraSei">'
            '<style data-style="seipro-watermark" type="text/css">'
            'body:after { content: "MINUTA"; position: fixed; }</style>'
            "* MINUTA DE DOCUMENTO </a> </span></p>"
        )
        corpo = extrair_corpo(
            f"<body>{ancora}<p>O COORDENADOR, no uso das atribuições.</p></body>"
        )

        assert "MINUTA" not in corpo
        assert "minutaAncora" not in corpo
        assert "<style" not in corpo
        assert "O COORDENADOR, no uso das atribuições." in corpo

    def test_preserva_link_interno_do_sei_no_meio_do_texto(self):
        """`ancora_sei` é citação de documento, diferente da âncora de minuta."""
        link = (
            '<span contenteditable="false"><a class="ancora_sei" '
            'id="lnkSei101600657" href="https://sei.sp.gov.br/sei/controlador.php">'
            "0086011657</a></span>"
        )
        corpo = extrair_corpo(
            f"<body><p>acolhido pelo parecer conclusivo {link} emitido pelo "
            "Chefe de Divisão</p></body>"
        )

        assert "0086011657" in corpo
        assert "ancora_sei" in corpo

    def test_remove_numero_do_processo_isolado_no_topo(self):
        corpo = extrair_corpo(_documento(com_numero_no_topo=True))

        # O número do topo é cabeçalho e sai; o que está no meio da frase fica,
        # para ser substituído pelo número real na hora de gerar o documento.
        assert not corpo.lstrip().startswith('<p class="Texto_Alinhado_Direita">140.')
        assert "encerrou-se o documento SEI" in corpo

    def test_nao_remove_coordenadoria_citada_no_meio_do_texto(self):
        corpo_com_citacao = (
            '<p class="Texto_Justificado">Encaminhe-se à '
            'Coordenadoria de Processamento Sancionatório para providências.</p>\n'
        )
        corpo = extrair_corpo(_documento(corpo=corpo_com_citacao))

        assert "Coordenadoria de Processamento Sancionatório para providências" in corpo

    def test_documento_vazio_nao_quebra(self):
        assert extrair_corpo("") == ""
        assert extrair_corpo("<body></body>") == ""

    def test_nao_deixa_tag_de_fechamento_sem_o_sinal_de_menor(self):
        """O corte é por posição, e não por remontagem de pedaços.

        Os modelos vêm com <div> aninhadas. Juntar trechos casados por
        expressão regular perdia o "<" das tags de fechamento que sobravam
        entre os pedaços, e o documento saía com "/div>" como texto visível.
        """
        aninhado = (
            "<div>\n<div>\n"
            '<p class="Texto_Justificado">Despacho nº 47/2026</p>\n'
            "</div>\n</div>\n"
        )
        corpo = extrair_corpo(f"<body>{CABECALHO}{aninhado}{RODAPE}</body>")

        assert not re.search(r"(?<!<)/(?:div|p|span)>", corpo)
        assert corpo.count("<div>") == corpo.count("</div>")

    def test_remove_cabecalho_escrito_com_entidades_html(self):
        """A API do SEI devolve ``S&atilde;o Paulo``, não ``São Paulo``."""
        cabecalho = (
            '<p class="Titulo_centralizado_maiusculas">'
            "Governo do Estado de S&atilde;o Paulo</p>\n"
            '<p class="Titulo_centralizado_maiusculas">'
            "DEPARTAMENTO ESTADUAL DE TR&Acirc;NSITO</p>\n"
            '<p class="Titulo_centralizado_maiusculas">'
            "Divis&atilde;o de Processamento Sancionat&oacute;rio</p>\n"
        )
        corpo = extrair_corpo(
            f'<body>{cabecalho}<p class="Texto_Justificado">'
            "PROCESSO ADMINISTRATIVO N&ordm;: @processo@</p></body>"
        )

        assert "Governo do Estado" not in corpo
        assert "DEPARTAMENTO ESTADUAL" not in corpo
        assert corpo.lstrip().startswith('<p class="Texto_Justificado">PROCESSO')


class TestRemoverAssinatura:
    """O SEI monta a assinatura a partir de quem assina o documento."""

    DATA = '<p class="Texto_Alinhado_Direita">São Paulo, @dia@ de @mes_extenso@ de @ano@.</p>'

    def _corpo(self, assinatura: str) -> str:
        return extrair_corpo(f"<body>{self.DATA}{assinatura}</body>")

    def test_remove_rotulo_e_cargo_em_paragrafos_separados(self):
        corpo = self._corpo(
            '<p class="Tabela_Texto_Centralizado">RESPONSÁVEL</p>'
            '<p class="Tabela_Texto_Centralizado">Chefe de Serviço</p>'
        )

        assert "RESPONSÁVEL" not in corpo
        assert "Chefe de Serviço" not in corpo
        assert "São Paulo, @dia@ de @mes_extenso@ de @ano@." in corpo

    def test_remove_rotulo_e_cargo_separados_por_br(self):
        corpo = self._corpo(
            '<p class="Texto_Centralizado">RESPONSÁVEL<br />\nChefe de Divisão</p>'
        )

        assert "RESPONSÁVEL" not in corpo
        assert "Chefe de Divisão" not in corpo

    def test_remove_rotulo_e_cargo_no_mesmo_trecho_de_texto(self):
        """Parte dos modelos separa os dois só com <span>, sem <br>."""
        corpo = self._corpo(
            '<p class="Texto_Centralizado"><span>RESPONSÁVEL </span>'
            "<span>Chefe de Divisão</span></p>"
        )

        assert "RESPONSÁVEL" not in corpo
        assert "Chefe de Divisão" not in corpo

    def test_remove_nome_de_pessoa_e_cargo_completo(self):
        corpo = self._corpo(
            "<p>ALINE DAISY CRISTINA MOTA MARQUES</p>"
            "<p>Coordenador Geral de Gestão de Agentes e Atividades Reguladas</p>"
        )

        assert "ALINE" not in corpo
        assert "Coordenador Geral" not in corpo

    def test_remove_marcadores_nome_e_cargo_do_usuario(self):
        corpo = self._corpo("<p>NOME</p><p>@cargo_usuario@</p>")

        assert "NOME" not in corpo
        assert "@cargo_usuario@" not in corpo

    def test_atravessa_paragrafos_de_espacamento(self):
        """Entre a data e a assinatura vêm <p>&nbsp;</p> e <p><br></p>."""
        corpo = self._corpo(
            "<p>&nbsp;</p><p><br /></p><p>YAN CARVALHO SILVA</p><p>Chefe de Divisão</p>"
        )

        assert "YAN CARVALHO SILVA" not in corpo
        assert "Chefe de Divisão" not in corpo

    def test_preserva_despacho_de_segundo_nivel_depois_da_assinatura(self):
        """Nos despachos de dois níveis há texto real depois da 1ª assinatura.

        Cortar o documento a partir da data levaria embora o "de acordo" da
        autoridade superior.
        """
        corpo = extrair_corpo(
            f"<body>{self.DATA}"
            "<p>RESPONSÁVEL</p><p>Chefe de Serviço</p>"
            '<p class="Texto_Justificado">À vista da manifestação do Chefe de '
            "Serviço, a qual acolho, ARQUIVE-SE.</p>"
            "<p>ERIC WETTER GOMES DE SOUZA</p><p>Diretor de Gestão Regulatória</p>"
            "</body>"
        )

        assert "a qual acolho, ARQUIVE-SE" in corpo
        assert "ERIC WETTER" not in corpo
        assert "Diretor de Gestão" not in corpo
        # A assinatura do primeiro nível fica: o SEI só acrescenta uma, no fim.
        assert "Chefe de Serviço, a qual acolho" in corpo

    def test_nao_remove_conteudo_real_no_fim(self):
        corpo = extrair_corpo(
            "<body><p>Art. 4º Esta Portaria entra em vigor na data de sua "
            "publicação.</p><p>Publique-se.</p></body>"
        )

        assert "Art. 4º" in corpo
        assert "Publique-se." in corpo

    def test_nao_remove_frase_em_maiusculas_com_pontuacao(self):
        corpo = extrair_corpo("<body><p>Publique-se.</p><p>ARQUIVE-SE</p></body>")

        assert "ARQUIVE-SE" in corpo


class TestPreencherVariaveis:
    def test_troca_data_por_extenso(self):
        html = preencher_variaveis(
            "<p>São Paulo, @dia@ de @mes_extenso@ de @ano@.</p>", hoje=date(2026, 3, 9),
        )

        assert html == "<p>São Paulo, 09 de março de 2026.</p>"

    def test_troca_numero_do_exemplo_pelo_numero_real(self):
        html = preencher_variaveis(
            "<p>encerrou-se o documento SEI n° 140.00146432/2026-18</p>",
            numero_processo="140.00999999/2026-01",
        )

        assert "140.00999999/2026-01" in html
        assert "140.00146432/2026-18" not in html

    def test_razao_social_em_maiusculas(self):
        html = preencher_variaveis("<p>@razao_social@</p>", razao_social="Autoescola Exemplo Ltda")

        assert html == "<p>AUTOESCOLA EXEMPLO LTDA</p>"

    def test_marcador_sem_dado_permanece_para_o_analista_preencher(self):
        html = preencher_variaveis("<p>Prazo de @dias_prazo@ dias.</p>")

        assert "@dias_prazo@" in html


class TestMarcadoresDosModelos:
    """Os modelos vêm de um documento real e trazem dados dele no texto."""

    def test_numero_do_documento_original_vira_marcador(self):
        html = preencher_variaveis(
            '<p>Despacho nº 77/2026-DETRAN/DGR/CPSAR</p>', hoje=date(2026, 5, 1),
        )

        # Manter "77" faria todo saneador sair com o número do modelo.
        assert "77/2026" not in html
        assert "@numero_documento@/2026" in html

    def test_nao_altera_citacao_de_norma(self):
        original = "<p>nos termos da Resolução CONTRAN nº 941, de 2022.</p>"

        assert preencher_variaveis(original) == original

    def test_corrida_de_xis_vira_razao_social(self):
        html = preencher_variaveis(
            "<p>praticadas pela empresa XXXXXXXXXXXXXX, já qualificada</p>",
            razao_social="Vistoria Exemplo Ltda",
        )

        assert "VISTORIA EXEMPLO LTDA" in html
        assert "XXXXXX" not in html

    def test_sem_razao_social_o_marcador_permanece(self):
        html = preencher_variaveis("<p>empresa XXXXXXXXXXXXXX</p>")

        assert "XXXXXXXXXXXXXX" in html
