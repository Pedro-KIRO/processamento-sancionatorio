# Guia Completo de Setup de Ambiente

Este guia cobre desde a instalacao do WSL/Git ate a estacao pronta para
criar sistemas.

---

## Diretorio padrao de projetos

Todos os projetos da plataforma ficam em **`~/projetos/`** dentro do WSL.

Estrutura esperada:
```
~/projetos/
├── detran-dti-platform-template/    ← template (clonado uma vez)
├── detran-contrato-compartilhado/   ← contrato compartilhado (clonado uma vez)
├── detran-dti-ferias/               ← sistema 1
├── detran-dti-ponto/                ← sistema 2
└── ...
```

---

## Fase 1 — Git (instalacao + identidade + credential helper)

### Passo 1 — Instalar Git

```bash
sudo apt update
sudo apt install git -y
git --version
```

### Passo 2 — Configurar identidade e credenciais

```bash
git config --global user.name "Nome Completo"
git config --global user.email "email@detran.sp.gov.br"
git config --global credential.helper store
```

**Regra:** o e-mail DEVE ser corporativo (`@detran.sp.gov.br`).

### Passo 3 — Criar pasta de projetos

```bash
mkdir -p ~/projetos
cd ~/projetos
```

---

## Fase 2 — Clonar repos base

```bash
cd ~/projetos
git clone https://github.com/Detran-SP/detran-dti-platform-template.git
git clone https://github.com/Detran-SP/detran-contrato-compartilhado.git
```

Na primeira vez pede:
- **Username:** usuario do GitHub
- **Password:** PAT (nao a senha do GitHub)

O credential.helper store salva em `~/.git-credentials` automaticamente.

---

## Fase 3 — GitHub CLI + chave SSH (tudo em um passo)

### Passo 4 — Instalar gh

```bash
sudo apt install -y curl
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli-stable.list > /dev/null
sudo apt update
sudo apt install gh -y
gh --version
```

**Nota:** usar `arch=amd64` fixo (nao `$(dpkg --print-architecture)`) pois
shell expansion pode quebrar dependendo do contexto de execucao.

### Passo 5 — Autenticar (interativo)

```bash
gh auth login
```

Respostas:
- **Where do you use GitHub?** → GitHub.com
- **Preferred protocol for Git operations?** → SSH
- **Generate a new SSH key to add to your GitHub account?** → Yes (aceitar path padrao)
- **Passphrase for the SSH key:** → deixar em branco (apenas Enter)
- **Title for SSH key:** → WSL - (nome do dev)
- **How would you like to authenticate?** → Paste an authentication token
- Colar o PAT

O `gh` faz tudo automaticamente:
1. Gera chave SSH ed25519
2. Registra no GitHub
3. Configura Git para usar SSH em operacoes

> **Observacao — passphrase:** recomendamos deixar em branco para nao precisar
> digitar senha a cada operacao git. Se preferir usar passphrase por seguranca,
> configure o ssh-agent para nao precisar digitar toda vez:
> ```bash
> eval "$(ssh-agent -s)"
> ssh-add ~/.ssh/id_ed25519
> ```

> **Observacao — chave SSH ja existente:** se voce ja executou o `gh auth login`
> antes (ou ja tem uma chave SSH na maquina), o prompt pode mostrar
> "Upload your SSH public key to your GitHub account?" com a chave listada.
> Nesse caso, selecione a chave existente (ex: `/home/usuario/.ssh/id_ed25519.pub`)
> em vez de "Skip".

### Passo 6 — Verificar

```bash
gh auth status          # Deve mostrar: Logged in, protocol: ssh
ssh -T git@github.com   # Deve mostrar: Hi <usuario>!
```

---

## Fase 4 — Node.js (via nvm)

### Passo 7 — Instalar nvm + Node 20

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 20
node --version    # v20.x.x
npm --version     # 10.x.x
```

---

## Fase 5 — Docker

### Passo 8 — Instalar Docker

```bash
sudo apt install -y docker.io docker-compose
sudo usermod -aG docker $(whoami)
```

**Fix obrigatorio para WSL 2** — o Docker nao inicia sem este ajuste:

```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
cat <<EOF | sudo tee /etc/systemd/system/docker.service.d/override.conf
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd --containerd=/run/containerd/containerd.sock
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
```

> **Por que?** O pacote `docker.io` do Ubuntu configura o servico com socket
> activation (`-H fd://`), que conflita com o systemd do WSL 2. O override
> remove essa flag e inicia o daemon diretamente.

> **Alternativa:** se voce ja tem Docker Desktop instalado no Windows com
> integracao WSL ativada, pode pular este passo inteiro — o Docker ja estara
> disponivel dentro do WSL automaticamente.

**Sair e entrar novamente no WSL** (o grupo docker so tem efeito apos relogin):
```bash
exit
# Reabrir o terminal WSL
docker --version
docker-compose --version
docker run hello-world   # Deve baixar a imagem e mostrar "Hello from Docker!"
```

---

## Fase 6 — Verificacao final

```bash
git --version                        # Git instalado
git config --global user.email       # E-mail corporativo
gh auth status                       # gh autenticado, protocolo SSH
ssh -T git@github.com                # SSH conectando
node --version                       # Node.js 20+
docker --version                     # Docker instalado
ls ~/projetos/detran-dti-platform-template      # Template clonado
ls ~/projetos/detran-contrato-compartilhado     # Contrato clonado
```

Ou executar o script automatico:
```bash
cd ~/projetos/detran-dti-platform-template
.kiro/skills/setup-ambiente/scripts/verificar-ambiente.sh
```

---

## Erros comuns

| Erro | Solucao |
|------|---------|
| `gh auth login` pede `admin:public_key` scope | Editar o PAT no GitHub e adicionar esse scope |
| `docker: permission denied` | Sair e reentrar no WSL apos `usermod -aG docker` |
| Docker `failed to load listeners: no sockets found` | Aplicar o fix do override do systemd (ver Fase 5) |
| `docker.service: Failed with result 'exit-code'` | Mesmo fix acima — o override resolve |
| `nvm: command not found` | Executar `source ~/.bashrc` ou reabrir terminal |
| `source ~/.bashrc` da erro de sintaxe | O `.bashrc` esta corrompido. Verificar blocos `if/fi` desbalanceados |
| SSH `Permission denied (publickey)` | Verificar se `gh auth login` usou protocolo SSH e fez upload da chave |
| SSH pede `passphrase` toda vez | Configurar ssh-agent: `eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519` |
| `$USER` vazio no usermod | Usar `$(whoami)` em vez de `$USER` |
| npm pede autenticacao para `@detran` | Normal no primeiro clone; o credential.helper resolve |

---

## Proximo passo

Estacao pronta. Acionar a skill `/onboarding` para criar o repositorio do sistema.
