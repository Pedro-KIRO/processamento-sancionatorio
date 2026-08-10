"""Extrai o logo (LOGO_BASE64) das automações e salva em frontend/public/."""
import base64
import os
import re

ORIGEM = os.path.join(os.path.expanduser("~"), "Desktop", "codigod",
                      "salvar_relatorios", "gerar_relatorios.py")
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DESTINO = os.path.join(RAIZ, "frontend", "public", "logo-detran.png")


def main() -> None:
    if not os.path.exists(ORIGEM):
        print("Origem do logo nao encontrada:", ORIGEM)
        return
    txt = open(ORIGEM, encoding="utf-8").read()
    m = re.search(r'LOGO_BASE64\s*=\s*"([^"]+)"', txt)
    if not m:
        print("LOGO_BASE64 nao encontrado no arquivo de origem.")
        return
    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
    with open(DESTINO, "wb") as f:
        f.write(base64.b64decode(m.group(1)))
    print("Logo salvo em:", DESTINO)


if __name__ == "__main__":
    main()
