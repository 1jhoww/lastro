import { useEffect, useState } from 'react';

export const DAILY_PHRASES = [
  'Vamos fazer bons negócios hoje?',
  'Um bom dia começa com tudo organizado.',
  'Cada oportunidade merece atenção.',
  'Hoje é mais um dia para fazer acontecer.',
  'Bons resultados começam com boas decisões.',
  'Sua operação está pronta para avançar.',
  'Um passo de cada vez, sempre em frente.',
  'Novas oportunidades começam hoje.',
  'Organização também é crescimento.',
  'Que hoje seja um dia produtivo.',
] as const;

/** Dias de calendário desde 1970-01-01 na data local do aparelho (sem efeito de horário de verão). */
export function localDayNumber(now: Date): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
}

/** Frase do dia: rotação determinística pela data local, em sequência, reiniciando a cada 10 dias. */
export function phraseFor(now: Date): string {
  const n = DAILY_PHRASES.length;
  return DAILY_PHRASES[((localDayNumber(now) % n) + n) % n]!;
}

/** Milissegundos até a próxima meia-noite local. */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1_000, next.getTime() - now.getTime());
}

/**
 * Frase do dia que troca sozinha na virada da data local, mesmo com a tela aberta. Também confere
 * ao voltar o foco (aparelho suspenso não dispara o temporizador no horário exato).
 */
export function useDailyPhrase(clock: () => Date = () => new Date()): string {
  const [phrase, setPhrase] = useState(() => phraseFor(clock()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const sync = () => {
      clearTimeout(timer);
      const now = clock();
      setPhrase(phraseFor(now));
      timer = setTimeout(sync, msUntilNextDay(now) + 500);
    };
    sync();
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') sync();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', onVisible);
    };
    // clock é estável por contrato (padrão ou injetado nos testes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return phrase;
}
