/** OneBot v11 send adapter; compatible protocol is not a claim of live QQ host certification. */
export function createOneBotSender({ baseUrl, accessToken = '', kind, targetId }) {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid OneBot URL');
  if (!['private', 'group'].includes(kind) || !/^[1-9]\d*$/.test(String(targetId))) throw Error('Explicit private/group target required');
  return async messages => {
    const sent = [];
    for (const message of messages) {
      const res = await fetch(baseUrl.replace(/\/$/, '') + (kind === 'private' ? '/send_private_msg' : '/send_group_msg'), {
        method: 'POST', headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ [kind === 'private' ? 'user_id' : 'group_id']: String(targetId), message: [{ type: 'text', data: { text: String(message) } }] }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json();
      if (!res.ok || body.status !== 'ok' || body.retcode !== 0 || body.data?.message_id === undefined) {
        const error = new Error('OneBot send failed or receipt unknown; do not auto retry'); error.sent = sent; throw error;
      }
      sent.push(String(message));
    }
    return { status: 'success', deliveredMessages: sent };
  };
}
