"""Publica o projeto no GitHub sem precisar do Git instalado.

Usa a Git Trees API: monta a árvore completa e faz **um único commit**. Só
envia os arquivos que mudaram desde o último envio — o SHA de cada arquivo é
calculado localmente (mesma fórmula do Git) e comparado com o que está no
repositório, então uma atualização pequena leva segundos.

Configuração (em ``backend/.env``, que não vai para o repositório):

    GITHUB_TOKEN=github_pat_...
    GITHUB_REPO=Detran-SP/processamento-sancionatorio

Para gerar o token: GitHub > Settings > Developer settings > Personal access
tokens > Fine-grained tokens. Permissões necessárias no repositório:
**Contents: Read and write**.

Uso::

    cd backend/
    python scripts/atualizar_github.py --dry-run
    python scripts/atualizar_github.py -m "corrigir pesquisa global"

Segurança: o script nunca envia ``.env``, banco de dados, dependências
instaladas nem os exports do Power Automate (que têm client_secret em texto
puro). A lista completa está em IGNORAR_* abaixo.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import os
import sys
import time

sys.stdout.reconfigure(line_buffering=True)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
from dotenv import load_dotenv

BASE_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJETO = os.path.dirname(BASE_BACKEND)
load_dotenv(os.path.join(BASE_BACKEND, ".env"))

API = "https://api.github.com"
BRANCH_PADRAO = "main"

# ── O que nunca vai para o repositório ───────────────────────────────────────
# Pastas: dependências instaladas, artefatos de build, caches e os exports do
# Power Automate (contêm client_secret em texto puro).
IGNORAR_DIRS = {
    ".venv", "venv", "node_modules", ".tools", "flows_referencia",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".vite", "dist", "build",
    ".git", ".idea", ".vscode",
    # Frontend compilado que o backend serve (cópia de frontend/dist)
    "static",
    # JSONs extraídos dos .msapp: ~130 MB de material só de referência
    "extracted_fiscalizacao", "extracted_gestao", "extracted_proc",
}
IGNORAR_ARQUIVOS = {".env", ".DS_Store", "Thumbs.db"}
IGNORAR_EXTENSOES = {".pyc", ".pyo", ".log", ".key", ".pem", ".db", ".sqlite3"}
# Cobre processamento.db, .db-journal e os backups .db.bak_AAAAMMDD_HHMMSS,
# que passam de 400 MB e contêm dados reais dos processos.
IGNORAR_PREFIXOS = ("processamento.db",)

# Limite da API para conteúdo em base64 numa única requisição.
TAMANHO_MAXIMO = 40 * 1024 * 1024


def sha_git(caminho: str) -> str:
    """Calcula o SHA-1 que o Git daria ao arquivo.

    Permite comparar com o SHA do repositório sem ter o Git instalado —
    o formato é ``blob <tamanho>\\0<conteúdo>``.
    """
    dados = open(caminho, "rb").read()
    cabecalho = f"blob {len(dados)}\0".encode()
    return hashlib.sha1(cabecalho + dados).hexdigest()


def deve_ignorar(rel: str, nome: str) -> bool:
    partes = rel.replace("\\", "/").split("/")
    if any(p in IGNORAR_DIRS for p in partes[:-1]):
        return True
    if nome in IGNORAR_ARQUIVOS:
        return True
    if any(nome.startswith(p) for p in IGNORAR_PREFIXOS):
        return True
    if os.path.splitext(nome)[1].lower() in IGNORAR_EXTENSOES:
        return True
    return False


def listar_arquivos_locais() -> list[tuple[str, str]]:
    """Devolve [(caminho_no_repo, caminho_local)] do que deve ser publicado."""
    encontrados: list[tuple[str, str]] = []
    for raiz, dirs, nomes in os.walk(PROJETO):
        dirs[:] = [d for d in dirs if d not in IGNORAR_DIRS]
        for nome in nomes:
            caminho = os.path.join(raiz, nome)
            rel = os.path.relpath(caminho, PROJETO).replace("\\", "/")
            if deve_ignorar(rel, nome):
                continue
            try:
                if os.path.getsize(caminho) > TAMANHO_MAXIMO:
                    print(f"  ignorado (grande demais): {rel}")
                    continue
            except OSError:
                continue
            encontrados.append((rel, caminho))
    return sorted(encontrados)


class Github:
    def __init__(self, token: str, repo: str, branch: str = BRANCH_PADRAO):
        self.repo = repo
        self.branch = branch
        self.h = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _url(self, sufixo: str) -> str:
        return f"{API}/repos/{self.repo}/{sufixo}"

    def confirmar_acesso(self) -> None:
        r = requests.get(self._url(""), headers=self.h, timeout=30)
        if r.status_code == 404:
            raise SystemExit(
                f"Repositório '{self.repo}' não encontrado, ou o token não tem acesso a ele.\n"
                "Confira GITHUB_REPO no .env e as permissões do token (Contents: Read and write)."
            )
        if r.status_code == 401:
            raise SystemExit("Token inválido ou expirado. Gere um novo e atualize GITHUB_TOKEN no .env.")
        r.raise_for_status()
        dados = r.json()
        visibilidade = "privado" if dados.get("private") else "PÚBLICO"
        print(f"Repositório: {dados.get('full_name')} ({visibilidade})")

    def sha_do_branch(self) -> str | None:
        r = requests.get(self._url(f"git/ref/heads/{self.branch}"), headers=self.h, timeout=30)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()["object"]["sha"]

    def arvore_remota(self, commit_sha: str) -> dict[str, str]:
        """Mapa {caminho: sha} de tudo que já está no repositório."""
        r = requests.get(
            self._url(f"git/trees/{commit_sha}"),
            headers=self.h, params={"recursive": "1"}, timeout=60,
        )
        r.raise_for_status()
        dados = r.json()
        if dados.get("truncated"):
            print("  aviso: árvore remota truncada; alguns arquivos podem ser reenviados")
        return {
            item["path"]: item["sha"]
            for item in dados.get("tree", [])
            if item.get("type") == "blob"
        }

    def criar_blob(self, caminho_local: str) -> str:
        conteudo = base64.b64encode(open(caminho_local, "rb").read()).decode("ascii")
        r = requests.post(
            self._url("git/blobs"), headers=self.h,
            json={"content": conteudo, "encoding": "base64"}, timeout=120,
        )
        r.raise_for_status()
        return r.json()["sha"]

    def commitar(self, itens: list[dict], mensagem: str, parent: str | None) -> str:
        corpo: dict = {"tree": itens}
        if parent:
            corpo["base_tree"] = parent
        r = requests.post(self._url("git/trees"), headers=self.h, json=corpo, timeout=120)
        r.raise_for_status()
        tree_sha = r.json()["sha"]

        corpo_commit: dict = {"message": mensagem, "tree": tree_sha}
        if parent:
            corpo_commit["parents"] = [parent]
        r = requests.post(self._url("git/commits"), headers=self.h, json=corpo_commit, timeout=60)
        r.raise_for_status()
        commit_sha = r.json()["sha"]

        if parent:
            r = requests.patch(
                self._url(f"git/refs/heads/{self.branch}"), headers=self.h,
                json={"sha": commit_sha}, timeout=60,
            )
        else:
            r = requests.post(
                self._url("git/refs"), headers=self.h,
                json={"ref": f"refs/heads/{self.branch}", "sha": commit_sha}, timeout=60,
            )
        r.raise_for_status()
        return commit_sha


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Publica o projeto no GitHub (sem Git instalado)."
    )
    parser.add_argument("-m", "--mensagem", default="Atualização do projeto",
                        help="Mensagem do commit.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Mostra o que subiria, sem enviar nada.")
    parser.add_argument("--branch", default=BRANCH_PADRAO, help="Branch de destino.")
    parser.add_argument("--repo", default=None,
                        help="owner/repo. Padrão: GITHUB_REPO do .env.")
    args = parser.parse_args()

    token = os.getenv("GITHUB_TOKEN", "").strip()
    repo = (args.repo or os.getenv("GITHUB_REPO", "")).strip()

    if not token:
        raise SystemExit(
            "GITHUB_TOKEN não encontrado em backend/.env.\n\n"
            "Gere um token em: GitHub > Settings > Developer settings >\n"
            "Personal access tokens > Fine-grained tokens\n"
            "Permissão necessária: Contents (Read and write).\n\n"
            "Depois acrescente ao backend/.env:\n"
            "  GITHUB_TOKEN=github_pat_...\n"
            "  GITHUB_REPO=Detran-SP/processamento-sancionatorio"
        )
    if not repo or "/" not in repo:
        raise SystemExit(
            "GITHUB_REPO não definido (ou sem o formato owner/repo) em backend/.env.\n"
            "Exemplo: GITHUB_REPO=Detran-SP/processamento-sancionatorio"
        )

    gh = Github(token, repo, args.branch)
    gh.confirmar_acesso()

    print("\nLevantando arquivos locais...")
    locais = listar_arquivos_locais()
    print(f"  {len(locais)} arquivo(s) elegível(is)")

    parent = gh.sha_do_branch()
    if parent:
        print(f"\nComparando com o branch '{args.branch}' ({parent[:12]})...")
        remotos = gh.arvore_remota(parent)
    else:
        print(f"\nBranch '{args.branch}' ainda não existe — primeiro commit.")
        remotos = {}

    novos, alterados = [], []
    for rel, caminho in locais:
        sha_local = sha_git(caminho)
        sha_remoto = remotos.get(rel)
        if sha_remoto is None:
            novos.append((rel, caminho))
        elif sha_remoto != sha_local:
            alterados.append((rel, caminho))

    removidos = sorted(set(remotos) - {rel for rel, _ in locais})
    a_enviar = novos + alterados

    print(f"\n  novos:      {len(novos)}")
    print(f"  alterados:  {len(alterados)}")
    print(f"  inalterados: {len(locais) - len(a_enviar)}")
    if removidos:
        print(f"  apagados localmente: {len(removidos)} (permanecem no repositório)")

    for rel, _ in novos[:15]:
        print(f"    + {rel}")
    for rel, _ in alterados[:15]:
        print(f"    ~ {rel}")
    if len(a_enviar) > 30:
        print(f"    ... e mais {len(a_enviar) - 30}")

    if not a_enviar:
        print("\nNada mudou desde o último envio.")
        return

    if args.dry_run:
        print("\n[DRY-RUN] Nada foi enviado.")
        return

    print(f"\nEnviando {len(a_enviar)} arquivo(s)...")
    inicio = time.time()
    itens = []
    for i, (rel, caminho) in enumerate(a_enviar, 1):
        try:
            sha = gh.criar_blob(caminho)
        except Exception as e:  # noqa: BLE001
            print(f"  ERRO em {rel}: {e}")
            continue
        itens.append({"path": rel, "mode": "100644", "type": "blob", "sha": sha})
        if i % 25 == 0 or i == len(a_enviar):
            print(f"  {i}/{len(a_enviar)}")
        time.sleep(0.25)  # folga para o rate limit

    if not itens:
        raise SystemExit("Nenhum arquivo foi enviado com sucesso; commit abortado.")

    commit = gh.commitar(itens, args.mensagem, parent)
    print(f"\n=== Publicado em {time.time() - inicio:.0f}s ===")
    print(f"  commit:  {commit[:12]}")
    print(f"  arquivos: {len(itens)}")
    print(f"  https://github.com/{repo}")


if __name__ == "__main__":
    main()
