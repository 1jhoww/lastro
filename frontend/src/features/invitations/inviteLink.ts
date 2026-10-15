import * as Linking from 'expo-linking';

/**
 * Link de aceite. No web vira https://<origem>/convite?token=...; no app, lastro://convite?token=...
 * O token é a credencial do convite: mostrar uma vez, copiar, nunca registrar em log ou analytics.
 */
export function invitationLink(token: string): string {
  return Linking.createURL('/convite', { queryParams: { token } });
}
