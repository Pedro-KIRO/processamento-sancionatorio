// Ponto de entrada da API.
// Configura o NestJS com validação global e inicia o servidor.
import { NestFactory } from "@nestjs/core";
import { HttpStatus, ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app/app.module";
import { FormatoErroFastApiFilter } from "./shared/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Toda rota de API vive sob /api. Sem o prefixo, o caminho colide com o
  // endereço de uma tela do frontend (/prazos, /cautelares, /usuarios) e o F5
  // passa a devolver JSON cru. Regra travada por teste automatizado.
  //
  // /health fica FORA do prefixo porque o healthcheck do contêiner em
  // homologação consulta http://localhost:3001/health (ver homolog.docker-compose.yml).
  app.setGlobalPrefix("api", { exclude: ["health"] });

  // Validação global: todos os endpoints validam entrada via class-validator.
  // Erros de validação retornam 400 automaticamente.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Remove campos não declarados no DTO.
      forbidNonWhitelisted: true, // Rejeita requisições com campos extras.
      transform: true, // Converte tipos automaticamente.
      /*
        422, e não o 400 padrão do NestJS.

        O FastAPI responde 422 a erro de validação, e é isso que o frontend
        conhece — o backend Python inclusive usa 422 explícito nas validações de
        negócio (resultado de decisão inválido, fase de retorno inexistente).
        Manter o 400 faria endpoints migrados responderem com status diferente do
        dos que ainda estão no Python, para o mesmo tipo de erro, enquanto os
        dois convivem atrás da ponte de migração.
      */
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  );

  // Formata os erros como `{ detail: ... }`, que é o que o cliente HTTP do
  // frontend lê. Ver o comentário do filtro: sem isso, toda mensagem de erro de
  // endpoint migrado virava texto genérico na tela.
  app.useGlobalFilters(new FormatoErroFastApiFilter());

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`API rodando na porta ${port}`);
}

bootstrap();
