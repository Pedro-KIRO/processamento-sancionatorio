"""Insere um item FICTÍCIO na tela de Cautelares, para teste visual.

Uso (a partir de backend/):
    python scripts/seed_cautelar_demo.py            # cria/atualiza o item
    python scripts/seed_cautelar_demo.py --remover   # apaga o item

Por que um script próprio e não o `seed_dev.py`: aquele apaga a tabela
`caixa_entrada` inteira antes de semear, o que destruiria os dados reais da
varredura. Este é aditivo — mexe só nas linhas com o protocolo fictício abaixo.

O item nasce no estado mais representativo da tela: medida já concordada pelo
Coordenador Geral, bloqueio ativo e vencimento dentro dos 3 dias, o que acende o
semáforo amarelo e o cartão "Vencendo". Assim uma única linha exercita o
semáforo, a contagem regressiva e as ações de renovar e revogar.

A cautelar depende de um item da `caixa_entrada`: é de lá que a tela tira número
SEI, razão social, CNPJ e segmento. Por isso o script cria os dois.

O item fica com `status_triagem = "instaurado"`, então a automação de limpeza
(`automacoes/limpar_caixa_entrada.py`) não o remove — ela só mexe em itens
pendentes. Em contrapartida ele aparece também em Processos em Andamento, o que
é coerente: cautelar só existe em processo instaurado.
"""
import argparse
import os
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import models as m  # noqa: E402
from app.db.base import Base, get_engine, get_sessionmaker  # noqa: E402
from app.services import calculo_prazos as cp  # noqa: E402

#: Prazo da medida, em dias (um dos permitidos pela tela: 30, 45, 60 ou 90).
PRAZO_DIAS = 30

#: Marca do registro fictício. É a chave usada para criar, atualizar e remover.
PROTOCOLO_FICTICIO = "99999999999202699"

NUMERO_SEI_FISCALIZACAO = "999.99999999/2026-99"
NUMERO_SEI_PROCESSO = "999.99999998/2026-88"
RAZAO_SOCIAL = "VISTORIA FICTICIA DE TESTE LTDA"


def _vencimento_amarelo(hoje: date, sessao) -> date:
    """Data de vencimento que cai na faixa amarela do semáforo (1 a 3 dias).

    Não dá para usar `calcular_vencimento(hoje, 3)`: a prorrogação legal empurra
    um vencimento de fim de semana para a segunda-feira, e aí a distância passa
    de 3 dias e o semáforo volta ao verde — foi o que aconteceu na primeira
    execução (vencimento em 10/08, 4 dias, verde). Aqui o vencimento é escolhido
    de trás para frente: o dia útil mais distante dentro da faixa amarela.
    """
    feriados = cp.carregar_feriados(sessao)
    for dias in range(cp.DIAS_VERDE - 1, 0, -1):
        candidato = hoje + timedelta(days=dias)
        if cp.e_dia_util(candidato, feriados):
            return candidato
    # Todos os dias da faixa caem em fim de semana ou feriado: usa o dia
    # seguinte mesmo assim, que continua dentro do amarelo.
    return hoje + timedelta(days=1)


def _dados_caixa(hoje: date) -> dict:
    return dict(
        numero_sei=NUMERO_SEI_FISCALIZACAO,
        protocolo_limpo=PROTOCOLO_FICTICIO,
        id_procedimento="99999999",
        razao_social=RAZAO_SOCIAL,
        agente_regulado="ECV",
        agente_origem="Empresa Credenciada de Vistoria",
        segmento="Veiculos",
        municipio="São Paulo",
        superintendencia="Superintendência da Capital",
        tipo_documento="Relatório de Fiscalização",
        cnpj_cpf="99.999.999/9999-99",
        total_apontamentos=4,
        total_itens_avaliados=32,
        data_recebimento=hoje - timedelta(days=45),
        data_inicio_fiscalizacao=hoje - timedelta(days=60),
        # Cautelar só existe em processo instaurado; é também o que impede a
        # automação de limpeza de remover este item.
        status_triagem="instaurado",
        numero_processo_sei=NUMERO_SEI_PROCESSO,
        id_procedimento_processo="99999998",
        data_instauracao=hoje - timedelta(days=30),
    )


def _dados_cautelar(item_id: int, inicio: date, fim: date, prazo: int, agora: datetime) -> dict:
    return dict(
        caixa_entrada_id=item_id,
        tipo="Bloqueio cautelar",
        data_inicio=inicio,
        data_fim=fim,
        prazo_dias=prazo,
        situacao="vigente",
        fundamentacao=(
            "REGISTRO FICTÍCIO PARA TESTE DA TELA. Art. 62, parágrafo único, da "
            "Lei Estadual nº 10.177/1998 — medida indicada no termo de "
            "instauração."
        ),
        unidade_responsavel="110001369",
        numero_sei_certidao="99999997",
        # Medida já concordada pelo Coordenador Geral e certidão assinada: é o
        # estado em que a linha aparece com o bloqueio ativo.
        aprovacao="aprovada",
        aprovada_por="Dados de teste",
        aprovada_em=agora,
        pendente_assinatura=False,
    )


def remover(sessao) -> int:
    """Apaga o item fictício e a cautelar dele. Retorna quantas linhas saíram."""
    item = sessao.query(m.CaixaEntrada).filter_by(protocolo_limpo=PROTOCOLO_FICTICIO).one_or_none()
    if not item:
        return 0

    removidas = sessao.query(m.Cautelar).filter_by(caixa_entrada_id=item.id).delete()
    sessao.query(m.EventoProcesso).filter_by(caixa_entrada_id=item.id).delete()
    sessao.delete(item)
    sessao.commit()
    return removidas + 1


def criar(sessao) -> tuple[int, int, date]:
    """Cria (ou atualiza) o item e a cautelar. Retorna ids e o vencimento."""
    hoje = date.today()
    agora = datetime.now()

    item = sessao.query(m.CaixaEntrada).filter_by(protocolo_limpo=PROTOCOLO_FICTICIO).one_or_none()
    if item:
        for campo, valor in _dados_caixa(hoje).items():
            setattr(item, campo, valor)
    else:
        item = m.CaixaEntrada(**_dados_caixa(hoje))
        sessao.add(item)
    sessao.flush()

    # O vencimento é fixado dentro da faixa amarela e o início é deduzido de
    # volta pelo prazo, para o semáforo acender igual em qualquer dia que o
    # script rodar.
    prazo = PRAZO_DIAS
    fim = _vencimento_amarelo(hoje, sessao)
    inicio = fim - timedelta(days=prazo)

    dados = _dados_cautelar(item.id, inicio, fim, prazo, agora)
    cautelar = sessao.query(m.Cautelar).filter_by(caixa_entrada_id=item.id).first()
    if cautelar:
        for campo, valor in dados.items():
            setattr(cautelar, campo, valor)
    else:
        cautelar = m.Cautelar(**dados)
        sessao.add(cautelar)

    # Movimentação recente. Sem isto o item entra no alerta de morosidade da tela
    # inicial ("processos sem movimentação há mais de 15 dias"), porque a
    # instauração fictícia é de 30 dias atrás — um alerta verdadeiro apontando
    # para dado de teste só confunde. O evento também é coerente: a concordância
    # do Coordenador Geral é movimentação.
    sessao.query(m.EventoProcesso).filter_by(caixa_entrada_id=item.id).delete()
    sessao.add(m.EventoProcesso(
        caixa_entrada_id=item.id,
        tipo="cautelar_aprovada",
        descricao="REGISTRO FICTÍCIO PARA TESTE. Medida cautelar concordada pelo Coordenador Geral.",
        autor="Dados de teste",
        criado_em=agora,
    ))

    sessao.commit()
    return item.id, cautelar.id, fim


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remover", action="store_true", help="Apaga o item fictício")
    args = parser.parse_args()

    engine = get_engine()
    Base.metadata.create_all(engine)
    Sessao = get_sessionmaker(engine)

    with Sessao() as sessao:
        if args.remover:
            total = remover(sessao)
            if total:
                print(f"Item ficticio removido ({total} linhas).")
            else:
                print("Nada a remover: o item ficticio nao esta no banco.")
            return

        item_id, cautelar_id, vencimento = criar(sessao)
        print("Item ficticio pronto para a tela de Cautelares:")
        print(f"  caixa_entrada.id = {item_id}")
        print(f"  cautelar.id      = {cautelar_id}")
        print(f"  processo SEI     = {NUMERO_SEI_PROCESSO}")
        print(f"  interessado      = {RAZAO_SOCIAL}")
        print(f"  vencimento       = {vencimento:%d/%m/%Y} (semaforo amarelo)")
        print()
        print("Para remover: python scripts/seed_cautelar_demo.py --remover")


if __name__ == "__main__":
    main()
