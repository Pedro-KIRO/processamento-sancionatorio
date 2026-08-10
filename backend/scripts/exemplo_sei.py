"""Exemplo de uso do SeiClient (requer backend/.env com credenciais do SEI).

Uso (a partir da pasta backend/):
    python scripts/exemplo_sei.py <idUnidade> [numeroProcesso]
"""
import os
import sys

# Permite importar "app" ao rodar este script diretamente.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import sei_settings  # noqa: E402
from app.integrations.sei import SeiClient  # noqa: E402


def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python scripts/exemplo_sei.py <idUnidade> [numeroProcesso]")
        return

    id_unidade = sys.argv[1]
    cli = SeiClient(sei_settings())

    if len(sys.argv) >= 3:
        proc = cli.consultar_processo(sys.argv[2], id_unidade, ultimo_andamento=True)
        print("Tipo:", proc.get("tipoProcesso"))
        print("Razao social:", proc.get("razaoSocial"))
        print("Ultimo andamento:", proc.get("ultimoAndamento", {}).get("descricao"))
    else:
        dados = cli.listar_processos(id_unidade, limit=5, start=0)
        procs = dados.get("listaProcessos", [])
        print(f"{len(procs)} processo(s) (mostrando ate 5):")
        for p in procs[:5]:
            print(" -", p.get("protocoloProcedimento"))


if __name__ == "__main__":
    main()
