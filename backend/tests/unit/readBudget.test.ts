import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadGate, accountRead, checkReadBudget } from '../../src/shared/operations/readBudget.js';
import { assertRuntime } from '../../src/config/runtime.js';

afterEach(() => vi.useRealTimers());
describe('F05: orçamento de leituras e backpressure', () => {
  it('retém cota depois do timeout enquanto RPC permanece pendente', async () => {
    vi.useFakeTimers();
    const gate = new ReadGate(1, 20);
    let release!: () => void;
    let reads = 0;
    const pending = gate.run(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      checkReadBudget();
      reads++;
      return true;
    });
    const expired = expect(pending).rejects.toMatchObject({ code: 'READ_TIME_LIMIT' });
    await vi.advanceTimersByTimeAsync(21);
    await expired;
    await expect(gate.run(async () => true)).rejects.toMatchObject({ code: 'READ_BUSY' });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(0);
    await expect(gate.run(async () => true)).resolves.toBe(true);
  });
  it('interrompe próximas leituras após desconexão, sem soltar RPC pendente', async () => {
    const gate = new ReadGate(1);
    const controller = new AbortController();
    let release!: () => void;
    const pending = gate.run(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      checkReadBudget();
    }, controller.signal);
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'READ_CANCELLED' });
    controller.abort();
    await cancelled;
    await expect(gate.run(async () => true)).rejects.toMatchObject({ code: 'READ_BUSY' });
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(gate.run(async () => true)).resolves.toBe(true);
  });
  it('recusa payload acumulado e libera cota após falha', async () => {
    const gate = new ReadGate(1, 1000, 100);
    await expect(
      gate.run(async () => {
        accountRead('x'.repeat(40));
        accountRead('y'.repeat(40));
      }),
    ).rejects.toMatchObject({ code: 'READ_MEMORY_LIMIT', status: 413 });
    await expect(gate.run(async () => true)).resolves.toBe(true);
  });
  it('compartilha prazo e bytes em chamadas aninhadas', async () => {
    const gate = new ReadGate(1, 1000, 100);
    await expect(
      gate.run(async () => {
        accountRead('x'.repeat(30));
        await new ReadGate().run(async () => accountRead('y'.repeat(30)));
      }),
    ).rejects.toMatchObject({ code: 'READ_MEMORY_LIMIT' });
  });
});
describe('F06: runtime suportado', () => {
  it.each(['22.23.3', '23.11.0', '24.21.0', '25.0.0', '20.20.0', '24.22.bad'])(
    'recusa Node %s',
    (version) => {
      expect(() => assertRuntime(version)).toThrow('Runtime não suportado');
    },
  );
  it.each(['24.22.0', '24.23.0'])('aceita Node %s', (version) => {
    expect(() => assertRuntime(version)).not.toThrow();
  });
});
