import { loadConfig } from './config.mjs';
import { lockData } from './lock.mjs';
import { createRuntime } from './runtime.mjs';
import { createHttpServer } from './http.mjs';

try {
  const config = loadConfig();
  const release = lockData(config.dataDir);
  process.on('exit', release);
  const runtime = createRuntime(config, { onError: () => process.stderr.write('Memory maintenance warning; ordinary chat must continue.\n') });
  const server = createHttpServer(config, runtime);
  const timer = setInterval(() => { runtime.tick().catch(() => {}); }, 60000);
  timer.unref();
  server.on('error', error => { clearInterval(timer); release(); console.error(error.code === 'EADDRINUSE' ? 'Port already in use. Change port or stop the existing runtime.' : 'Runtime cannot listen. Run npm run doctor.'); process.exitCode = 1; });
  server.listen(config.port, config.host, () => {
    console.log(`Companion Life ready: http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}`);
    runtime.tick().catch(() => {});
  });
  const stop = () => { clearInterval(timer); server.closeAllConnections(); server.close(() => { release(); process.exit(0); }); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch { console.error('Startup failed. Run npm run init (first use) or npm run doctor. No data was reset.'); process.exitCode = 1; }
