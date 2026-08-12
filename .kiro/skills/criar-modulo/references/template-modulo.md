# Template de Módulo NestJS

O Kiro deve gerar os arquivos abaixo substituindo `<modulo>` pelo nome em
kebab-case e `<Modulo>` pelo nome em PascalCase.

---

## `<modulo>.module.ts`

```typescript
import { Module } from "@nestjs/common";
import { <Modulo>Controller } from "./<modulo>.controller";
import { <Modulo>Service } from "./<modulo>.service";

@Module({
  controllers: [<Modulo>Controller],
  providers: [<Modulo>Service],
})
export class <Modulo>Module {}
```

---

## `<modulo>.controller.ts`

```typescript
import { Controller, Get, Post, Body, Param, UseGuards } from "@nestjs/common";

import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import { UsuarioAtual } from "../auth/usuario-atual.decorator";
import { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { PermissionGuard } from "../permissions/permission.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";

import { <Modulo>Service } from "./<modulo>.service";
import { Criar<Modulo>Dto } from "./dto/criar-<modulo>.dto";

@Controller("<modulo>")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class <Modulo>Controller {
  constructor(private readonly <moduloCamel>Service: <Modulo>Service) {}

  @Get()
  @RequirePermission("<sistema>:<modulo>:listar")
  listarTodos(@UsuarioAtual() usuario: UsuarioAtualInfo) {
    return this.<moduloCamel>Service.listarTodos();
  }

  @Get(":id")
  @RequirePermission("<sistema>:<modulo>:listar")
  buscarPorId(
    @Param("id") id: string,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ) {
    return this.<moduloCamel>Service.buscarPorId(id);
  }

  @Post()
  @RequirePermission("<sistema>:<modulo>:criar")
  criar(
    @Body() dto: Criar<Modulo>Dto,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ) {
    return this.<moduloCamel>Service.criar(dto);
  }
}
```

> **Notas sobre substituições:**
> - `<sistema>` = valor de `SYSTEM_PREFIX` em `apps/api/src/app/permissions/parse-identifier.ts`
> - `<modulo>` no identificador de permissão = nome do recurso em kebab-case
> - Ordem dos guards importa: identidade (`UsuarioAtualGuard`) antes de permissão (`PermissionGuard`)

---

## `<modulo>.service.ts`

```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma.service";
import { Criar<Modulo>Dto } from "./dto/criar-<modulo>.dto";

@Injectable()
export class <Modulo>Service {
  constructor(private readonly prisma: PrismaService) {}

  async listarTodos() {
    // TODO: implementar consulta Prisma
    return [];
  }

  async buscarPorId(id: string) {
    // TODO: implementar busca Prisma
    // Exemplo:
    // const item = await this.prisma.<modulo>.findUnique({ where: { id } });
    // if (!item) throw new NotFoundException(`${id} não encontrado.`);
    // return item;
    throw new NotFoundException(`${id} não encontrado.`);
  }

  async criar(dto: Criar<Modulo>Dto) {
    // TODO: implementar criação Prisma
    // Exemplo:
    // return this.prisma.<modulo>.create({ data: dto });
    return dto;
  }
}
```

---

## `dto/criar-<modulo>.dto.ts`

```typescript
import { IsString, IsNotEmpty, MaxLength } from "class-validator";

export class Criar<Modulo>Dto {
  @IsString()
  @IsNotEmpty({ message: "O nome não pode ser vazio." })
  @MaxLength(150)
  nome!: string;

  // TODO: adicionar campos reais do domínio com validações
}
```

---

## Atualização do `app.module.ts`

Adicionar o import e registrar no array `imports`:

```typescript
import { <Modulo>Module } from "./<modulo>/<modulo>.module";

@Module({
  imports: [
    // ... módulos existentes
    <Modulo>Module,
  ],
})
export class AppModule {}
```

---

## Derivação de nomes

| Entrada (kebab-case) | PascalCase | camelCase |
|---|---|---|
| `aprovacao` | `Aprovacao` | `aprovacao` |
| `controle-acesso` | `ControleAcesso` | `controleAcesso` |
| `relatorio-mensal` | `RelatorioMensal` | `relatorioMensal` |

Regra: cada segmento separado por hífen tem a primeira letra capitalizada em PascalCase.
