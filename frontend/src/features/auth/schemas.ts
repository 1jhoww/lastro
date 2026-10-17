import { z } from 'zod';

const email = z
  .string()
  .trim()
  .min(1, 'Informe seu e-mail.')
  .pipe(z.email('E-mail inválido. Confira se há @ e domínio, como nome@empresa.com.br.'));

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Informe sua senha.'),
});
export type SignInValues = z.infer<typeof signInSchema>;

export const resetSchema = z.object({ email });
export type ResetValues = z.infer<typeof resetSchema>;

/** Mesmas regras de PATCH /me: 2 a 80 caracteres, com letra e sem e-mail. */
export const personName = z
  .string()
  .transform((v) => v.normalize('NFC').trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'Informe seu nome.')
      .max(80, 'Use até 80 caracteres.')
      .refine((v) => /\p{L}/u.test(v) && !v.includes('@'), 'Informe seu nome, não o e-mail.'),
  );

export const signUpSchema = z
  .object({
    name: personName,
    email,
    password: z.string().min(8, 'Use pelo menos 8 caracteres.').max(128, 'Senha longa demais.'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'As senhas não são iguais.',
  });
export type SignUpValues = z.infer<typeof signUpSchema>;

export const reauthSchema = z.object({ password: z.string().min(1, 'Informe sua senha.') });
export type ReauthValues = z.infer<typeof reauthSchema>;

/** Mesmo formato que o backend aceita em POST /users/invitations/accept. */
export const invitationToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{43}$/);
