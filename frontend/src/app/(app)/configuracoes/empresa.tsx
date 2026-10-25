import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { Tenant } from '@/api/types';
import {
  useCompanyLogo,
  useRemoveCompanyLogo,
  useRenameCompany,
  useUploadCompanyLogo,
} from '@/features/company/api';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { formatDate } from '@/lib/dates';
import { imageFailure, pickImageFile, type PickedImage } from '@/lib/imageFiles';
import { useSession } from '@/session/SessionContext';
import { color, radius, space, useLayoutSize } from '@/theme';
import { Alert, Button, ConfirmDialog, Panel, Skeleton, Text, TextField, useToast } from '@/ui';
import { Building, ImagePlus, Lock } from '@/ui/icons';

/**
 * Dados da empresa ativa. Quem tem `tenant:update` (administrador) altera o nome; enviar o
 * logotipo exige `branding:manage`, que o servidor só concede quando o plano inclui identidade
 * visual (Profissional). O logotipo aparece nos PDFs e no catálogo ao lado da identidade do
 * Lastro, que continua sempre presente. Sem o recurso, um logotipo já guardado é mantido.
 */
export default function CompanySettings() {
  const tenant = useTenant();
  const { permissions, membership } = useSession();
  const canEdit = permissions.includes('tenant:update');
  const branding = {
    included: membership?.plan.features.includes('branding.custom') ?? false,
    canUpload: permissions.includes('branding:manage'),
    canRemove: canEdit,
  };
  return (
    <Screen
      title="Empresa"
      description={
        canEdit ? 'Nome e logotipo usados nos documentos e no catálogo.' : 'Dados da empresa.'
      }
    >
      {tenant.isError ? (
        <Alert
          tone="danger"
          title="Não foi possível carregar a empresa"
          action={
            <Button
              label="Tentar de novo"
              size="sm"
              variant="outline"
              onPress={() => tenant.refetch()}
            />
          }
        >
          {toApiError(tenant.error).userMessage}
        </Alert>
      ) : null}
      {tenant.data ? (
        <>
          <Panel title="Identidade da empresa">
            <Identity tenant={tenant.data} canEdit={canEdit} branding={branding} />
          </Panel>
          <Panel>
            <View style={styles.list}>
              <Field
                label="Fuso horário"
                value={tenant.data.timezone}
                hint="Usado para validar datas de vencimento dos pedidos."
              />
              <Field label="No Lastro desde" value={formatDate(tenant.data.createdAt)} />
            </View>
          </Panel>
        </>
      ) : tenant.isPending ? (
        <Panel>
          <View style={styles.list}>
            <Skeleton width="40%" height={18} />
            <Skeleton width="30%" height={18} />
          </View>
        </Panel>
      ) : null}
    </Screen>
  );
}

type Branding = { included: boolean; canUpload: boolean; canRemove: boolean };

function Identity({
  tenant,
  canEdit,
  branding,
}: {
  tenant: Tenant;
  canEdit: boolean;
  branding: Branding;
}) {
  const wide = useLayoutSize() !== 'compact';
  return (
    <View style={[styles.identity, wide && styles.identityWide]}>
      <LogoEditor tenant={tenant} branding={branding} showPlanNote={canEdit} />
      <View style={styles.nameColumn}>
        {canEdit ? (
          // A new saved name (here, in another tab or by another person) restarts the field.
          <NameEditor key={tenant.name} tenant={tenant} />
        ) : (
          <Field label="Nome" value={tenant.name} />
        )}
      </View>
    </View>
  );
}

function NameEditor({ tenant }: { tenant: Tenant }) {
  const rename = useRenameCompany();
  const toast = useToast();
  const [value, setValue] = useState(tenant.name);
  const [invalid, setInvalid] = useState<string | null>(null);
  const trimmed = value.trim();
  const changed = trimmed !== tenant.name;
  const save = () => {
    if (trimmed.length < 2 || trimmed.length > 120) {
      setInvalid('Use de 2 a 120 caracteres.');
      return;
    }
    setInvalid(null);
    rename.mutate(
      { name: trimmed, expectedVersion: tenant.version },
      { onSuccess: () => toast.show('Nome da empresa atualizado') },
    );
  };
  return (
    <View style={styles.nameEditor}>
      <TextField
        label="Nome da empresa"
        value={value}
        onChangeText={(text) => {
          setValue(text);
          setInvalid(null);
          rename.reset();
        }}
        error={invalid ?? undefined}
        hint="Aparece no app, nos pedidos, romaneios e relatórios em PDF."
        maxLength={120}
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={changed ? save : undefined}
      />
      {rename.error ? (
        <Alert tone="danger" title="Nome não salvo">
          {toApiError(rename.error).userMessage}
        </Alert>
      ) : null}
      <View style={styles.row}>
        <Button
          label="Salvar nome"
          size="sm"
          loading={rename.isPending}
          disabled={!changed || rename.isPending}
          onPress={save}
        />
        {changed && !rename.isPending ? (
          <Button
            label="Descartar"
            size="sm"
            variant="ghost"
            onPress={() => {
              setValue(tenant.name);
              setInvalid(null);
              rename.reset();
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

function LogoEditor({
  tenant,
  branding,
  showPlanNote,
}: {
  tenant: Tenant;
  branding: Branding;
  showPlanNote: boolean;
}) {
  const logo = useCompanyLogo(tenant);
  const upload = useUploadCompanyLogo();
  const remove = useRemoveCompanyLogo();
  const toast = useToast();
  const [pickError, setPickError] = useState<string | null>(null);
  const [last, setLast] = useState<PickedImage | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const has = Boolean(tenant.logo);
  const busy = upload.isPending || remove.isPending;

  const send = (image: PickedImage) => {
    upload.reset();
    remove.reset();
    upload.mutate(
      { image, expectedVersion: tenant.version },
      {
        onSuccess: () => {
          setLast(null);
          toast.show(has ? 'Logotipo substituído' : 'Logotipo adicionado');
        },
      },
    );
  };
  const choose = async () => {
    setPickError(null);
    const picked = await pickImageFile(1024);
    if (!picked) return;
    if ('error' in picked) {
      setPickError(picked.error);
      return;
    }
    setLast(picked);
    send(picked);
  };
  const failure = pickError
    ? { message: pickError, retryable: false }
    : upload.error
      ? imageFailure(upload.error)
      : remove.error
        ? { message: toApiError(remove.error).userMessage, retryable: false }
        : null;

  return (
    <View style={styles.logoColumn}>
      <Text variant="small" color={color.textSecondary}>
        Logotipo
      </Text>
      <View
        style={styles.logoFrame}
        accessibilityLabel={has ? `Logotipo de ${tenant.name}` : 'Empresa sem logotipo'}
      >
        {has && logo.data ? (
          <Image source={{ uri: logo.data }} style={styles.logoImage} resizeMode="contain" />
        ) : busy || (has && logo.isPending) ? (
          <ActivityIndicator color={color.textSecondary} accessibilityLabel="Carregando logotipo" />
        ) : (
          <View style={styles.placeholder}>
            <Building size={28} color={color.textSecondary} strokeWidth={1.5} />
            <Text variant="caption" color={color.textSecondary} align="center">
              {has && logo.isError ? 'Não foi possível carregar' : 'Sem logotipo'}
            </Text>
          </View>
        )}
      </View>
      {failure ? (
        <Alert
          tone="danger"
          title={remove.error ? 'Logotipo não removido' : 'Logotipo não salvo'}
          action={
            failure.retryable && upload.error && last ? (
              <Button
                label="Tentar de novo"
                size="sm"
                variant="outline"
                disabled={busy}
                onPress={() => send(last)}
              />
            ) : undefined
          }
        >
          {upload.error && has
            ? `${failure.message} O logotipo anterior continua valendo.`
            : failure.message}
        </Alert>
      ) : null}
      {branding.canUpload || (branding.canRemove && has) ? (
        <View style={styles.row}>
          {branding.canUpload ? (
            <Button
              label={has ? 'Substituir' : 'Adicionar logotipo'}
              icon={ImagePlus}
              size="sm"
              variant="outline"
              loading={upload.isPending}
              disabled={busy}
              onPress={choose}
            />
          ) : null}
          {branding.canRemove && has ? (
            <Button
              label="Remover"
              size="sm"
              variant="ghost"
              disabled={busy}
              onPress={() => setConfirmRemove(true)}
            />
          ) : null}
        </View>
      ) : null}
      {branding.canUpload ? (
        <Text variant="caption" color={color.textSecondary}>
          JPEG, PNG ou WebP, até 5 MB. PNG com fundo transparente fica melhor nos documentos.
        </Text>
      ) : null}
      {showPlanNote && !branding.included ? (
        <View style={styles.planNote}>
          <Lock size={14} color={color.textSecondary} strokeWidth={1.75} />
          <Text variant="caption" color={color.textSecondary} style={styles.planNoteText}>
            {has
              ? 'Logotipo guardado. Ele volta aos pedidos, romaneios e ao catálogo no plano Profissional.'
              : 'Logotipo nos pedidos, romaneios e no catálogo: disponível no plano Profissional.'}
          </Text>
        </View>
      ) : null}
      <ConfirmDialog
        visible={confirmRemove}
        title="Remover logotipo?"
        description="Os documentos voltam a mostrar só o nome da empresa. Você pode enviar outro depois."
        confirmLabel="Remover logotipo"
        loading={remove.isPending}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          // A previous failed upload no longer applies once the logo is being removed.
          setPickError(null);
          setLast(null);
          upload.reset();
          remove.mutate(tenant.version, {
            onSuccess: () => toast.show('Logotipo removido'),
            onSettled: () => setConfirmRemove(false),
          });
        }}
      />
    </View>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text variant="small" color={color.textSecondary}>
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
      {hint ? (
        <Text variant="small" color={color.textSecondary}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[5], paddingTop: space[4] },
  field: { gap: 2 },
  identity: { gap: space[5], paddingTop: space[2] },
  identityWide: { flexDirection: 'row', alignItems: 'flex-start' },
  logoColumn: { gap: space[2], maxWidth: 320 },
  logoFrame: {
    width: 160,
    height: 120,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSunken,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: space[2], padding: space[2] },
  nameColumn: { flex: 1, minWidth: 0, alignSelf: 'stretch' },
  nameEditor: { gap: space[3] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  planNote: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  planNoteText: { flex: 1 },
});
