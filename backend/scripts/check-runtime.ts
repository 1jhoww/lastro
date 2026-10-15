import { assertRuntime } from '../src/config/runtime.js';
assertRuntime();
console.log(`Runtime validado: Node ${process.versions.node}, OpenSSL ${process.versions.openssl}`);
