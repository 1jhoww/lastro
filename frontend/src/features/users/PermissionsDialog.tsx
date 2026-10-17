import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { Member, UsersPage } from '@/api/types';
import { color, space } from '@/theme';
import { Alert, Badge, Button, Checkbox, Dialog, Text, useToast } from '@/ui';
import { memberLabel, useUpdatePermissions } from './api';

type Operation = UsersPage['permissionMatrix'][number];

/** Agrupa as operações por módulo, na ordem em que o servidor as descreve. */
function byModule(matrix: Operation[]) {
  const groups = new Map<string, Operation[]>();
  for (const operation of matrix)
    groups.set(operation.module, [...(groups.get(operation.module) ?? []), operation]);
  return [...groups.entries()];
}

/** Operações que dependem de `id`, direta ou indiretamente. */
function dependents(matrix: Operation[], id: string): string[] {
  const out = new Set<string>();
  const visit = (target: string) => {
    for (const operation of matrix)
      if (operation.requires.includes(target) && !out.has(operation.id)) {
        out.add(operation.id);
        visit(operation.id);
      }
  };
  visit(id);
  return [...out];
}

/** Requisitos de `id`, direta ou indiretamente. */
function requirements(matrix: Operation[], id: string): string[] {
  const out = new Set<string>();
  const visit = (target: string) => {
    for (const requirement of matrix.find((o) => o.id === target)?.requires ?? [])
      if (!out.has(requirement)) {
        out.add(requirement);
        visit(requirement);
      }
  };
  visit(id);
  return [...out];
}

/**
 * Matriz de permissões de um vendedor, por módulo e operação existente. Operações
 * administrativas (usuários, planos, baixas, créditos, estornos) aparecem bloqueadas: o
 * servidor recusa concedê-las a vendedores, qualquer que seja o pedido. Administradores têm
 * acesso completo e não passam por aqui.
 */
export function PermissionsDialog({
  member,
  matrix,
  onClose,
}: {
  member: Member;
  matrix: Operation[];
  onClose: () => void;
}) {
  const toast = useToast();
  const update = useUpdatePermissions();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(member.operations ?? []));
  const configurable = (o: Operation) =>
    o.inPlan && (o.seller === 'default' || o.seller === 'grantable');
  const toggle = (operation: Operation, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) for (const id of [operation.id, ...requirements(matrix, operation.id)]) next.add(id);
      else for (const id of [operation.id, ...dependents(matrix, operation.id)]) next.delete(id);
      return next;
    });
  const chosen = matrix.filter((o) => configurable(o) && selected.has(o.id)).map((o) => o.id);
  const original = (member.operations ?? []).filter((id) =>
    matrix.some((o) => o.id === id && configurable(o)),
  );
  const changed = chosen.length !== original.length || chosen.some((id) => !original.includes(id));
  const defaults = () =>
    setSelected(
      new Set(
        matrix.filter((o) => o.seller === 'required' || o.seller === 'default').map((o) => o.id),
      ),
    );
  const err = update.error ? toApiError(update.error) : null;

  return (
    <Dialog
      visible
      title="Permissões do vendedor"
      description={memberLabel(member)}
      onClose={update.isPending ? () => {} : onClose}
      actions={
        <>
          <Button label="Padrão do vendedor" variant="ghost" onPress={defaults} />
          <Button label="Cancelar" variant="ghost" onPress={onClose} disabled={update.isPending} />
          <Button
            label="Salvar permissões"
            variant="strong"
            loading={update.isPending}
            disabled={!changed}
            onPress={() =>
              update.mutate(
                { member, operations: chosen },
                {
                  onSuccess: () => {
                    toast.show('Permissões salvas');
                    onClose();
                  },
                },
              )
            }
          />
        </>
      }
    >
      {err ? (
        <Alert tone="danger" title="Permissões não salvas">
          {err.code === 'CONFLICT'
            ? 'Este usuário foi alterado por outra pessoa. Feche e abra de novo para editar.'
            : err.userMessage}
        </Alert>
      ) : null}
      <Text variant="small" color={color.textSecondary}>
        A carteira de clientes continua valendo: o vendedor só vê os próprios clientes e pedidos.
        Operações administrativas são exclusivas de administradores.
      </Text>
      {byModule(matrix).map(([module, operations]) => (
        <View key={module} style={styles.module}>
          <Text variant="smallStrong">{module}</Text>
          {operations.map((operation) => {
            const locked = !configurable(operation);
            const note =
              operation.seller === 'required'
                ? 'Sempre incluída'
                : operation.seller === 'never'
                  ? 'Somente administradores'
                  : !operation.inPlan
                    ? 'Fora do plano contratado'
                    : null;
            return (
              <View key={operation.id} style={styles.operation}>
                <View style={styles.flex}>
                  <Checkbox
                    label={operation.label}
                    description={operation.description}
                    checked={
                      operation.seller === 'required' || (!locked && selected.has(operation.id))
                    }
                    disabled={locked}
                    onChange={(on) => toggle(operation, on)}
                  />
                </View>
                {note ? <Badge label={note} tone="neutral" /> : null}
              </View>
            );
          })}
        </View>
      ))}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  module: { gap: space[1] },
  operation: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 220 },
});
