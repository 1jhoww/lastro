import { useLocalSearchParams } from 'expo-router';
import { OrderReturns } from '@/features/orders/OrderReturns';

export default function OrderReturnsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OrderReturns id={id} />;
}
