import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { toApiError } from '@/api/errors';
import type { Product } from '@/api/types';
import { color, radius, space } from '@/theme';
import { Alert, Button, ConfirmDialog, Panel, Skeleton, Text, useToast } from '@/ui';
import { ImageIcon, ImagePlus } from '@/ui/icons';
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

/**
 * Foto do produto. Os bytes chegam pela API autenticada (nunca por URL pública). Envio usa o
 * PUT do contrato; o backend converte para WebP. Sem Storage configurado, o servidor recusa e a
 * mensagem aparece aqui, sem fingir que a imagem foi salva.
 */
export function ProductImagePanel({
  product,
  canManage,
}: {
  product: Product;
  canManage: boolean;
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
    const picked = await pickImage();
    if (!picked) return;
    if ('error' in picked) {
      setPickError(picked.error);
      return;
    }
    upload.mutate(
      { image: picked, expectedVersion: product.version },
      { onSuccess: () => toast.show(has ? 'Imagem trocada' : 'Imagem enviada') },
    );
  };

  const failure = pickError ?? (upload.error ? uploadMessage(upload.error) : null);

  return (
    <Panel title="Imagem">
      <View style={styles.body}>
        <View
          style={styles.frame}
          accessibilityLabel={has ? `Imagem de ${product.name}` : 'Sem imagem'}
        >
          {upload.isPending ? (
            <Skeleton width="100%" height={220} rounded={radius.md} />
          ) : has && image.data ? (
            <Image source={{ uri: image.data }} style={styles.image} resizeMode="contain" />
          ) : has && image.isPending ? (
            <Skeleton width="100%" height={220} rounded={radius.md} />
          ) : (
            <View style={styles.placeholder}>
              <ImageIcon size={28} color={color.textSecondary} strokeWidth={1.5} />
              <Text variant="small" color={color.textSecondary} align="center">
                {has && image.isError ? 'Não foi possível carregar a imagem.' : 'Sem imagem'}
              </Text>
            </View>
          )}
        </View>
        {has && product.image ? (
          <Text variant="caption" color={color.textSecondary}>
            {`${product.image.width} × ${product.image.height} px, ${Math.ceil(product.image.sizeBytes / 1024)} KB`}
          </Text>
        ) : null}
        {failure ? (
          <Alert tone="danger" title="Imagem não enviada">
            {failure}
          </Alert>
        ) : null}
        {canManage ? (
          <View style={styles.actions}>
            <Button
              label={has ? 'Trocar imagem' : 'Enviar imagem'}
              icon={ImagePlus}
              variant="outline"
              size="sm"
              loading={upload.isPending}
              disabled={busy}
              onPress={choose}
            />
            {has ? (
              <Button
                label="Remover"
                variant="ghost"
                size="sm"
                disabled={busy}
                onPress={() => setConfirmRemove(true)}
              />
            ) : null}
          </View>
        ) : null}
        {canManage ? (
          <Text variant="caption" color={color.textSecondary}>
            JPEG, PNG ou WebP, até 5 MB.
          </Text>
        ) : null}
      </View>
      <ConfirmDialog
        visible={confirmRemove}
        title="Remover imagem?"
        description="O produto fica sem foto no app e no catálogo. Você pode enviar outra depois."
        confirmLabel="Remover imagem"
        loading={remove.isPending}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() =>
          remove.mutate(product.version, {
            onSuccess: () => toast.show('Imagem removida'),
            onSettled: () => setConfirmRemove(false),
          })
        }
      />
    </Panel>
  );
}

function uploadMessage(error: unknown): string {
  const err = toApiError(error);
  if (err.code === 'INVALID_IMAGE')
    return 'A imagem não foi aceita. Use JPEG, PNG ou WebP de até 5 MB, sem animação.';
  if (err.code === 'CONFLICT')
    return 'O produto mudou enquanto você enviava. A versão atual foi carregada; envie de novo.';
  if (err.kind === 'server')
    return 'O servidor não conseguiu guardar a imagem. Se o armazenamento de arquivos não estiver configurado neste ambiente, o envio não funciona.';
  return err.userMessage;
}

const styles = StyleSheet.create({
  body: { gap: space[3], paddingTop: space[1] },
  frame: {
    height: 220,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSunken,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
