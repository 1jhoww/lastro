import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { PlanCatalog, PlanCode, PlanFeature } from '@/api/types';
import { formatCents } from '@/lib/money';
import { color, radius, space, useLayoutSize } from '@/theme';
import { Alert, Button, Checkbox, CurrencyInput, Panel, Select, Text, TextField } from '@/ui';
import { featureLabel, priceLabel } from '../copy';
import { ResourcePicker } from './ResourcePicker';
import { parseUserLimit, validPlanName } from './rules';

export type CustomPlanValues = {
  name: string;
  description: string;
  monthlyPriceCents: number;
  userLimit: number;
  features: PlanFeature[];
  sourcePlanCode: PlanCode | null;
};

type Props = {
  catalog: PlanCatalog;
  initial: CustomPlanValues;
  /** Plano oficial como modelo só faz sentido ao criar. */
  allowModel: boolean;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onChange?: () => void;
  onSubmit: (values: CustomPlanValues) => void;
  onCancel: () => void;
};

/** Formulário da oferta, usado para criar, editar e partir de um modelo. */
export function CustomPlanForm(props: Props) {
  const { catalog, initial, allowModel } = props;
  const compact = useLayoutSize() === 'compact';
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [price, setPrice] = useState(initial.monthlyPriceCents);
  // Gratuito é escolha explícita: uma oferta nova, ainda sem valor, não vira cortesia por engano.
  const [free, setFree] = useState(!allowModel && initial.monthlyPriceCents === 0);
  const [limit, setLimit] = useState(String(initial.userLimit));
  const [features, setFeatures] = useState(initial.features);
  const [model, setModel] = useState<PlanCode | null>(initial.sourcePlanCode);
  const [tried, setTried] = useState(false);
  // Remontar a seleção zera o aviso de dependências quando o modelo troca tudo de uma vez.
  const [pickerKey, setPickerKey] = useState(0);
  const userLimit = parseUserLimit(limit);
  const touched = () => props.onChange?.();
  const applyModel = (code: PlanCode | 'none') => {
    touched();
    if (code === 'none') {
      setModel(null);
      return;
    }
    const plan = catalog.items.find((p) => p.code === code);
    if (!plan) return;
    setModel(code);
    setFeatures(plan.features.map((f) => f.code));
    setFree(false);
    setPrice(plan.referencePriceCents);
    setLimit(String(plan.userLimit));
    setPickerKey((key) => key + 1);
  };
  const limitError =
    userLimit === null
      ? 'Use um número entre 1 e 100.'
      : features.includes('users.invite') && userLimit < 2
        ? 'Convites de usuários adicionais exigem pelo menos 2 usuários.'
        : undefined;
  const nameError = validPlanName(name) ? undefined : 'Use pelo menos 2 caracteres.';
  const priceError = free || price > 0 ? undefined : 'Informe a mensalidade negociada.';
  const submit = () => {
    setTried(true);
    if (nameError || priceError || limitError || userLimit === null) return;
    props.onSubmit({
      name: name.trim(),
      description: description.trim(),
      monthlyPriceCents: free ? 0 : price,
      userLimit,
      features,
      sourcePlanCode: model,
    });
  };

  return (
    <View style={[styles.layout, compact && styles.layoutCompact]}>
      <View style={styles.main}>
        <Panel title="Oferta">
          <View style={styles.form}>
            {allowModel ? (
              <Select<PlanCode | 'none'>
                label="Partir de um plano oficial"
                hint="Copia recursos, valor e limite para esta oferta. O plano oficial não muda."
                value={model ?? 'none'}
                onChange={applyModel}
                options={[
                  { value: 'none', label: 'Começar do zero' },
                  ...catalog.items.map((p) => ({
                    value: p.code,
                    label: p.name,
                    description: `${priceLabel(p.referencePriceCents)} por mês`,
                  })),
                ]}
              />
            ) : null}
            <TextField
              label="Nome do plano"
              hint="A empresa vê este nome na área de usuários."
              value={name}
              maxLength={120}
              onChangeText={(v) => {
                touched();
                setName(v);
              }}
              error={tried ? nameError : undefined}
            />
            <TextField
              label="Descrição interna"
              hint="Só o Super Admin vê. Registre o que foi negociado."
              optional
              multiline
              numberOfLines={3}
              maxLength={500}
              value={description}
              onChangeText={(v) => {
                touched();
                setDescription(v);
              }}
            />
            <Checkbox
              label="Plano gratuito"
              description="Cortesia ou contrato especial, com mensalidade de R$ 0,00. Não gera cobranças."
              checked={free}
              onChange={(checked) => {
                touched();
                setFree(checked);
              }}
            />
            <View style={styles.row}>
              {free ? null : (
                <View style={styles.cell}>
                  <CurrencyInput
                    label="Mensalidade negociada"
                    value={price}
                    onChange={(v) => {
                      touched();
                      setPrice(v);
                    }}
                    error={tried ? priceError : undefined}
                  />
                </View>
              )}
              <View style={styles.cell}>
                <TextField
                  label="Limite de usuários"
                  hint="Usuários ativos mais convites pendentes."
                  value={limit}
                  inputMode="numeric"
                  onChangeText={(v) => {
                    touched();
                    setLimit(v.replace(/\D/g, '').slice(0, 3));
                  }}
                  error={tried ? limitError : undefined}
                />
              </View>
            </View>
          </View>
        </Panel>
        <Panel
          title="Módulos e funcionalidades"
          description="O plano define o que a empresa contrata. Quem usa cada recurso continua sendo decidido nas permissões de cada usuário."
        >
          <View style={styles.picker}>
            <ResourcePicker
              key={pickerKey}
              catalog={catalog}
              value={features}
              onChange={(next) => {
                touched();
                setFeatures(next);
              }}
            />
          </View>
        </Panel>
      </View>
      <View style={[styles.side, compact && styles.sideCompact]}>
        <Panel title="Resumo da oferta">
          <View style={styles.summary}>
            <Text variant="bodyStrong">{name.trim() || 'Sem nome'}</Text>
            <Text variant="figure">{free ? 'Gratuito' : `${formatCents(price)}/mês`}</Text>
            <Text variant="small" color={color.textSecondary}>
              {userLimit === null
                ? 'Limite de usuários a definir'
                : userLimit === 1
                  ? '1 usuário'
                  : `Até ${userLimit} usuários`}
            </Text>
            {(userLimit ?? 0) > 1 && !features.includes('users.invite') ? (
              <Text variant="small" color={color.warning}>
                Sem convites adicionais, só o Super Admin preenche as demais vagas.
              </Text>
            ) : null}
            <View style={styles.divider} />
            <Text variant="small" color={color.textSecondary}>
              {`${catalog.baseResources.length} módulos base e ${features.length} ${
                features.length === 1 ? 'recurso adicional' : 'recursos adicionais'
              }`}
            </Text>
            {features.map((f) => (
              <Text key={f} variant="small">{`✓ ${featureLabel[f]}`}</Text>
            ))}
          </View>
          {props.error ? (
            <View style={styles.error}>
              <Alert tone="danger" title="Oferta não salva">
                {toApiError(props.error).userMessage}
              </Alert>
            </View>
          ) : null}
          <View style={styles.actions}>
            <Button
              label={props.submitLabel}
              variant="strong"
              loading={props.pending}
              onPress={submit}
            />
            <Button
              label="Cancelar"
              variant="ghost"
              disabled={props.pending}
              onPress={props.onCancel}
            />
          </View>
        </Panel>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layout: { flexDirection: 'row', gap: space[5], alignItems: 'flex-start' },
  layoutCompact: { flexDirection: 'column', alignItems: 'stretch' },
  main: { flex: 1, minWidth: 0, gap: space[5] },
  side: { width: 300 },
  sideCompact: { width: '100%' },
  form: { gap: space[4], paddingTop: space[2] },
  picker: { paddingTop: space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  cell: { flexGrow: 1, flexBasis: 200 },
  summary: { gap: space[1], paddingTop: space[2] },
  divider: {
    height: 1,
    backgroundColor: color.border,
    marginVertical: space[2],
    borderRadius: radius.sm,
  },
  error: { paddingTop: space[3] },
  actions: { gap: space[2], paddingTop: space[4] },
});
