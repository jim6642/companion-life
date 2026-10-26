export class LifeClient {
  constructor({ baseUrl, token }) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid runtime URL');
    this.base = baseUrl.replace(/\/$/, ''); this.token = token;
  }
  async call(route, body) {
    const res = await fetch(this.base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000) });
    const result = await res.json(); if (!res.ok || !result.ok) throw Error(`Runtime ${res.status}: ${result.error || 'operation failed'}`); return result;
  }
}

/** Host owns delivery and the commit capability. Never pass the full turn object to the model. */
export async function runChatTurn({ client, userText, recent = [], generate, send, opportunity = null }) {
  let turn;
  try { turn = opportunity || await client.call('/v1/turns', { userText, recent }); }
  catch { // Sidecar failure must not make an otherwise working chatbot disappear.
    const response = await generate({ userText, context: '', instruction: '', propose: async () => ({ ok: false, saved: false }) });
    const messages = Array.isArray(response) ? response : [response];
    const receipt = await send(messages);
    if (receipt?.status !== 'success') throw Error('Host did not confirm delivery');
    return { delivered: true, memory: { ok: false, unavailable: true }, noResend: true };
  }
  try {
    const response = await generate({ userText, context: turn.context, instruction: turn.instruction,
      propose: body => client.call(`/v1/turns/${turn.turnId}/propose`, body) });
    const messages = Array.isArray(response) ? response : [response];
    const receipt = await send(messages);
    if (!receipt || receipt.status !== 'success') throw Error('Host did not confirm delivery');
    try {
      const memory = await client.call(`/v1/turns/${turn.turnId}/commit`, { commitToken: turn.commitToken,
        delivery: { status: 'success' }, deliveredMessages: receipt.deliveredMessages || messages });
      return { delivered: true, memory, noResend: true };
    } catch { return { delivered: true, memory: { ok: false, error: 'Delivery succeeded but memory not confirmed' }, noResend: true }; }
  } catch (error) {
    try { await client.call(`/v1/turns/${turn.turnId}/commit`, { commitToken: turn.commitToken, delivery: { status: 'failed' } }); } catch {}
    // A partial/unknown transport failure is not automatically retried.
    throw error;
  }
}
