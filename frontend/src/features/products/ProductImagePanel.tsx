import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { toApiError } from '@/api/errors';
import type { Product } from '@/api/types';
import { color, radius, space } from '@/theme';
import { Alert, Button, ConfirmDialog, Panel, Text, useToast } from '@/ui';
import { ImageIcon, ImagePlus, Package } from '@/ui/icons';
import {
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  useProductImage,
  useRemoveProductImage,
  useUploadProductImage,
  type ImageType,
  type PickedImage,
} from './api';

const typeFromUri = (uri: string): ImageType | null => {
  const m = /\.(jpe?g|png|webp)(?:\?|$)/i.exec(uri)?.[1]?.toLowerCase();
  if (!m) return null;
  return m === 'png' ? 'image/png' : m === 'webp' ? 'image/webp' : 'image/jpeg';
};

/** Escolhe uma foto da galeria e valida tipo e tamanho antes de enviar. */
export async function pickImage(): Promise<PickedImage | { error: string } | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 0.85,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const type = (asset.mimeType as ImageType | undefined) ?? typeFromUri(asset.uri) ?? 'image/jpeg';
  if (!IMAGE_TYPES.includes(type)) return { error: 'Use uma imagem JPEG, PNG ou WebP.' };
  if (asset.fileSize !== undefined && asset.fileSize > IMAGE_MAX_BYTES)
    return { error: 'A imagem tem mais de 5 MB. Escolha uma menor.' };
  return { uri: asset.uri, type, sizeBytes: asset.fileSize };
}

/** Miniatura de lista: foto privada (buscada com a sessão) ou o mesmo ícone de "sem imagem". */
export function ProductThumb({
  product,
  size = 40,
}: {
  product: Pick<Product, 'id' | 'image'>;
  size?: number;
}) {
  const image = useProductImage(product);
  const box = { width: size, height: size };
  return (
    <View style={[styles.thumb, box]}>
      {image.data ? (
        <Image source={{ uri: image.data }} style={box} resizeMode="cover" />
      ) : (
        <Package size={size * 0.45} color={color.textSecondary} strokeWidth={1.5} />
      )}
    </View>
  );
}

/** Ficha do produto: imagem atual com as ações de quem administra. */
export function ProductImagePanel({
  product,
  canManage,
}: {
  product: Product;
  canManage: boolean;
}) {
  return (
    <Panel title="Imagem">
      <View style={styles.panelBody}>
        <ProductImageEditor product={product} canManage={canManage} />
      </View>
    </Panel>
  );
}

/**
 * Imagem de um produto já cadastrado. Os bytes chegam pela API autenticada (nunca por URL
 * pública). Envio usa o PUT do contrato; o backend converte para WebP. Sem Storage configurado,
 * o servidor recusa e a mensagem aparece aqui, sem fingir que a imagem foi salva.
 *
 * `expectedVersion` (formulário de edição) usa a versão em que o formulário foi aberto; o
 * produto devolvido vai para `onChanged`, para o formulário seguir dessa versão.
 */
export function ProductImageEditor({
  product,
  canManage,
  expectedVersion = product.version,
  onChanged,
}: {
  product: Product;
  canManage: boolean;
  expectedVersion?: number;
  onChanged?: (product: Product) => void;
}) {
  const image = useProductImage(product);
  const upload = useUploadProductImage(product.id);
  const remove = useRemoveProductImage(product.id);
  const toast = useToast();
  const [pickError, setPickError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const has = Boolean(product.image);
  const busy = upload.isPending || remove.isPending;

  const choose = async () => {
    setPickError(null);
    upload.reset();
    remove.reset();
    const picked = await pickImage();
    if (!picked) return;
    if ('error' in picked) {
      setPickError(picked.error);
      return;
    }
    upload.mutate(
      { image: picked, expectedVersion },
      {
        onSuccess: (next) => {
          onChanged?.(next);
          toast.show(has ? 'Imagem substituída' : 'Imagem adicionada');
        },
      },
    );
  };

  const failure =
    pickError ??
    (upload.error
      ? uploadMessage(upload.error)
      : remove.error
        ? uploadMessage(remove.error)
        : null);

  return (
    <View style={styles.editor}>
      <ImageFrame
        label={has ? `Imagem de ${product.name}` : 'Sem imagem'}
        loading={upload.isPending || (has && image.isPending)}
        uri={has ? image.data : undefined}
        message={has && image.isError ? 'Não foi possível carregar a imagem.' : undefined}
      />
      {failure ? (
        <Alert tone="danger" title={remove.error ? 'Imagem não removida' : 'Imagem não enviada'}>
          {failure}
        </Alert>
      ) : null}
      {canManage ? (
        <ImageActions
          has={has}
          busy={busy}
          uploading={upload.isPending}
          onChoose={choose}
          onRemove={() => setConfirmRemove(true)}
        />
      ) : null}
      <ConfirmDialog
        visible={confirmRemove}
        title="Remover imagem?"
        description="O produto fica sem foto no app e no catálogo. Você pode adicionar outra depois."
        confirmLabel="Remover imagem"
        loading={remove.isPending}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() =>
          remove.mutate(expectedVersion, {
            onSuccess: (next) => {
              onChanged?.(next);
              toast.show('Imagem removida');
            },
            onSettled: () => setConfirmRemove(false),
          })
        }
      />
    </View>
  );
}

/**
 * Imagem escolhida antes de o produto existir (cadastro). Fica só na tela até salvar; o
 * cadastro envia logo depois de criar o produto.
 */
export function PendingImagePicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedImage | null;
  onChange: (image: PickedImage | null) => void;
  disabled?: boolean;
}) {
  const [pickError, setPickError] = useState<string | null>(null);
  const choose = async () => {
    setPickError(null);
    const picked = await pickImage();
    if (!picked) return;
    if ('error' in picked) setPickError(picked.error);
    else onChange(picked);
  };
  return (
    <View style={styles.editor}>
      <ImageFrame label={value ? 'Imagem escolhida' : 'Sem imagem'} uri={value?.uri} />
      {pickError ? (
        <Alert tone="danger" title="Imagem não aceita">
          {pickError}
        </Alert>
      ) : null}
      <ImageActions
        has={Boolean(value)}
        busy={Boolean(disabled)}
        onChoose={choose}
        onRemove={() => onChange(null)}
        note={value ? 'Enviada ao salvar o produto.' : undefined}
      />
    </View>
  );
}

function ImageFrame({
  label,
  uri,
  loading,
  message,
}: {
  label: string;
  uri?: string;
  loading?: boolean;
  message?: string;
}) {
  return (
    <View style={styles.frame} accessibilityLabel={label}>
      {uri ? (
        <Image source={{ uri }} style={styles.image} resizeMode="contain" />
      ) : loading ? (
        <View style={styles.placeholder}>
          <ActivityIndicator color={color.textSecondary} accessibilityLabel="Carregando imagem" />
        </View>
      ) : (
        <View style={styles.placeholder}>
          <ImageIcon size={28} color={color.textSecondary} strokeWidth={1.5} />
          <Text variant="small" color={color.textSecondary} align="center">
            {message ?? 'Sem imagem'}
          </Text>
        </View>
      )}
      {uri && loading ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={color.text} accessibilityLabel="Enviando imagem" />
        </View>
      ) : null}
    </View>
  );
}

function ImageActions({
  has,
  busy,
  uploading,
  onChoose,
  onRemove,
  note,
}: {
  has: boolean;
  busy: boolean;
  uploading?: boolean;
  onChoose: () => void;
  onRemove: () => void;
  note?: string;
}) {
  return (
    <View style={styles.actionsBlock}>
      <View style={styles.actions}>
        <Button
          label={has ? 'Substituir' : 'Adicionar imagem'}
          icon={ImagePlus}
          variant="outline"
          size="sm"
          loading={uploading}
          disabled={busy}
          onPress={onChoose}
        />
        {has ? (
          <Button label="Remover" variant="ghost" size="sm" disabled={busy} onPress={onRemove} />
        ) : null}
      </View>
      <Text variant="caption" color={color.textSecondary}>
        {note ?? 'JPEG, PNG ou WebP, até 5 MB.'}
      </Text>
    </View>
  );
}

export function uploadMessage(error: unknown): string {
  const err = toApiError(error);
  if (err.code === 'INVALID_IMAGE')
    return 'A imagem não foi aceita. Use JPEG, PNG ou WebP de até 5 MB, sem animação.';
  if (err.code === 'CONFLICT')
    return 'O produto mudou enquanto você enviava. Carregue a versão atual e envie de novo.';
  if (err.kind === 'server')
    return 'O servidor não conseguiu guardar a imagem. Se o armazenamento de arquivos não estiver configurado neste ambiente, o envio não funciona.';
  return err.userMessage;
}

const styles = StyleSheet.create({
  panelBody: { paddingTop: space[1] },
  editor: { gap: space[3] },
  frame: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 260,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSunken,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[2] },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  actionsBlock: { gap: space[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  thumb: {
    borderRadius: radius.sm,
    backgroundColor: color.surfaceSunken,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
