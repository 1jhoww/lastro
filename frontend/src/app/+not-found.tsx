import { Link } from 'expo-router';
import { View } from 'react-native';
import { MapPinOff } from '@/ui/icons';
import { color } from '@/theme';
import { Button, EmptyState } from '@/ui';

export default function NotFound() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: color.canvas }}>
      <EmptyState
        icon={MapPinOff}
        title="Página não encontrada"
        description="O endereço pode ter mudado ou o registro não está no seu acesso."
        action={
          <Link href="/" asChild>
            <Button label="Ir para o início" variant="strong" />
          </Link>
        }
      />
    </View>
  );
}
