import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { Fixture } from './fixture.js';
import { financePost } from './finance.js';
import { orderHeaders } from './orders.js';
import { executionView } from '../../src/modules/finance/resolution/executionModel.js';
export type Execution = ReturnType<typeof executionView.parse>;
export async function advanceExecution(f: Fixture, e: Execution, key = randomUUID()) {
  const response = await financePost(
    f,
    `/financial-executions/${e.id}/advance`,
    { expectedRevision: e.revision, fencingToken: e.fencingToken },
    key,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(
    response.body.data?.financialCompleted ? 200 : 202,
  );
  return executionView.parse(response.body.data);
}
export async function finishExecution(
  f: Fixture,
  e: Execution,
  onStep?: (e: Execution) => Promise<void>,
) {
  let calls = 0;
  while (!e.financialCompleted) {
    expect(calls++).toBeLessThan(20_000);
    expect(['PAUSED', 'NEEDS_REVIEW', 'ABORTED']).not.toContain(e.status);
    e = await advanceExecution(f, e);
    await onStep?.(e);
  }
  return e;
}
export async function currentExecution(f: Fixture, id: string) {
  const response = await request(f.app)
    .get(`/api/v1/financial-executions/${id}`)
    .set(orderHeaders(f))
    .expect(200);
  return executionView.parse(response.body.data);
}
export async function refreshFinancialActor(f: Fixture) {
  const token = await f.firebase.auth.createCustomToken(f.ownerA.uid);
  const response = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, returnSecureToken: true }),
    },
  );
  const body: unknown = await response.json();
  if (
    !response.ok ||
    !body ||
    typeof body !== 'object' ||
    !('idToken' in body) ||
    typeof body.idToken !== 'string'
  )
    throw new Error('Reautenticação local falhou');
  f.ownerA.token = body.idToken;
}
