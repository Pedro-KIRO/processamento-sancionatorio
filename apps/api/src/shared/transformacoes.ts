// Normalizações aplicadas ANTES da validação dos DTOs.
//
// A ordem importa. O ValidationPipe global roda `transform` antes das regras do
// class-validator, então o que estiver aqui é o que as regras enxergam.
//
// Por que existe: o backend Python fazia `dados.email.strip().lower()` dentro do
// endpoint, ou seja, aceitava " ANA@Detran.SP.gov.br " e normalizava. Ao portar
// com @IsEmail sem normalizar antes, esse mesmo valor passou a responder 400 —
// e-mail copiado de planilha ou de e-mail costuma vir com espaço na ponta, e o
// usuário não tem como saber que o problema é um espaço invisível.
import { Transform } from "class-transformer";

/** Remove espaços das pontas. Preserva null e undefined. */
export const Trim = () =>
  Transform(({ value }) => (typeof value === "string" ? value.trim() : value));

/** Remove espaços das pontas e passa para minúsculas (e-mails). */
export const TrimMinusculas = () =>
  Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  );

/** Remove espaços das pontas e passa para maiúsculas (OAB). */
export const TrimMaiusculas = () =>
  Transform(({ value }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  );

/**
 * Remove espaços das pontas e converte texto vazio em null.
 *
 * Campo opcional que chega como "" tem que virar null: gravar "" faz a tela
 * mostrar campo em branco, que não é a mesma coisa que "não informado".
 */
export const TrimOuNulo = () =>
  Transform(({ value }) => {
    if (typeof value !== "string") return value;
    return value.trim() || null;
  });
