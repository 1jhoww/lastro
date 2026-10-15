import { useEffect, useRef, useState } from 'react';
import { Link, type Href } from 'expo-router';
import { Platform, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { env } from '@/config/env';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { CatalogInput } from '@/api/types';
import { ReportAccess } from '@/features/reports/ReportAccess';
import { catalogInputSchema } from '@/features/publicCatalog/rules';
import { configureCatalog } from '@/features/publicCatalog/api';
import { intentLedger, intentScope, usePendingIntent } from '@/lib/intent';
import { fileLease } from '@/features/files/fileEpoch';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { Screen } from '@/layout/Screen';
import { Alert, Button, Panel, Switch, Text, TextField } from '@/ui';
import { space } from '@/theme';
export default function CatalogSettings() {
  return (
    <ReportAccess permission="catalog:manage">
      <Settings />
    </ReportAccess>
  );
}
function Settings() {
  const { api, tenantId, header } = useTenantApi();
  const { user } = useSession();
  const scope = intentScope(user!.uid, tenantId, 'catalog-setting', 'catalog');
  const pending = usePendingIntent(scope);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState<CatalogInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    intentLedger
      .hydrate(user!.uid, tenantId)
      .then(() => {
        if (alive.current) setReady(true);
      })
      .catch(() => {
        if (alive.current)
          setMessage('Não foi possível recuperar a intenção. Reabra a tela antes de salvar.');
      });
    return () => {
      alive.current = false;
    };
  }, [user, tenantId]);
  const settings = useQuery({
    queryKey: ['tenant', tenantId, 'catalog-settings'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/catalog-settings', { params: { header }, signal })),
    staleTime: 0,
  });
  const current = settings.data?.catalog;
  const webBase =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location?.origin
      : env?.webBaseUrl;
  const publicLink =
    current && webBase
      ? new URL(`/catalogo/${encodeURIComponent(current.slug)}`, webBase).href
      : null;
  const values = form ?? {
    expectedVersion: current?.version ?? 0,
    slug: current?.slug ?? '',
    enabled: current?.enabled ?? false,
    tradeName: current?.tradeName ?? '',
    description: current?.description ?? '',
    whatsappNumber: current?.whatsappNumber ?? '',
    showPrices: current?.showPrices ?? true,
  };
  const set = <K extends keyof CatalogInput>(key: K, value: CatalogInput[K]) =>
    setForm({ ...values, [key]: value });
  const save = async (retry = false) => {
    if (busy || !ready) return;
    const check = fileLease();
    const body = retry && pending ? (pending.body as CatalogInput) : values;
    if (!catalogInputSchema.safeParse(body).success) {
      setMessage('Revise slug, nome, telefone internacional e limites de texto.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await configureCatalog(api, tenantId, scope, body, check);
      check();
      if (alive.current) {
        setForm(null);
        setMessage(
          'Configuração salva. Produtos ativos marcados como visíveis compõem o catálogo.',
        );
        await settings.refetch();
      }
    } catch (e) {
      if (alive.current)
        setMessage(
          toApiError(e).code === 'CATALOG_SLUG_UNAVAILABLE'
            ? 'Slug já reservado. Escolha outro identificador.'
            : toApiError(e).code === 'CONFLICT'
              ? 'Configuração mudou. Recarregue e revise antes de salvar.'
              : toApiError(e).userMessage,
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Screen
      title="Catálogo público"
      description="Visitante solicita orçamento. Catálogo não cria pedido ou reserva estoque."
    >
      {settings.isError ? (
        <Alert tone="danger" title="Não foi possível carregar">
          {toApiError(settings.error).userMessage}
        </Alert>
      ) : null}
      {settings.isPending ? (
        <Text>Carregando configuração…</Text>
      ) : settings.data ? (
        <Panel title="Publicação">
          <View style={{ gap: space[3] }}>
            <TextField
              label="Slug público"
              value={values.slug}
              onChangeText={(v) => set('slug', v)}
              hint="3 a 63 caracteres: letras minúsculas, números e hífens. Comece com letra."
              editable={!pending && !busy}
            />
            <TextField
              label="Nome público"
              value={values.tradeName}
              onChangeText={(v) => set('tradeName', v)}
              maxLength={160}
              editable={!pending && !busy}
            />
            <TextField
              label="Descrição pública"
              value={values.description}
              onChangeText={(v) => set('description', v)}
              multiline
              maxLength={1000}
              editable={!pending && !busy}
            />
            <TextField
              label="WhatsApp internacional"
              value={values.whatsappNumber}
              onChangeText={(v) => set('whatsappNumber', v)}
              hint="Somente dígitos com país e DDD. Exemplo: 5511999999999."
              keyboardType="phone-pad"
              editable={!pending && !busy}
            />
            <Switch
              label="Publicar catálogo"
              value={values.enabled}
              onChange={(v) => set('enabled', v)}
              disabled={!!pending || busy}
            />
            <Switch
              label="Exibir preços públicos"
              value={values.showPrices}
              onChange={(v) => set('showPrices', v)}
              disabled={!!pending || busy}
            />
            <Button
              label="Salvar configuração"
              onPress={() => save()}
              loading={busy}
              disabled={!ready || !!pending}
            />
            <Button
              label="Recarregar configuração"
              variant="outline"
              disabled={busy || !!pending}
              onPress={() => {
                setForm(null);
                settings.refetch();
              }}
            />
            {current ? (
              <Link href={`/catalogo/${current.slug}` as Href} asChild>
                <Button label="Abrir catálogo público" variant="outline" />
              </Link>
            ) : null}
            {publicLink ? (
              <>
                <Text selectable>{publicLink}</Text>
                <Button
                  label="Copiar endereço público"
                  variant="outline"
                  onPress={async () => {
                    try {
                      await Clipboard.setStringAsync(publicLink);
                      setMessage('Endereço público copiado.');
                    } catch {
                      setMessage(
                        'Não foi possível copiar. Selecione o endereço e copie manualmente.',
                      );
                    }
                  }}
                />
              </>
            ) : current ? (
              <Text variant="small">
                Endereço web público ainda não configurado neste aplicativo. Abra o catálogo local
                para testar.
              </Text>
            ) : null}
            <Link href="/produtos" asChild>
              <Button label="Selecionar produtos nos cadastros" variant="ghost" />
            </Link>
            <Text variant="small">
              Slugs anteriores permanecem reservados. Ative e marque cada produto como visível no
              cadastro. Compartilhe o endereço público após publicar.
            </Text>
          </View>
        </Panel>
      ) : null}
      {pending ? (
        <Alert
          tone="warning"
          title="Resultado ainda desconhecido"
          action={
            <Button label="Repetir mesma configuração" loading={busy} onPress={() => save(true)} />
          }
        >
          A chave e o corpo foram preservados neste usuário e empresa. Repetir recupera a resposta
          original; depois consulte a configuração atual.
        </Alert>
      ) : null}
      {message ? <Alert title="Configuração">{message}</Alert> : null}
    </Screen>
  );
}
