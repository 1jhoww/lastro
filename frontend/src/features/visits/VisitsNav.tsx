import { router, type Href } from 'expo-router';
import { Segmented } from '@/ui';

type Section = 'visits' | 'repurchase';
const hrefs: Record<Section, Href> = {
  visits: '/visitas' as Href,
  repurchase: '/visitas/recompra' as Href,
};

/** Alterna entre a lista de visitas e a visão de recompra, sem empilhar telas. */
export function VisitsNav({ current }: { current: Section }) {
  return (
    <Segmented
      label="Seção"
      options={[
        { value: 'visits', label: 'Visitas' },
        { value: 'repurchase', label: 'Recompra' },
      ]}
      value={current}
      onChange={(next) => {
        if (next !== current) router.replace(hrefs[next]);
      }}
    />
  );
}
