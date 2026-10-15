import type { Me, Membership } from '@/api/types';

/**
 * Para onde a sessão pode ir. Função pura: decide a partir do estado do provedor, de /me e da
 * empresa escolhida. Nada aqui concede acesso; só evita mostrar telas que o backend recusaria.
 */
export type Gate =
  | { kind: 'boot' }
  | { kind: 'signedOut' }
  | { kind: 'meError' }
  | { kind: 'chooseTenant'; platformAdmin: boolean }
  | { kind: 'tenant'; membership: Membership; platformAdmin: boolean }
  | { kind: 'tenantBlocked'; membership: Membership; platformAdmin: boolean }
  | { kind: 'noTenant'; platformAdmin: boolean };

export type GateInput = {
  auth: 'initializing' | 'signedOut' | 'signedIn';
  me: Me | undefined;
  meFailed: boolean;
  /** Preferência salva ainda sendo lida. */
  preferenceLoading: boolean;
  selectedTenantId: string | null;
};

export function resolveGate(input: GateInput): Gate {
  if (input.auth === 'initializing') return { kind: 'boot' };
  if (input.auth === 'signedOut') return { kind: 'signedOut' };
  if (input.meFailed && !input.me) return { kind: 'meError' };
  if (!input.me || input.preferenceLoading) return { kind: 'boot' };

  const { memberships, platformAdmin } = input.me;
  if (memberships.length === 0) return { kind: 'noTenant', platformAdmin };

  // Uma empresa só: entra direto. Escolha salva que não existe mais em /me é ignorada.
  const chosen =
    memberships.find((m) => m.tenantId === input.selectedTenantId) ??
    (memberships.length === 1 ? memberships[0] : undefined);
  if (!chosen) return { kind: 'chooseTenant', platformAdmin };
  return chosen.access === 'allowed'
    ? { kind: 'tenant', membership: chosen, platformAdmin }
    : { kind: 'tenantBlocked', membership: chosen, platformAdmin };
}

/** Primeiro segmento de rota (grupo ou pasta em src/app) permitido para cada estado. */
export type RouteRoot =
  | '(auth)'
  | '(app)'
  | 'convite'
  | 'empresas'
  | 'acesso-bloqueado'
  | 'sem-empresa'
  | 'plataforma'
  | 'sistema';

export function allowedRoots(gate: Gate, dev = false): RouteRoot[] {
  const always: RouteRoot[] = dev ? ['convite', 'sistema'] : ['convite'];
  switch (gate.kind) {
    case 'boot':
    case 'meError':
      return [];
    case 'signedOut':
      return ['(auth)', ...always];
    case 'chooseTenant':
      return ['empresas', ...platform(gate), ...always];
    case 'tenant':
      return ['(app)', 'empresas', ...platform(gate), ...always];
    case 'tenantBlocked':
      return ['acesso-bloqueado', 'empresas', ...platform(gate), ...always];
    case 'noTenant':
      return [gate.platformAdmin ? 'plataforma' : 'sem-empresa', ...always];
  }
}

const platform = (g: { platformAdmin: boolean }): RouteRoot[] =>
  g.platformAdmin ? ['plataforma'] : [];

/** Destino padrão quando a rota atual não é permitida. */
export function homeFor(gate: Gate): string | null {
  switch (gate.kind) {
    case 'signedOut':
      return '/entrar';
    case 'chooseTenant':
      return '/empresas';
    case 'tenant':
      return '/';
    case 'tenantBlocked':
      return '/acesso-bloqueado';
    case 'noTenant':
      return gate.platformAdmin ? '/plataforma' : '/sem-empresa';
    default:
      return null;
  }
}
