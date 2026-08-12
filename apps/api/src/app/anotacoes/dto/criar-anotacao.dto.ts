import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CriarAnotacaoDto {
  /**
   * Texto da anotação interna.
   *
   * O ValidationPipe global usa `forbidNonWhitelisted`, então qualquer campo
   * além deste faz a requisição falhar com 400 — a tela envia só `texto`.
   */
  @IsString({ message: "O texto da anotação deve ser um texto." })
  @IsNotEmpty({ message: "A anotação não pode ficar vazia." })
  @MaxLength(10000, { message: "A anotação passou de 10.000 caracteres." })
  texto!: string;
}
