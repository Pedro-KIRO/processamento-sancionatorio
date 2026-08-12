# Exemplos de Nomes de Repositório

## Padrão obrigatório

```
detran-dti-<sistema>
```

## Regras para `<sistema>`

| Regra | Exemplo |
|-------|---------|
| Apenas letras minúsculas | ✅ `pessoal` — ❌ `Pessoal` |
| Números permitidos | ✅ `frota2` |
| Hífens para separar palavras | ✅ `controle-ponto` |
| Sem acentos | ✅ `ferias` — ❌ `férias` |
| Sem espaços | ✅ `gestao-frota` — ❌ `gestao frota` |
| Sem underscores | ✅ `gestao-frota` — ❌ `gestao_frota` |
| Curto e descritivo (1 a 3 palavras) | ✅ `ponto` — ❌ `sistema-de-controle-de-ponto` |

---

## Exemplos CORRETOS ✅

| Repositório completo | Sistema | Descrição |
|---------------------|---------|-----------|
| `detran-dti-pessoal` | pessoal | Gestão de pessoal / cadastro de servidores |
| `detran-dti-ferias` | ferias | Controle de férias |
| `detran-dti-ponto` | ponto | Registro de ponto |
| `detran-dti-frota` | frota | Gestão de veículos |
| `detran-dti-patrimonio` | patrimonio | Controle patrimonial |
| `detran-dti-almoxarifado` | almoxarifado | Gestão de estoque |
| `detran-dti-capacitacao` | capacitacao | Treinamentos e capacitações |
| `detran-dti-protocolo` | protocolo | Protocolo de documentos |
| `detran-dti-controle-acesso` | controle-acesso | Controle de acesso físico |

---

## Exemplos INCORRETOS ❌

| Nome errado | Problema | Correção |
|-------------|----------|----------|
| `detran-dti-SistemaFérias` | PascalCase + acento | `detran-dti-ferias` |
| `detran_dti_ponto` | Underscores no lugar de hífens | `detran-dti-ponto` |
| `detran-dti-sistema-de-controle-de-ponto-dos-servidores` | Longo demais, verboso | `detran-dti-ponto` |
| `dti-novo` | Falta o prefixo `detran-` | `detran-dti-novo` |
| `detran-dti-Patrimônio` | Maiúscula + acento | `detran-dti-patrimonio` |
| `detran-dti-` | Sistema em branco | Definir o nome do domínio |
| `detran-dti-test123` | Nome não descritivo | Usar nome do domínio real |
| `detran-dti-meu sistema` | Espaço no nome | `detran-dti-meu-sistema` |
| `DETRAN-DTI-FERIAS` | Tudo maiúsculo | `detran-dti-ferias` |
| `detran-dti-férias-2024` | Acento + ano desnecessário | `detran-dti-ferias` |

---

## Regra de validação (regex)

Para validar programaticamente:

```regex
^detran-dti-[a-z0-9]+(-[a-z0-9]+)*$
```

Leitura:
- Começa com `detran-dti-`
- Seguido de letras minúsculas ou números
- Opcionalmente separado por hífens (uma ou mais palavras)
- Sem trailing hífens

---

## Quando o dev tem dúvida sobre o nome

Pergunte:
1. **Qual é o domínio de negócio?** (ex.: férias, patrimônio, frota)
2. **Como os servidores chamam esse sistema no dia a dia?** (use a versão simplificada)
3. **Já existe outro sistema com nome parecido?** (evitar colisões)

O nome deve ser autoexplicativo para qualquer dev que veja o repositório pela
primeira vez.
