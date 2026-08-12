import { Controller, Get } from "@nestjs/common";

// Endpoint público de liveness. Fica fora do prefixo /api (ver main.ts) porque
// o healthcheck do contêiner em homologação consulta /health diretamente.
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
