import { deleteApp } from 'firebase-admin/app';
import { loadConfig } from '../config/env.js';
import { createFirebase } from '../infrastructure/firebase/client.js';
import { createApp } from './app.js';
import { assertRuntime } from '../config/runtime.js';
assertRuntime();
const config = loadConfig();
const firebase = createFirebase(config);
const app = createApp(config, firebase);
const server = app.listen(config.port, config.mode === 'emulator' ? '127.0.0.1' : '0.0.0.0', () =>
  console.log(JSON.stringify({ event: 'server.started', port: config.port, mode: config.mode })),
);
// Transport receipt limits. Handler processing has an independent deadline in app.ts.
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    server.close(() => {
      void firebase.db
        .terminate()
        .then(() => deleteApp(firebase.app))
        .then(() => {
          clearTimeout(timeout);
          process.exit(0);
        });
    });
  });
