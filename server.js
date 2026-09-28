// Production entry: wraps the adapter-node handler in an http server whose request timeout
// does not cut off multi-hundred-megabyte RAW uploads on slow home uplinks.
import http from 'node:http';
import { validateRuntime } from './scripts/runtime-config.mjs';
validateRuntime(process.env);
const { handler } = await import('./build/handler.js');

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const server = http.createServer(handler);
server.requestTimeout = 0;          // uploads may take longer than Node's default 300 s
server.headersTimeout = 60_000;
server.keepAliveTimeout = 65_000;
server.listen(port, host, () => console.log(`[gatherframe] listening on http://${host}:${port}`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 55000).unref(); });
