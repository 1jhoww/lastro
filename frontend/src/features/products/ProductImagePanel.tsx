import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import type { Product } from '@/api/types';
import { imageFailure, pickImageFile } from '@/lib/imageFiles';
import { color, radius, space } from '@/theme';
import { Alert, Button, ConfirmDialog, Panel, Text, useToast } from '@/ui';
import { ImageIcon, ImagePlus, Package } from '@/ui/icons';
import {
  useProductImage,
  useRemoveProductImage,
  useUploadProductImage,
  type PickedImage,
} from './api';

/** Escolhe uma foto da galeria e confere formato e tamanho antes de enviar. */
export const pickImage = () => pickImageFile(2048);

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
  // Last photo chosen, kept so a failed upload can be retried without picking it again.
  const [last, setLast] = useState<PickedImage | null>(null);
  const has = Boolean(product.image);
  const busy = upload.isPending || remove.isPending;

  const send = (picked: PickedImage) => {
    upload.reset();
    remove.reset();
    upload.mutate(
      { image: picked, expectedVersion },
      {
        onSuccess: (next) => {
          setLast(null);
          onChanged?.(next);
          toast.show(has ? 'Imagem substituída' : 'Imagem adicionada');
        },
      },
    );
  };
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
    setLast(picked);
    send(picked);
  };

  const failure = pickError
    ? { message: pickError, retryable: false }
    : upload.error
      ? imageFailure(upload.error)
      : remove.error
        ? imageFailure(remove.error)
        : null;

  return (
    <View style={styles.editor}>
      <ImageFrame
        label={has ? `Imagem de ${product.name}` : 'Sem imagem'}
        loading={upload.isPending || (has && image.isPending)}
        uri={has ? image.data : undefined}
        message={has && image.isError ? 'Não foi possível carregar a imagem.' : undefined}
      />
      {failure ? (
        <Alert
          tone="danger"
          title={remove.error ? 'Imagem não removida' : 'Imagem não enviada'}
          action={
            failure.retryable && upload.error && last && canManage ? (
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
            ? `${failure.message} A imagem anterior continua no produto.`
            : failure.message}
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

/**
 * Produto salvo, imagem não. A foto escolhida aparece marcada como não salva, com o motivo e
 * as saídas possíveis; nada some sozinho, a pessoa decide como seguir.
 */
export function ImageUploadFailure({
  image,
  error,
  busy,
  onRetry,
  onChooseOther,
  onSkip,
}: {
  image: PickedImage;
  error: unknown;
  busy: boolean;
  onRetry: () => void;
  onChooseOther: () => void;
  onSkip: () => void;
}) {
  const failure = imageFailure(error);
  return (
    <View style={styles.editor}>
      <ImageFrame label="Imagem escolhida, não salva" uri={image.uri} loading={busy} />
      <Alert tone="danger" title="A imagem não foi salva">
        {failure.message}
      </Alert>
      <View style={styles.actions}>
        {failure.retryable ? (
          <Button
            label="Tentar de novo"
            size="sm"
            loading={busy}
            disabled={busy}
            onPress={onRetry}
          />
        ) : null}
        <Button
          label="Escolher outra imagem"
          icon={ImagePlus}
          size="sm"
          variant={failure.retryable ? 'outline' : 'strong'}
          disabled={busy}
          onPress={onChooseOther}
        />
        <Button
          label="Continuar sem imagem"
          size="sm"
          variant="ghost"
          disabled={busy}
          onPress={onSkip}
        />
      </View>
      <Text variant="caption" color={color.textSecondary}>
        Você também pode adicionar a imagem depois, na ficha do produto.
      </Text>
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

/** Motivo de uma falha de envio, para avisos fora deste painel. */
export const uploadMessage = (error: unknown) => imageFailure(error).message;

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
