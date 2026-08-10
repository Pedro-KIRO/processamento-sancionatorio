"""Atualiza listaProcEmAndamento e listaFasesPA para todos os processos,
consultando a API SEI. Porte do fluxo Power Automate atualizarAssinatura."""
import argparse

import config
from graph_client import GraphClient
from sei_client import SeiClient
import logic


def _texto(valor):
    if valor is None:
        return ""
    if isinstance(valor, dict):
        for chave in ("Value", "value", "LookupValue", "Title"):
            if chave in valor:
                return str(valor[chave])
        return ""
    return str(valor).strip()


def _data_mudou(novo, atual):
    atual_txt = atual if isinstance(atual, str) else ""
    return novo[:10] != atual_txt[:10]


def _texto_mudou(novo, atual):
    return _texto(novo) != _texto(atual)


def montar_mapa_usuarios(graph, site_id):
    list_id = graph.get_list_id(site_id, config.LISTA_USUARIOS)
    itens = graph.get_all_items(site_id, list_id)
    mapa = {}
    for item in itens:
        campos = item.get("fields", {})
        agente = _texto(campos.get(config.COL_USUARIOS_AGENTE))
        unidade = _texto(campos.get(config.COL_USUARIOS_ID_UNIDADE))
        if agente and unidade and agente not in mapa:
            mapa[agente] = unidade
    return mapa


def carregar_descricoes_doc(graph, site_id):
    list_id = graph.get_list_id(site_id, config.LISTA_SEI_DESPACHOS)
    itens = graph.get_all_items(site_id, list_id)
    descricoes = []
    for item in itens:
        valor = _texto(item.get("fields", {}).get(config.COL_DESPACHOS_DESCRICAO))
        if valor and valor not in descricoes:
            descricoes.append(valor)
    return descricoes


def indexar_fases(graph, site_id):
    list_id = graph.get_list_id(site_id, config.LISTA_FASES_PA)
    itens = graph.get_all_items(site_id, list_id)
    indice = {}
    for item in itens:
        numero = _texto(item.get("fields", {}).get(config.COL_FASES_NUMERO_SEI))
        if numero:
            indice.setdefault(numero, []).append(item)
    return list_id, indice


def inspecionar(graph, site_id):
    print("Site ID:", site_id)
    listas = graph.get_lists(site_id)
    print("Listas disponiveis:")
    for nome in sorted(n for n in listas if n):
        print("  -", nome)
    proc_id = graph.get_list_id(site_id, config.LISTA_PROC_EM_ANDAMENTO)
    itens = graph.get_all_items(site_id, proc_id)
    print(f"\nlistaProcEmAndamento: {len(itens)} itens")
    if itens:
        print("Colunas do primeiro item:")
        for chave, valor in itens[0].get("fields", {}).items():
            print(f"  {chave} = {valor!r}")


def processar(graph, site_id, sei, dry_run, limite):
    descricoes_doc = carregar_descricoes_doc(graph, site_id)
    print(f"descricaoDOC carregadas: {len(descricoes_doc)}")
    mapa_usuarios = montar_mapa_usuarios(graph, site_id)
    print(f"usuarios (agente->idUnidade): {len(mapa_usuarios)}")
    fases_list_id, indice_fases = indexar_fases(graph, site_id)
    proc_list_id = graph.get_list_id(site_id, config.LISTA_PROC_EM_ANDAMENTO)
    proc_itens = graph.get_all_items(site_id, proc_list_id)
    print(f"listaProcEmAndamento: {len(proc_itens)} itens")

    total = 0
    atualizados = 0
    inalterados = 0
    pulados = 0
    erros = 0
    for item in proc_itens:
        if limite and total >= limite:
            break
        total += 1
        campos = item.get("fields", {})
        numero_sei = _texto(campos.get(config.COL_PROC_NUMERO_SEI))
        agente = _texto(campos.get(config.COL_PROC_AGENTE))
        id_unidade = mapa_usuarios.get(agente)
        if not numero_sei or not id_unidade:
            print(f"  [PULADO] numeroSEI={numero_sei!r} agente={agente!r} idUnidade={id_unidade!r}")
            pulados += 1
            continue
        try:
            num_limpo = logic.limpar_numero_sei(numero_sei)
            proc = sei.consultar_procedimento(num_limpo, id_unidade)
            id_proc = proc.get("idProcedimento")
            andamentos = sei.listar_andamentos(id_proc, id_unidade).get("Andamentos", [])
            data_situacao = logic.calcular_data_situacao(andamentos)
            fase_pa = logic.calcular_fase_pa(andamentos)
            data_instauracao = logic.calcular_data_instauracao(andamentos, descricoes_doc)
            print(f"  [{numero_sei}] situacao={data_situacao} fase={fase_pa!r} instauracao={data_instauracao}")
            proc_updates = {}
            if data_instauracao and _data_mudou(data_instauracao, campos.get(config.COL_PROC_DATA_INSTAURACAO)):
                proc_updates[config.COL_PROC_DATA_INSTAURACAO] = data_instauracao
            if data_situacao and _data_mudou(data_situacao, campos.get(config.COL_PROC_DATA_SITUACAO)):
                proc_updates[config.COL_PROC_DATA_SITUACAO] = data_situacao
            fase_ops = []
            for fase_item in indice_fases.get(numero_sei, []):
                fcampos = fase_item.get("fields", {})
                fases_updates = {}
                if fase_pa and _texto_mudou(fase_pa, fcampos.get(config.COL_FASES_FASE)):
                    fases_updates[config.COL_FASES_FASE] = fase_pa
                if data_situacao and _data_mudou(data_situacao, fcampos.get(config.COL_FASES_DATA)):
                    fases_updates[config.COL_FASES_DATA] = data_situacao
                if fases_updates:
                    fase_ops.append((fase_item["id"], fases_updates))
            if not dry_run:
                if proc_updates:
                    graph.update_item_fields(site_id, proc_list_id, item["id"], proc_updates)
                for fid, fu in fase_ops:
                    graph.update_item_fields(site_id, fases_list_id, fid, fu)
            if proc_updates or fase_ops:
                atualizados += 1
            else:
                inalterados += 1
        except Exception as exc:
            print(f"  [ERRO] {numero_sei}: {exc}")
            erros += 1

    print(f"\nResumo: total={total} atualizados={atualizados} inalterados={inalterados} pulados={pulados} erros={erros} (dry_run={dry_run})")


def main():
    parser = argparse.ArgumentParser(description="Atualiza listas SEI no SharePoint via Microsoft Graph.")
    parser.add_argument("--dry-run", action="store_true", help="Nao grava nada, apenas mostra o que faria.")
    parser.add_argument("--limit", type=int, default=0, help="Processa no maximo N itens (0 = todos).")
    parser.add_argument("--inspect", action="store_true", help="Mostra site, listas e colunas e sai.")
    args = parser.parse_args()

    graph = GraphClient(config.GRAPH_TENANT_ID, config.GRAPH_CLIENT_ID, config.GRAPH_CLIENT_SECRET)
    site_id = graph.get_site_id(config.SHAREPOINT_HOSTNAME, config.SHAREPOINT_SITE_PATH)

    if args.inspect:
        inspecionar(graph, site_id)
        return

    sei = SeiClient(
        config.SEI_TOKEN_URL,
        config.SEI_CLIENT_ID,
        config.SEI_CLIENT_SECRET,
        config.SEI_API_BASE,
        config.SEI_SIGLA_SISTEMA,
        config.SEI_IDENTIFICACAO_SERVICO,
        config.SEI_TRACE_ID,
    )
    processar(graph, site_id, sei, args.dry_run, args.limit)


if __name__ == "__main__":
    main()