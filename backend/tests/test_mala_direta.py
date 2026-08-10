"""Testes da mala direta: inventário de marcadores e preenchimento.

Os casos usam os marcadores que de fato aparecem nos textos-padrão da área
(levantamento de 185 arquivos, 918 ocorrências), não exemplos inventados.
"""
from datetime import date
from types import SimpleNamespace

from app.services import mala_direta as md


def _item(**kwargs):
    """Item de caixa de entrada mínimo, só com o que a mala direta lê."""
    base = dict(
        razao_social="Grajau Vistoria Veicular Ltda",
        cnpj_cpf="12.345.678/0001-99",
        numero_sei="140.00323068/2026-16",
        numero_processo_sei=None,
        municipio="Araraquara",
        data_inicio_fiscalizacao=date(2026, 6, 25),
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


# --- Detecção --------------------------------------------------------------
def test_sem_html_devolve_lista_vazia():
    assert md.detectar("") == []
    assert md.detectar(None) == []


def test_encontra_marcador_simples():
    marcadores = md.detectar("<p>Fulano [descrição] fim</p>")
    assert [m.token for m in marcadores] == ["[descrição]"]
    assert marcadores[0].rotulo == "descrição"


def test_preserva_a_ordem_do_documento():
    html = "<p>[NOME DA EMPRESA] e [NUMERO DO CPF] e [descrição]</p>"
    assert [m.rotulo for m in md.detectar(html)] == [
        "NOME DA EMPRESA", "NUMERO DO CPF", "descrição",
    ]


def test_cadastral_repetido_vira_um_campo_para_todas_as_ocorrencias():
    """Nome e link repetem o MESMO dado — perguntar três vezes seria absurdo.

    Caso real: [NOME DA EMPRESA] 4x no Despacho 141, [link sei] 6x nas certidões.
    """
    html = "<p>[NOME DA EMPRESA] ... [NOME DA EMPRESA] ... [NOME DA EMPRESA]</p>"
    marcadores = md.detectar(html)
    assert len(marcadores) == 1
    assert marcadores[0].total == 3
    assert marcadores[0].indice is None


def test_texto_repetido_vira_um_campo_so():
    """Não faz sentido ter três campos de descrição: o "+" resolve a quantidade."""
    html = "<p>1. [descrição] 2. [descrição] 3. [descrição]</p>"
    marcadores = md.detectar(html)
    assert len(marcadores) == 1
    assert marcadores[0].total == 3
    assert marcadores[0].indice is None
    assert marcadores[0].multivalor is True


def test_escolha_e_data_repetidas_tambem_viram_um_campo_so():
    html = "<p>[data por extenso] ... [data por extenso]</p>"
    marcadores = md.detectar(html)
    assert len(marcadores) == 1
    assert marcadores[0].total == 2


def test_instrucao_repetida_nao_se_multiplica():
    """Instrução não é campo; multiplicá-la só encheria o aviso de repetição."""
    html = "<p>[SE HOUVER] ... [SE HOUVER]</p>"
    marcadores = md.detectar(html)
    assert len(marcadores) == 1
    assert marcadores[0].total == 2


def test_normaliza_entidade_html_no_rotulo():
    """No banco o marcador vem escapado: [descri&ccedil;&atilde;o]."""
    marcadores = md.detectar("<p>[descri&ccedil;&atilde;o]</p>")
    assert marcadores[0].rotulo == "descrição"
    # O token guarda a forma literal, senão a substituição não casaria.
    assert marcadores[0].token == "[descri&ccedil;&atilde;o]"


def test_normaliza_tag_dentro_do_marcador():
    """Caso real dos modelos: [</strong>link Sei<strong>]."""
    marcadores = md.detectar("<p>[</strong>link Sei<strong>]</p>")
    assert marcadores[0].rotulo == "link Sei"
    assert marcadores[0].tipo == md.TIPO_CADASTRAL


# --- Classificação ---------------------------------------------------------
def test_classifica_alternativas_como_escolha():
    m1 = md.detectar("<p>[bloqueio/desbloqueio]</p>")[0]
    assert m1.tipo == md.TIPO_ESCOLHA
    assert m1.opcoes == ["bloqueio", "desbloqueio"]

    m2 = md.detectar("<p>[tempestiva /intempestiva]</p>")[0]
    assert m2.opcoes == ["tempestiva", "intempestiva"]

    m3 = md.detectar("<p>[remota ou in loco]</p>")[0]
    assert m3.tipo == md.TIPO_ESCOLHA
    assert m3.opcoes == ["remota", "in loco"]


def test_escolha_com_tres_alternativas_e_parenteses():
    rotulo = "[defesa prévia (15 dias) / alegações finais (7 dias) / recurso (15 dias)]"
    marcador = md.detectar(f"<p>{rotulo}</p>")[0]
    assert marcador.tipo == md.TIPO_ESCOLHA
    assert marcador.opcoes == [
        "defesa prévia (15 dias)", "alegações finais (7 dias)", "recurso (15 dias)",
    ]


def test_mascara_com_barra_nao_e_escolha():
    """[XX.XXX.XXX/XXXX] é máscara de CNPJ, não alternativa."""
    marcador = md.detectar("<p>[XX.XXX.XXX/XXXX]</p>")[0]
    assert marcador.tipo == md.TIPO_CADASTRAL
    assert marcador.opcoes == []


def test_classifica_instrucao_de_edicao():
    """Não é lacuna: é recado para quem redige, não pode virar campo."""
    casos = [
        "[SE HOUVER]",
        "[Se a fiscalização não teve acompanhante, excluir este parágrafo]",
        "[print da tela de bloqueio]",
        "[ou]",
    ]
    for caso in casos:
        marcador = md.detectar(f"<p>{caso}</p>")[0]
        assert marcador.tipo == md.TIPO_INSTRUCAO, caso
        assert marcador.preenchivel is False, caso


def test_classifica_texto_livre_e_data():
    assert md.detectar("<p>[inserir número da Ordem de Serviço]</p>")[0].tipo == md.TIPO_TEXTO
    assert md.detectar("<p>[data por extenso]</p>")[0].tipo == md.TIPO_DATA


# --- Sugestão a partir do cadastro ----------------------------------------
def test_sugere_razao_social_em_caixa_alta():
    """Padrão do projeto: razão social/nome sempre em caixa alta."""
    for rotulo in ("[NOME DA EMPRESA]", "[NOME COMPLETO]", "[NOME DA PESSOA FÍSICA]",
                   "[NOME MAÍUSCULO NEGRITADO]", "[NOME DO DESPACHANTE]"):
        marcador = md.detectar(f"<p>{rotulo}</p>", _item())[0]
        assert marcador.campo == "razao_social", rotulo
        assert marcador.valor_sugerido == "GRAJAU VISTORIA VEICULAR LTDA", rotulo


def test_sugere_documento_para_cpf_cnpj_e_mascaras():
    for rotulo in ("[NUMERO DO CPF]", "[CNPJ]", "[NNN.NNN.NNN-NN]", "[XX.XXX.XXX/XXXX]"):
        marcador = md.detectar(f"<p>{rotulo}</p>", _item())[0]
        assert marcador.campo == "cnpj_cpf", rotulo
        assert marcador.valor_sugerido == "12.345.678/0001-99", rotulo


def test_sugere_numero_do_processo_preferindo_o_processo_novo():
    html = "<p>[140.XXXXXXXXXXXXX]</p>"
    assert md.detectar(html, _item())[0].valor_sugerido == "140.00323068/2026-16"
    # Instaurado: o número que vale é o do processo sancionatório.
    item = _item(numero_processo_sei="140.00999999/2026-00")
    assert md.detectar(html, item)[0].valor_sugerido == "140.00999999/2026-00"


def test_sugere_data_da_fiscalizacao_por_extenso():
    marcador = md.detectar("<p>[inserir a data da fiscalização]</p>", _item())[0]
    assert marcador.valor_sugerido == "25 de junho de 2026"


def test_sugere_link_do_processo_quando_informado():
    marcador = md.detectar(
        "<p>[link sei]</p>", _item(), link_processo="<a href='x'>140.00323068/2026-16</a>",
    )[0]
    assert marcador.campo == "link_processo"
    assert marcador.valor_sugerido == "<a href='x'>140.00323068/2026-16</a>"


def test_sem_item_nao_sugere_valor():
    marcador = md.detectar("<p>[NOME DA EMPRESA]</p>")[0]
    assert marcador.campo == "razao_social"
    assert marcador.valor_sugerido is None


def test_campo_vazio_no_cadastro_nao_vira_sugestao_em_branco():
    marcador = md.detectar("<p>[NOME DA EMPRESA]</p>", _item(razao_social=None))[0]
    assert marcador.valor_sugerido is None


# --- Aplicação -------------------------------------------------------------
def _aplicar(html, valores_por_rotulo, item=None):
    """Aplica usando o rótulo como atalho, para o teste ficar legível.

    Na vida real a chave é o ``id`` do marcador; aqui traduzimos rótulo -> id.
    Quando o marcador repete, a chave é "rótulo#posição".
    """
    marcadores = md.detectar(html, item)
    ids = {}
    for m in marcadores:
        ids[m.rotulo if m.indice is None else f"{m.rotulo}#{m.indice}"] = m.id
    valores = {ids[k]: v for k, v in valores_por_rotulo.items()}
    return md.aplicar(html, marcadores, valores)


def test_valor_unico_entra_em_todas_as_ocorrencias():
    html = "<p>[NOME DA EMPRESA] contra [NOME DA EMPRESA]</p>"
    assert _aplicar(html, {"NOME DA EMPRESA": "EMPRESA X"}) == (
        "<p>EMPRESA X contra EMPRESA X</p>"
    )


def test_cada_ocorrencia_recebe_o_proprio_valor():
    """O caso das três condutas do termo de instauração, numeração sequencial."""
    html = "<p>[descrição] [descrição] [descrição]</p>"
    resultado = _aplicar(html, {
        "descrição": ["piso irregular", "extintor vencido", "falta de sinalização"],
    })
    assert resultado == (
        "<p>1. piso irregular 2. extintor vencido 3. falta de sinalização</p>"
    )


def test_mais_itens_que_posicoes_reune_na_ultima():
    """Se o analista adicionou 5 itens mas o modelo só tem 3 lacunas."""
    html = "<p>[descrição] [descrição] [descrição]</p>"
    resultado = _aplicar(html, {
        "descrição": ["um", "dois", "três", "quatro", "cinco"],
    })
    assert resultado == (
        "<p>1. um 2. dois 3. três; 4. quatro; 5. cinco</p>"
    )


def test_menos_itens_que_posicoes_suprime_as_sobras():
    """Se o analista informou só 1 conduta mas o modelo tem 3 lacunas."""
    html = "<p>[descrição] [descrição] [descrição]</p>"
    resultado = _aplicar(html, {"descrição": ["piso irregular"]})
    assert resultado == "<p>1. piso irregular  </p>"


def test_numeracao_sequencial_apos_excluir_e_adicionar():
    """Removeu o item 2 e adicionou outro: a numeração sai 1, 2, não 1, 3."""
    html = "<p>[descrição] [descrição]</p>"
    resultado = _aplicar(html, {"descrição": ["piso irregular", "falta de sinalização"]})
    assert resultado == "<p>1. piso irregular 2. falta de sinalização</p>"


def test_ocorrencia_em_branco_no_meio_mantem_so_aquela_lacuna():
    """Preencher a 1ª e a 3ª, mas a 2ª vazia — nesse modelo um campo só, sem "branco no meio"."""
    html = "<p>[descrição] [descrição] [descrição]</p>"
    # Com o novo modelo é um campo: todas as condutas são itens de uma lista.
    resultado = _aplicar(html, {"descrição": ["piso", "extintor"]})
    assert "1. piso" in resultado
    assert "2. extintor" in resultado


def test_aplica_respeita_o_token_literal_com_entidade():
    html = "<p>[descri&ccedil;&atilde;o]</p>"
    assert _aplicar(html, {"descrição": "furo no piso"}) == "<p>furo no piso</p>"


def test_valor_vazio_mantem_o_marcador_visivel():
    """Buraco silencioso no documento é pior que a lacuna aparente no editor."""
    html = "<p>[descrição] e [NN]</p>"
    assert _aplicar(html, {"descrição": "", "NN": "   "}) == html


def test_marcador_nao_informado_fica_como_esta():
    html = "<p>[descrição] e [NN]</p>"
    assert _aplicar(html, {"descrição": "1"}) == "<p>1 e [NN]</p>"


def test_aplicar_sem_valores_devolve_o_html_original():
    html = "<p>[descrição]</p>"
    assert md.aplicar(html, md.detectar(html), {}) == html
    assert md.aplicar("", [], {"m0": "1"}) == ""


# --- Resumo ----------------------------------------------------------------
def test_resumo_separa_preenchiveis_de_instrucoes():
    html = (
        "<p>[NOME DA EMPRESA] [descrição] [bloqueio/desbloqueio] "
        "[SE HOUVER] [Se a fiscalização não teve acompanhante, excluir este parágrafo]</p>"
    )
    r = md.resumo(md.detectar(html, _item()))
    assert r["total"] == 5
    assert r["instrucoes"] == 2
    assert r["preenchiveis"] == 3
    # Só a razão social já vem do cadastro; descrição e escolha faltam.
    assert r["sem_sugestao"] == 2


# --- Integração com os modelos reais do banco -----------------------------
def test_marcadores_reais_dos_textos_padroes_sao_classificados():
    """Amostra real: nenhum marcador conhecido pode cair em tipo errado."""
    # Marcadores cadastrais que apontam para o mesmo campo são agrupados
    # (ex.: [NOME DA EMPRESA] e [NOME COMPLETO] viram um campo só).
    # Testamos cada um isoladamente para verificar o tipo.
    esperado = {
        "[NOME DA EMPRESA]": md.TIPO_CADASTRAL,
        "[NOME DA PESSOA FÍSICA]": md.TIPO_CADASTRAL,
        "[NOME COMPLETO]": md.TIPO_CADASTRAL,
        "[NUMERO DO CPF]": md.TIPO_CADASTRAL,
        "[link]": md.TIPO_CADASTRAL,
        "[link sei]": md.TIPO_CADASTRAL,
        "[140.XXXXXXXXXXXXX]": md.TIPO_CADASTRAL,
        "[bloqueio/desbloqueio]": md.TIPO_ESCOLHA,
        "[citação/intimação/notificação]": md.TIPO_ESCOLHA,
        "[remota ou in loco]": md.TIPO_ESCOLHA,
        "[data por extenso]": md.TIPO_DATA,
        "[data da visualização]": md.TIPO_DATA,
        "[descrição]": md.TIPO_TEXTO,
        "[NN]": md.TIPO_TEXTO,
        "[indicar]": md.TIPO_TEXTO,
        "[inserir número da Ordem de Serviço]": md.TIPO_TEXTO,
        "[SE HOUVER]": md.TIPO_INSTRUCAO,
        "[ou]": md.TIPO_INSTRUCAO,
    }
    for token, tipo_esperado in esperado.items():
        html = f"<p>{token}</p>"
        marcadores = md.detectar(html, _item())
        assert len(marcadores) == 1, token
        assert marcadores[0].tipo == tipo_esperado, f"{token}: esperado {tipo_esperado}, obteve {marcadores[0].tipo}"


# --- Casos corrigidos após rodar contra os 209 modelos reais do banco ------
# Cada um destes estava classificado errado na primeira versão do detector.
def test_oab_nao_pode_receber_o_documento_do_agente():
    """[XXX.XXX] é o número da OAB do procurador, não CPF/CNPJ.

    Era o erro mais grave: preenchia o CNPJ do agente no campo da OAB.
    """
    for rotulo in ("[XXX.XXX]", "[xxx.xxx]"):
        marcador = md.detectar(f"<p>{rotulo}</p>", _item())[0]
        assert marcador.tipo == md.TIPO_TEXTO, rotulo
        assert marcador.campo is None, rotulo
        assert marcador.valor_sugerido is None, rotulo


def test_mascaras_de_documento_continuam_reconhecidas():
    """A correção da OAB não pode derrubar as máscaras de verdade."""
    for rotulo in ("[NNN.NNN.NNN-NN]", "[XX.XXX.XXX/XXXX]", "[NN.NNN.NNN/NNNN-NN]"):
        marcador = md.detectar(f"<p>{rotulo}</p>", _item())[0]
        assert marcador.campo == "cnpj_cpf", rotulo


def test_numero_do_processo_com_indicador_ordinal():
    """O rótulo real é "nº do processo" — o "º" precisa sair da comparação."""
    marcador = md.detectar("<p>[nº do processo]</p>", _item())[0]
    assert marcador.campo == "numero_processo"
    assert marcador.valor_sugerido == "140.00323068/2026-16"


def test_nao_constituido_e_instrucao():
    """Chave é comparada sem acento: "NÃO CONSTITUÍDO" -> "nao constituido"."""
    marcador = md.detectar("<p>[NÃO CONSTITUÍDO]</p>")[0]
    assert marcador.tipo == md.TIPO_INSTRUCAO


def test_instrucao_de_adotar_conforme_a_data_nao_e_escolha():
    """A data no fim do texto tem barra e fazia o marcador virar menu de opções."""
    rotulo = "[adotar quando a data da fiscalização for a partir de 28/03/2022]"
    marcador = md.detectar(f"<p>{rotulo}</p>")[0]
    assert marcador.tipo == md.TIPO_INSTRUCAO
    assert marcador.opcoes == []


def test_condicao_no_meio_do_rotulo_nao_transforma_campo_em_instrucao():
    """"Nome da Empresa (e vistoriador, se houver)" é campo de nome.

    A busca por "se houver" em qualquer posição jogava este marcador para
    instrução; agora o termo só conta no início.
    """
    marcador = md.detectar("<p>[Nome da Empresa (e vistoriador, se houver)]</p>", _item())[0]
    assert marcador.tipo == md.TIPO_CADASTRAL
    assert marcador.valor_sugerido == "GRAJAU VISTORIA VEICULAR LTDA"


def test_sancao_com_barras_continua_sendo_escolha():
    rotulo = "[ADVERTÊNCIA POR ESCRITO/SUSPENSÃO DAS ATIVIDADES POR 30 (TRINTA) DIAS]"
    marcador = md.detectar(f"<p>{rotulo}</p>")[0]
    assert marcador.tipo == md.TIPO_ESCOLHA
    assert len(marcador.opcoes) == 2


def test_barra_de_sigla_nao_separa_alternativa():
    """O parágrafo do procurador cita "OAB/SP" e virava menu de duas opções."""
    rotulo = (
        "[e por meio do(a) seu(ua) Procurador(a) constituído(a) nos autos xxxx, "
        "inscrito(a) na OAB/SP sob o nº xxx.xxx]"
    )
    marcador = md.detectar(f"<p>{rotulo}</p>")[0]
    assert marcador.tipo != md.TIPO_ESCOLHA
    assert marcador.opcoes == []


def test_sigla_com_barra_preservada_quando_ha_alternativa_de_verdade():
    """"citação/intimação/notificação" continua escolha, com as três opções."""
    marcador = md.detectar("<p>[citação/intimação/notificação]</p>")[0]
    assert marcador.tipo == md.TIPO_ESCOLHA
    assert marcador.opcoes == ["citação", "intimação", "notificação"]


# --- Contexto: qual das lacunas é esta? ------------------------------------
# No termo de instauração as três ocorrências de [descrição] têm finalidades
# diferentes, escritas logo depois de cada uma. O rótulo "descrição (2 de 3)"
# não bastava para o analista saber o que preencher.
def test_contexto_mostra_a_vizinhanca_da_lacuna():
    html = (
        "<p>1 [descrição] [Citar irregularidades segundo relatório de fiscalização];</p>"
        "<p>2. [descrição] [CITAR se há outro processo em andamento];</p>"
    )
    # O colchete de instrução ao lado é um marcador próprio — aqui olhamos só as
    # ocorrências de [descrição], que agora viram um campo só.
    marcadores = [m for m in md.detectar(html) if m.rotulo == "descrição"]
    assert len(marcadores) == 1
    primeiro = marcadores[0]
    assert "___" in primeiro.contexto
    assert "Citar irregularidades" in primeiro.contexto


def test_contexto_vem_sem_tag_nem_entidade():
    html = "<p><span>1 [descri&ccedil;&atilde;o] [Citar irregularidades]</span></p>"
    contexto = md.detectar(html)[0].contexto
    assert "<span>" not in contexto
    assert "&ccedil;" not in contexto
    assert "Citar irregularidades" in contexto


def test_marcador_de_valor_unico_tambem_tem_contexto():
    marcador = md.detectar("<p>Empresa [NOME DA EMPRESA], inscrita no CNPJ</p>", _item())[0]
    assert "Empresa ___ , inscrita no CNPJ" in marcador.contexto


# --- Quantidade livre de valores ------------------------------------------
# A quantidade vem do caso, não do modelo: são várias irregularidades, vários
# sócios, vários vistoriadores.
def test_campo_livre_aceita_mais_de_um_valor():
    assert md.detectar("<p>[descrição]</p>")[0].multivalor is True
    assert md.detectar("<p>[Nome do vistoriador]</p>")[0].multivalor is True


def test_cadastral_e_escolha_tem_valor_unico():
    assert md.detectar("<p>[NOME DA EMPRESA]</p>")[0].multivalor is False
    assert md.detectar("<p>[bloqueio/desbloqueio]</p>")[0].multivalor is False


def test_varios_valores_viram_frase_em_linguagem_natural():
    """Token que aparece 1x: a lacuna fica dentro de um período. Junção natural."""
    html = "<p>Constatou-se [descrição].</p>"
    resultado = _aplicar(html, {
        "descrição": ["piso irregular", "extintor vencido", "falta de sinalização"],
    })
    assert resultado == (
        "<p>Constatou-se piso irregular, extintor vencido e falta de sinalização.</p>"
    )


def test_dois_valores_usam_apenas_o_e():
    assert _aplicar(
        "<p>[descrição]</p>", {"descrição": ["um", "dois"]},
    ) == "<p>um e dois</p>"


def test_um_valor_so_entra_sozinho():
    assert _aplicar("<p>[descrição]</p>", {"descrição": ["piso irregular"]}) == (
        "<p>piso irregular</p>"
    )


def test_valor_em_branco_na_lista_e_descartado():
    resultado = _aplicar("<p>[descrição]</p>", {"descrição": ["um", "", "  ", "dois"]})
    assert resultado == "<p>um e dois</p>"


def test_lista_toda_em_branco_mantem_a_lacuna():
    html = "<p>[descrição]</p>"
    assert _aplicar(html, {"descrição": ["", "  "]}) == html


# --- Nome de terceiro não é a razão social --------------------------------
# Eram 30 ocorrências recebendo o nome da empresa no lugar do nome de uma
# pessoa: sócio-administrador, vistoriador, responsável, diretor.
def test_nome_de_terceiro_nao_recebe_a_razao_social():
    casos = [
        "[Nome do vistoriador]",
        "[NOME DO SÓCIO-ADMINISTRADOR]",
        "[inserir o nome completo do sócio-administrador (proprietário) da empresa]",
        "[indicar o nome completo do responsável da empresa pelo acompanhamento]",
        "[e o vistoriador Nome Pessoa Física]",
    ]
    for caso in casos:
        marcador = md.detectar(f"<p>{caso}</p>", _item())[0]
        assert marcador.campo is None, caso
        assert marcador.valor_sugerido is None, caso
        # Vira campo livre, e aceita mais de um (dois sócios, dois vistoriadores).
        assert marcador.multivalor is True, caso


def test_nome_do_agente_continua_vindo_do_cadastro():
    """A ressalva acima não pode derrubar o nome do próprio agente."""
    casos = [
        "[NOME DA EMPRESA]",
        "[NOME COMPLETO]",
        "[NOME DA PESSOA FÍSICA]",
        # Despachante e perito SÃO o agente regulado nesses segmentos.
        "[NOME DO DESPACHANTE]",
        # Pede o nome da empresa, mencionando o vistoriador de passagem.
        "[Nome da Empresa (e vistoriador, se houver)]",
    ]
    for caso in casos:
        marcador = md.detectar(f"<p>{caso}</p>", _item())[0]
        assert marcador.campo == "razao_social", caso
        assert marcador.valor_sugerido == "GRAJAU VISTORIA VEICULAR LTDA", caso


# --- Deduplicação de campos cadastrais ------------------------------------
def test_tokens_diferentes_mesmo_campo_viram_um_campo_so():
    """[Nome da empresa minúsculo] e [NOME DA EMPRESA] são ambos razão social."""
    html = "<p>[Nome da empresa minúsculo] e [NOME DA EMPRESA]</p>"
    marcadores = md.detectar(html, _item())
    # Um campo só no formulário.
    assert len(marcadores) == 1
    assert marcadores[0].campo == "razao_social"
    assert "[NOME DA EMPRESA]" in marcadores[0].tokens_extras


def test_substituicao_preenche_todos_os_tokens_do_mesmo_campo():
    html = "<p>[Nome da empresa minúsculo] e [NOME DA EMPRESA]</p>"
    marcadores = md.detectar(html, _item())
    resultado = md.aplicar(html, marcadores, {marcadores[0].id: "EMPRESA X"})
    assert resultado == "<p>EMPRESA X e EMPRESA X</p>"
