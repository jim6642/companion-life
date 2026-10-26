import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { LifeClient } from './adapters/http-client.mjs';
import { PROPOSAL_SCHEMA } from './schema.mjs';

export const MCP_TOOLS = [
  { name: 'life_context', description: 'Read only relevant virtual-life details. Never returns delivery credentials.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false } },
  { name: 'life_propose', description: 'Stage virtual facts/accepted future commitments for the current host turn. Does not save or send messages.', inputSchema: {
    ...PROPOSAL_SCHEMA, properties: { turnId: { type: 'string' }, ...PROPOSAL_SCHEMA.properties }, required: ['turnId'] } },
];
export async function handleMcp(client, request) {
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)))) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  const { method, params = {}, id } = request;
  if (id === undefined) return null;
  const result = value => ({ jsonrpc: '2.0', id, result: value });
  if (method === 'initialize') {
    const supported = ['2024-11-05', '2025-03-26', '2025-06-18'];
    return result({ protocolVersion: supported.includes(params.protocolVersion) ? params.protocolVersion : '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'companion-life', version: '0.1.0-alpha.1' } });
  }
  if (method === 'ping') return result({});
  if (method === 'tools/list') return result({ tools: MCP_TOOLS });
  if (method !== 'tools/call') return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not supported' } };
  try {
    const args = params.arguments || {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('Object arguments required');
    let data;
    if (params.name === 'life_context') {
      if (Object.keys(args).some(k => k !== 'query') || args.query !== undefined && typeof args.query !== 'string') throw Error('Invalid context arguments');
      data = await client.call('/v1/context', { query: args.query || '' });
    } else if (params.name === 'life_propose') {
      if (!/^[a-f0-9-]{36}$/.test(args.turnId || '') || Object.keys(args).some(k => !['turnId', 'lifeEvents', 'futurePlans', 'lifeStories'].includes(k))) throw Error('Invalid turn proposal');
      data = await client.call(`/v1/turns/${args.turnId}/propose`, { lifeEvents: args.lifeEvents, futurePlans: args.futurePlans, lifeStories: args.lifeStories });
    } else throw Error('Unknown tool');
    return result({ content: [{ type: 'text', text: JSON.stringify(data) }] });
  } catch { return result({ isError: true, content: [{ type: 'text', text: 'Memory tool failed; do not resend any delivered chat message.' }] }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const c = loadConfig(), b = c.bindings.find(b => b.id === (process.env.LIFE_BINDING || 'demo'));
    if (!b) throw Error('Unknown binding');
    const client = new LifeClient({ baseUrl: `http://${c.host === '::1' ? '[::1]' : c.host}:${c.port}`, token: b.token });
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
      if (Buffer.byteLength(line) > 131072) { process.stderr.write('MCP message too large\n'); continue; }
      let req; try { req = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }) + '\n'); continue; }
      const response = await handleMcp(client, req); if (response) process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch { process.stderr.write('MCP setup failed; initialize config and start the runtime first.\n'); process.exitCode = 1; }
}
