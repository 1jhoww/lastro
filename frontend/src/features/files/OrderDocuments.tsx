import { Fragment } from 'react';
import { View } from 'react-native';
import { Panel, Text } from '@/ui';
import { space } from '@/theme';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { FileActions } from './FileActions';
import { orderDocument } from './api';
export function OrderDocuments({ id }: { id: string }) {
  const session = useSession();
  if (session.isPlatformAdmin || !session.permissions.includes('documents:own:read')) return null;
  return (
    <Fragment key={`${session.user?.uid}:${session.tenantId}:${id}`}>
      <Documents id={id} />
    </Fragment>
  );
}
function Documents({ id }: { id: string }) {
  const { api, tenantId } = useTenantApi();
  return (
    <Panel title="Documentos" description="Documentos oficiais do pedido, sem valor fiscal.">
      <View style={{ gap: space[3] }}>
        <FileActions
          compact
          label="Obter pedido comercial (PDF)"
          load={(signal) => orderDocument(api, tenantId, id, 'commercial', signal)}
        />
        <FileActions
          compact
          label="Obter romaneio sem preços (PDF)"
          load={(signal) => orderDocument(api, tenantId, id, 'packing', signal)}
        />
        <Text variant="small">
          Para WhatsApp, baixe ou compartilhe o arquivo e escolha o destinatário. O aplicativo não
          envia mensagens automaticamente.
        </Text>
        <Text variant="small">
          O romaneio não autoriza nova expedição nem comprova entrega. Arquivos salvos fora do
          Lastro permanecem com quem os recebeu.
        </Text>
      </View>
    </Panel>
  );
}
