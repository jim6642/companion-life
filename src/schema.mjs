// Reuse these schemas when registering the model's proposal tool in a host.
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
export const LIFE_EVENT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['date', 'slotId', 'status', 'subject', 'basis', 'certainty', 'details', 'evidence'],
  properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, slotId: text(40),
    status: { enum: ['planned', 'active', 'completed', 'skipped'] },
    subject: { const: 'character' }, basis: { const: 'own_virtual_experience' },
    certainty: { enum: ['settled', 'tentative'] },
    details: { type: 'object', maxProperties: 6, propertyNames: text(24), additionalProperties: text(80) },
    evidence: text(300), activity: text(60), changeReason: text(100), end: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
  },
};
export const FUTURE_PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['action', 'requestEvidence', 'evidence'],
  properties: {
    action: { enum: ['create', 'update', 'cancel', 'complete'] }, id: text(40),
    durationMinutes: { type: 'integer', minimum: 15, maximum: 360 },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
    title: text(80), keywords: { type: 'array', maxItems: 6, items: text(24) },
    changeReason: text(120), requestEvidence: text(300), evidence: text(300),
  },
};
export const PROPOSAL_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  lifeStories: { type: 'array', maxItems: 2, items: { type: 'object', additionalProperties: false,
    required: ['action', 'date', 'subject', 'basis', 'progress', 'evidence'], properties: {
      action: { enum: ['create', 'advance', 'complete', 'drop'] }, date: text(10),
      subject: { const: 'character' }, basis: { const: 'own_virtual_experience' },
      id: text(40), expectedRevision: { type: 'integer', minimum: 1 },
      title: text(60), category: { enum: ['reading', 'hobby', 'daily'] }, progress: text(100), nextStep: text(100), evidence: text(300),
      facts: { type: 'object', maxProperties: 6, propertyNames: text(24), additionalProperties: text(80) },
    } } },
  lifeEvents: { type: 'array', maxItems: 3, items: LIFE_EVENT_SCHEMA },
  futurePlans: { type: 'array', maxItems: 3, items: FUTURE_PLAN_SCHEMA },
} };
