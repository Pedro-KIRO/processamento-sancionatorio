import { Controller, Get, UseGuards } from "@nestjs/common";

import { UsuarioAtual } from "../auth/usuario-atual.decorator";
import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { PerfisService } from "../perfis/perfis.service";
import { PERFIS } from "../perfis/perfis";
import type { MeResposta } from "./dto/me-resposta.dto";

/**
 * O usuário autenticado, com o que a tela precisa para se montar.
 *
 * SEM @RequirePermission de propósito: qualquer pessoa autenticada tem que
 * conseguir saber quem é. Exigir permissão aqui criaria um impasse — a tela não
 * carrega sem /me, e /me não responde sem permissão.
 */
@Controller("me")
@UseGuards(UsuarioAtualGuard)
export class MeController {
  constructor(private readonly perfis: PerfisService) {}

  @Get()
  async me(@UsuarioAtual() usuario: UsuarioAtualInfo): Promise<MeResposta> {
    const perfil = await this.perfis.resolver(usuario);

    return {
      email: usuario.email || null,
      nome: usuario.nome || null,
      /*
        `roles` vinha das app roles do token do Entra. No padrão da plataforma
        quem manda em acesso é o Gestão de Acessos, então a lista deixou de ter
        fonte e vai vazia.

        O campo continua na resposta porque o tipo `Usuario` do frontend o
        declara como obrigatório: removê-lo agora quebraria a compilação do
        apps/web. Sai junto com a limpeza do contrato, quando o frontend for
        revisado.
      */
      roles: [],
      /*
        As permissões vêm resolvidas para a tela não deduzir regra a partir do
        perfil. Quem autoriza de fato é o PermissionGuard em cada endpoint.

        DIVERGÊNCIA PROPOSITAL em relação ao backend Python: lá `coordenador`
        saía de `e_coordenador`, que no caminho da tabela local comparava com o
        perfil `coordenador` exato — um Coordenador Geral cadastrado no banco
        recebia `false` e NÃO via o menu "Textos-padrão", embora tenha
        competência maior que o Coordenador. Aqui usa Coordenação inteira, que
        inclui os dois níveis.
      */
      coordenador: this.perfis.ehCoordenacao(perfil),
      perfil,
      perfil_rotulo: PERFIS[perfil],
      coordenacao: this.perfis.ehCoordenacao(perfil),
      coordenador_geral: this.perfis.ehCoordenadorGeral(perfil),
      pode_priorizar: this.perfis.podePriorizar(perfil),
      pode_redistribuir: this.perfis.podeRedistribuir(perfil),
    };
  }
}
