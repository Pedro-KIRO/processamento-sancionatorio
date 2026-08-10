"""Séries (tipos de documento) do SEI usadas pelo app.

Uma série define como o documento aparece na árvore do processo. Os valores
abaixo vieram de ``GET /series`` na API de parâmetros do SEI — use
``scripts/listar_series_sei.py`` para reconferir ou descobrir novas. São 2.666
séries no catálogo, praticamente todas habilitadas nas seis unidades do CPSAR.

**Correção importante:** até julho/2026 o app usava 2403 para quase todo
documento gerado, supondo que fosse "Despacho". 2403 é **Termo de encerramento**
— o despacho é 1172. Documentos criados antes disso ficaram classificados como
termo de encerramento na árvore do SEI; o conteúdo está correto, o rótulo não.
"""
from __future__ import annotations

# --- Documentos do processo sancionatório -----------------------------------
DESPACHO = "1172"                  # DETRAN - Despacho
INTIMACAO = "5083"                 # DETRAN - Intimação
DECISAO = "5084"                   # DETRAN - Decisão
CITACAO = "2382"                   # DETRAN - Citação
CITACAO_SANCIONATORIO = "5276"     # DETRAN - Citação em Processo Administrativo Sancionatório
CERTIDAO = "2380"                  # DETRAN - Certidão
NOTIFICACAO = "2381"               # DETRAN - Notificação
RELATORIO = "2410"                 # DETRAN - Relatório
PARECER_MERITO = "2412"            # DETRAN - Parecer de mérito
EDITAL = "2489"                    # DETRAN - Edital
TERMO_ENCERRAMENTO = "2403"        # DETRAN - Termo de encerramento
TERMO_INSTAURACAO = "2377"         # DETRAN - Termo de instauração
TERMO_AJUSTAMENTO_CONDUTA = "5291"  # DETRAN - Termo de ajustamento de conduta
RELATORIO_FISCALIZACAO = "1266"    # DETRAN - Relatório de fiscalização

# --- Documento externo (arquivo enviado pelo usuário) -----------------------
# 1917 é a série genérica "Anexo", já validada em produção nos uploads de
# medida cautelar e do conjunto probatório da instauração. Existe também a
# 1752 ("DETRAN - Anexo"), não usada para não mexer no que já funciona.
ANEXO = "1917"

# Não existe série própria para alguns atos; usamos a que corresponde ao que o
# documento é:
# - relatório opinativo → RELATORIO
# - despacho saneador → DESPACHO
#
# Pendente de confirmação com a área: **portaria**. O catálogo só tem "Portaria
# Conjunta" (4847), "Portaria de Pessoal" (4367) e minutas — nenhuma serve para
# a portaria de penalidade, então ela sai como DECISAO até a área definir.
PORTARIA = DECISAO
