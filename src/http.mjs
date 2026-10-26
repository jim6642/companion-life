import http from 'node:http';
import crypto from 'node:crypto';
import { RuntimeError } from './runtime.mjs';
import { serveLifePanel } from './life-panel-static.js';
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
  && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createHttpServer(config, runtime) {
  const limits = new Map();
  return http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const port = req.socket.localPort;
      if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(req.headers.host)) throw new RuntimeError(403, 'Host denied');
      if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`].includes(req.headers.origin)) throw new RuntimeError(403, 'Origin denied');
      const url = new URL(req.url, 'http://localhost');
      if (serveLifePanel(req, res, url.pathname)) return;
      const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
      const binding = config.bindings.find(b => equal(token, b.token));
      const admin = equal(token, config.adminToken);
      if (!binding && !admin) throw new RuntimeError(401, 'Bearer token required');
      const bucketKey = binding?.id || 'admin', minute = Math.floor(Date.now() / 60000);
      const bucket = limits.get(bucketKey);
      if (bucket?.minute === minute && bucket.count >= 120) throw new RuntimeError(429, 'Local request limit exceeded');
      limits.set(bucketKey, { minute, count: bucket?.minute === minute ? bucket.count + 1 : 1 });
      if (url.pathname.startsWith('/life/api/')) {
        if (!admin) throw new RuntimeError(403, 'The life panel requires the admin token');
        if (req.method === 'GET' && url.pathname === '/life/api/bindings') {
          json(200, { ok: true, bindings: config.bindings.map(b => ({ id: b.id, name: b.role, role: b.role })) }); return;
        }
        const id = url.searchParams.get('binding') || config.bindings[0].id, entry = runtime.bindings.get(id);
        if (!entry) throw new RuntimeError(404, 'Unknown life binding');
        if(req.method==='GET'&&url.pathname==='/life/api/calendar'){json(200,{ok:true,calendar:entry.life.calendar(entry.b.role,url.searchParams.get('month')||undefined)});return;}
        if (req.method === 'GET' && url.pathname === '/life/api/view') {
          json(200, { ok: true, view: entry.life.view(entry.b.role, { key: id, date: url.searchParams.get('date') || undefined, name: entry.b.role, admin: true }) }); return;
        }
        if (req.method === 'POST' && ['/life/api/records/revise','/life/api/mode','/life/api/milestones'].includes(url.pathname)) {
          if (runtime.busy(id)) throw new RuntimeError(409, 'Conversation is updating; retry after the turn ends');
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 32768) throw new RuntimeError(413, 'Revision too large'); chunks.push(chunk); }
          let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RuntimeError(400, 'Invalid revision JSON'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RuntimeError(400, 'Revision object required');
          json(200, url.pathname === '/life/api/milestones' ? entry.life.milestone(entry.b.role,body) : url.pathname === '/life/api/mode' ? entry.life.setMode(entry.b.role, body) : entry.life.revise(entry.b.role, body)); return;
        }
        throw new RuntimeError(404, 'Unknown panel route');
      }
      if (req.method === 'GET' && url.pathname === '/v1/status') {
        json(200, { ok: true, version: '0.1.0-alpha.1', ...(admin ? runtime.stats() : { binding: binding.id }) }); return;
      }
      if (!binding) throw new RuntimeError(403, 'Use a binding token for conversation operations');
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length; if (bytes > 131072) throw new RuntimeError(413, 'Request body too large'); chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let body; try { body = raw ? JSON.parse(raw) : {}; } catch { throw new RuntimeError(400, 'Invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RuntimeError(400, 'JSON object required');
      if (body.bindingId !== undefined && body.bindingId !== binding.id) throw new RuntimeError(403, 'Binding mismatch');
      let result;
      if (req.method === 'POST' && url.pathname === '/v1/context') {
        if (body.recent !== undefined && (!Array.isArray(body.recent) || body.recent.some(s => typeof s !== 'string'))) throw new RuntimeError(400, 'recent must be strings');
        result = { context: runtime.context(binding.id, String(body.query || ''), body.recent || []) };
      } else if (req.method === 'POST' && url.pathname === '/v1/turns') result = runtime.startTurn(binding.id, body);
      else if (req.method === 'POST' && url.pathname === '/v1/presence') result = runtime.presence(binding.id, body);
      else if (req.method === 'POST' && url.pathname === '/v1/opportunities/take') result = { opportunity: runtime.takeOpportunity(binding.id) };
      else {
        const match = /^\/v1\/turns\/([a-zA-Z0-9-]+)\/(propose|commit)$/.exec(url.pathname);
        if (req.method !== 'POST' || !match) throw new RuntimeError(404, 'Unknown route');
        result = match[2] === 'propose' ? runtime.propose(binding.id, match[1], body) : runtime.commit(binding.id, match[1], body);
      }
      json(200, { ok: true, ...result });
    } catch (e) { json(e.status || 500, { ok: false, error: e.status ? e.message : 'Local operation failed; inspect configuration and data permissions' }); }
  });
}
