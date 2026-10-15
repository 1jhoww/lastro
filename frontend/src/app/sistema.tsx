import { useState } from 'react';
import { Redirect } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Plus, Search, Trash, Truck } from '@/ui/icons';
import { BrandSymbol, Wordmark } from '@/brand';
import { StockLegend } from '@/features/inventory/StockLegend';
import { brand, color, space, type as typeScale, useLayoutSize, type TypeVariant } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  CurrencyInput,
  EmptyState,
  Panel,
  QuantityInput,
  SearchField,
  Segmented,
  Skeleton,
  Switch,
  Text,
  TextField,
} from '@/ui';

const swatches = [
  { name: 'Carvão', hex: brand.carvao },
  { name: 'Grafite', hex: brand.grafite },
  { name: 'Bege', hex: brand.bege },
  { name: 'Amarelo Lastro', hex: brand.amarelo },
  { name: 'Areia', hex: brand.areia },
  { name: 'Cinza', hex: brand.cinza },
];

/** Catálogo do design system. Só existe em desenvolvimento. */
export default function DesignSystem() {
  const compact = useLayoutSize() === 'compact';
  const [qty, setQty] = useState(3000);
  const [kg, setKg] = useState(1250);
  const [cents, setCents] = useState(12990);
  const [q, setQ] = useState('');
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <ScrollView
      style={{ backgroundColor: color.canvas }}
      contentContainerStyle={[styles.page, compact && styles.pageCompact]}
    >
      <View style={styles.inner}>
        <Text variant="h1" accessibilityRole="header">
          Design system
        </Text>

        <Panel
          title="Marca"
          description="Reconstruções provisórias até o recebimento dos SVGs oficiais."
        >
          <View style={styles.wrap}>
            <Wordmark size={44} />
            <Wordmark size={32} signature />
            <BrandSymbol size={56} />
            <View style={styles.dark}>
              <Wordmark size={32} tone="onDark" />
              <BrandSymbol size={40} tone="onDark" />
            </View>
          </View>
        </Panel>

        <Panel title="Cores da marca">
          <View style={styles.wrap}>
            {swatches.map((s) => (
              <View key={s.hex} style={styles.swatchBox}>
                <View style={[styles.swatch, { backgroundColor: s.hex }]} />
                <Text variant="smallStrong">{s.name}</Text>
                <Text variant="caption" color={color.textSecondary}>
                  {s.hex}
                </Text>
              </View>
            ))}
          </View>
        </Panel>

        <Panel title="Tipografia" description="Inter. Números com dígitos tabulares.">
          <View style={styles.stack}>
            {(Object.keys(typeScale) as TypeVariant[]).map((v) => (
              <View key={v} style={styles.typeRow}>
                <Text variant="caption" color={color.textSecondary} style={styles.typeName}>
                  {v} · {typeScale[v].fontSize}/{typeScale[v].lineHeight}
                </Text>
                <Text variant={v} style={styles.flex} numberOfLines={1}>
                  {v.startsWith('figure')
                    ? 'R$ 12.480,90 · 1.250,5 kg'
                    : 'Pedido confirmado para Mercado Bom Preço'}
                </Text>
              </View>
            ))}
          </View>
        </Panel>

        <Panel title="Botões">
          <View style={styles.wrap}>
            <Button label="Confirmar pedido" />
            <Button label="Novo cliente" variant="strong" icon={Plus} />
            <Button label="Filtrar" variant="outline" icon={Search} />
            <Button label="Cancelar" variant="ghost" />
            <Button label="Cancelar pedido" variant="danger" icon={Trash} />
            <Button label="Salvando" loading />
            <Button label="Indisponível" disabled />
            <Button label="Expedir" size="sm" variant="strong" icon={Truck} />
          </View>
        </Panel>

        <Panel title="Campos">
          <View style={[styles.grid, compact && styles.gridCompact]}>
            <View style={styles.cell}>
              <TextField label="Nome do cliente" placeholder="Ex.: Mercado Bom Preço" />
            </View>
            <View style={styles.cell}>
              <TextField
                label="CPF ou CNPJ"
                optional
                hint="Validado no cadastro, sem consulta à Receita."
              />
            </View>
            <View style={styles.cell}>
              <TextField
                label="SKU"
                error="Já existe um produto com este SKU."
                defaultValue="CAF-500"
              />
            </View>
            <View style={styles.cell}>
              <TextField label="Unidade" editable={false} value="Caixa (cx)" />
            </View>
            <View style={styles.cell}>
              <SearchField
                label="Buscar"
                hideLabel
                placeholder="Buscar pelo início do nome"
                value={q}
                onChangeText={setQ}
              />
            </View>
            <View style={styles.cell}>
              <CurrencyInput label="Preço" value={cents} onChange={setCents} />
            </View>
          </View>
          <View style={[styles.wrap, styles.topGap]}>
            <QuantityInput label="Quantidade" unit="CX" value={qty} onChange={setQty} />
            <QuantityInput label="Peso" unit="KG" value={kg} onChange={setKg} />
          </View>
          <View style={styles.topGap}>
            <Checkbox
              label="Condição padrão"
              description="Pré-selecionada em novos pedidos."
              checked={checked}
              onChange={setChecked}
            />
            <Switch
              label="Produto ativo"
              description="Inativos saem do catálogo do vendedor."
              value={on}
              onChange={setOn}
            />
          </View>
        </Panel>

        <Panel title="Situação e filtros">
          <View style={styles.wrap}>
            <Badge label="Rascunho" />
            <Badge label="Confirmado" tone="accent" />
            <Badge label="Expedido" tone="success" />
            <Badge label="Cancelado" tone="danger" />
            <Badge label="Abaixo do mínimo" tone="warning" />
            <Badge label="Inativo" tone="strong" />
          </View>
          <View style={styles.topGap}>
            <Segmented
              label="Exemplo"
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'a', label: 'Saldos' },
                { value: 'b', label: 'Movimentações' },
                { value: 'c', label: 'Reposição' },
              ]}
            />
          </View>
        </Panel>

        <Panel title="Avisos">
          <View style={styles.stack}>
            <Alert title="Rascunho salvo">
              O estoque só é reservado quando o pedido é confirmado.
            </Alert>
            <Alert tone="success" title="Pedido confirmado">
              Estoque reservado e parcelas geradas.
            </Alert>
            <Alert tone="warning" title="Desconto precisa de nova aprovação">
              Os itens mudaram depois da aprovação do administrador.
            </Alert>
            <Alert
              tone="danger"
              title="Estoque insuficiente"
              action={<Button label="Revisar itens" size="sm" variant="outline" />}
            >
              Café 500 g tem 4 cx disponíveis; o pedido pede 6.
            </Alert>
          </View>
        </Panel>

        <Panel title="Saldos de estoque">
          <StockLegend />
        </Panel>

        <Panel title="Carregamento e vazio" flush>
          <View style={[styles.stack, styles.pad]}>
            <Skeleton width="40%" height={18} />
            <Skeleton />
            <Skeleton width="75%" />
          </View>
          <EmptyState
            icon={Search}
            title="Nenhum cliente encontrado"
            description="Confira a grafia do início do nome."
            size="compact"
          />
        </Panel>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space[10], paddingBottom: space[16] },
  pageCompact: { padding: space[4] },
  inner: { width: '100%', maxWidth: 1040, alignSelf: 'center', gap: space[5] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4], alignItems: 'center' },
  stack: { gap: space[3] },
  dark: {
    flexDirection: 'row',
    gap: space[5],
    alignItems: 'center',
    backgroundColor: color.structure,
    padding: space[5],
    borderRadius: 14,
  },
  swatchBox: { width: 128, gap: 2 },
  swatch: {
    height: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.border,
    marginBottom: space[2],
  },
  typeRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[4] },
  typeName: { width: 140 },
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  gridCompact: { flexDirection: 'column' },
  cell: { flexGrow: 1, flexBasis: 260 },
  topGap: { marginTop: space[5] },
  pad: { padding: space[5] },
});
