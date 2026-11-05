import type { PlanCatalog, PlanFeature } from '@/api/types';

type Definitions = PlanCatalog['features'];

export const validPlanName = (value: string) => value.trim().length >= 2;

/** Limite digitado: inteiro entre 1 e 100, como no backend. */
export function parseUserLimit(value: string): number | null {
  if (!/^[0-9]{1,3}$/.test(value.trim())) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= 100 ? limit : null;
}

const byCatalogOrder = (features: Set<PlanFeature>, definitions: Definitions) =>
  definitions.map((d) => d.code).filter((code) => features.has(code));

/** O recurso e tudo de que ele depende, direta ou indiretamente. */
function requirementsOf(
  code: PlanFeature,
  definitions: Definitions,
  seen = new Set<PlanFeature>(),
) {
  if (seen.has(code)) return seen;
  seen.add(code);
  for (const requirement of definitions.find((d) => d.code === code)?.requires ?? [])
    requirementsOf(requirement, definitions, seen);
  return seen;
}

/** Recursos selecionados que deixam de funcionar sem `code`. */
function dependentsOf(
  code: PlanFeature,
  selected: readonly PlanFeature[],
  definitions: Definitions,
) {
  return selected.filter((other) => other !== code && requirementsOf(other, definitions).has(code));
}

export type FeatureToggle = {
  features: PlanFeature[];
  /** Recursos que entraram ou saíram junto, para avisar quem está montando a oferta. */
  included: PlanFeature[];
  removed: PlanFeature[];
};

/**
 * Marca ou desmarca um recurso mantendo a combinação válida: incluir traz as dependências, retirar
 * leva junto o que depende dele. A lista de dependências vem do backend, que valida de novo.
 */
export function toggleFeature(
  selected: readonly PlanFeature[],
  code: PlanFeature,
  definitions: Definitions,
): FeatureToggle {
  if (selected.includes(code)) {
    const removed = dependentsOf(code, selected, definitions);
    const gone = new Set([code, ...removed]);
    return {
      features: byCatalogOrder(
        new Set(selected.filter((feature) => !gone.has(feature))),
        definitions,
      ),
      included: [],
      removed,
    };
  }
  const required = requirementsOf(code, definitions);
  return {
    features: byCatalogOrder(new Set([...selected, ...required]), definitions),
    included: [...required].filter((feature) => feature !== code && !selected.includes(feature)),
    removed: [],
  };
}
