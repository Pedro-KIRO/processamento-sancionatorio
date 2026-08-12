// Identificadores de permissão seguem o formato exato {sistema}:{recurso}:{acao}.
//
// Ao gerar um novo sistema a partir do template, SYSTEM_PREFIX é a única coisa
// que muda neste arquivo.

/** Prefixo de sistema usado em todos os identificadores de permissão desta API. */
export const SYSTEM_PREFIX = "processamento";

/** Partes de um identificador de permissão já validado. */
export interface PermissionIdentifier {
  sistema: string;
  recurso: string;
  acao: string;
}

// kebab-case: minúsculas, dígitos e hífen. A ação aceita ponto para suportar o
// par `.conceder` que o Gestão de Acessos gera automaticamente para delegação.
const PARTE = "[a-z0-9]+(?:-[a-z0-9]+)*";
const FORMATO = new RegExp(`^(${PARTE}):(${PARTE}):(${PARTE}(?:\\.${PARTE})?)$`);

/**
 * Valida e decompõe um identificador de permissão.
 * Lança `Error` se o formato não bater — falha de programação, não de runtime,
 * por isso não é uma exceção HTTP.
 */
export function parseIdentifier(identificador: string): PermissionIdentifier {
  const match = FORMATO.exec(identificador);
  if (!match) {
    throw new Error(
      `Identificador de permissão inválido: "${identificador}". ` +
        `Formato esperado: {sistema}:{recurso}:{acao} em kebab-case.`,
    );
  }

  const [, sistema, recurso, acao] = match;
  return { sistema, recurso, acao };
}

/**
 * Mesmo que `parseIdentifier`, mas também exige que o identificador pertença a
 * este sistema. Evita que um endpoint declare por engano uma permissão de outro
 * sistema (o que o Gestão de Acessos nunca concederia, gerando 403 silencioso).
 */
export function parseIdentifierDesteSistema(
  identificador: string,
): PermissionIdentifier {
  const partes = parseIdentifier(identificador);
  if (partes.sistema !== SYSTEM_PREFIX) {
    throw new Error(
      `Identificador "${identificador}" pertence ao sistema "${partes.sistema}", ` +
        `mas esta API é "${SYSTEM_PREFIX}".`,
    );
  }
  return partes;
}
