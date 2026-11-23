// Quo (phone system): key + webhook setup, and the doPost receiver turning
// calls / recordings / transcripts / summaries / voicemails / texts into Events.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const TANNER = 'tanner@armortexroofs.com';
const NOW = new Date('2026-11-24T15:00:00Z');

/** A fake Quo API: answers the calls our code makes. */
function quoApi(ctx, state) {
  state = state || {};
  state.calls = state.calls || {};
  state.messages = state.messages || {};
  state.webhooks = state.webhooks || [];
  ctx.fetchHandler = (url, opts) => {
    const path = url.replace('https://api.quo.com', '');
    const method = String(opts.method || 'get').toLowerCase();
    const auth = opts.headers && opts.headers.Authorization;
    let m;
    if (auth !== 'key-123') return { code: 401, text: JSON.stringify({ error: { message: 'Unauthorized', key: 'Unauthorized' } }) };
    if (path === '/v1/users') return { code: 200, text: JSON.stringify({ data: [{ id: 'US1', email: TANNER, firstName: 'Tanner', lastName: 'Fought' }, { id: 'US2', email: OWNER, firstName: 'Brian' }] }) };
    if (path === '/v1/phone-numbers') return { code: 200, text: JSON.stringify({ data: [{ id: 'PN1', number: '+19035550100', name: 'Tanner', users: [{ id: 'US1' }] }, { id: 'PN2', number: '+19035550199', name: 'Office', users: [{ id: 'US2' }] }] }) };
    if (path === '/webhooks' && method === 'post') {
      assert.equal(opts.headers['Quo-Api-Version'], '2026-03-30');
      const body = JSON.parse(opts.payload);
      state.webhooks.push(body);
      return { code: 201, text: JSON.stringify({ data: { id: String(state.webhooks.length), key: 'whsec_abc', url: body.url, events: body.events, resourceIds: body.resourceIds, status: 'enabled' } }) };
    }
    if (/^\/webhooks\/\d+$/.test(path) && method === 'delete') { state.deleted = (state.deleted || []).concat(path); return { code: 204, text: '' }; }
    if (/^\/webhooks\/\d+\/events\/test$/.test(path)) return { code: 200, text: JSON.stringify({ id: 'EVtest', type: JSON.parse(opts.payload).eventType }) };
    if (/^\/webhooks\/\d+\/events\/D1$/.test(path)) return { code: 200, text: JSON.stringify({ data: { id: 'D1', eventType: 'call.completed', attempts: [{ id: 'A1', timestamp: NOW.toISOString(), status: 'failed', responseStatusCode: 302, responseBody: '<HTML><HEAD><TITLE>Moved Temporarily</TITLE></HEAD><BODY>The document has moved</BODY></HTML>', responseDurationMs: 120 }] } }) };
    if (/^\/webhooks\/\d+\/events/.test(path)) return { code: 200, text: JSON.stringify({ data: [{ id: 'D1', eventType: 'call.completed', status: 'success', createdAt: NOW.toISOString() }] }) };
    // contacts
    state.contacts = state.contacts || {};
    if (path.indexOf('/v1/contacts?') === 0 && method === 'get') {
      const ext = decodeURIComponent((path.match(/externalIds=([^&]+)/) || [])[1] || '');
      const hits = Object.values(state.contacts).filter(c => c.externalId === ext);
      return { code: 200, text: JSON.stringify({ data: hits }) };
    }
    if (path === '/v1/contacts' && method === 'post') {
      const body = JSON.parse(opts.payload); state.seq = (state.seq || 0) + 1; const id = 'CT' + state.seq;
      state.contacts[id] = Object.assign({ id }, body, body.defaultFields); state.log = (state.log || []).concat(['post ' + id]);
      return { code: 201, text: JSON.stringify({ data: state.contacts[id] }) };
    }
    m = null;
    m = path.match(/^\/v1\/contacts\/(.+)$/);
    if (m && method === 'patch') {
      const id = decodeURIComponent(m[1]); if (!state.contacts[id]) return { code: 404, text: '{"message":"not found"}' };
      const body = JSON.parse(opts.payload); Object.assign(state.contacts[id], body, body.defaultFields); state.log = (state.log || []).concat(['patch ' + id]);
      return { code: 200, text: JSON.stringify({ data: state.contacts[id] }) };
    }
    m = path.match(/^\/v1\/calls\/(.+)$/);
    if (m) { const c = state.calls[decodeURIComponent(m[1])]; return c ? { code: 200, text: JSON.stringify({ data: c }) } : { code: 404, text: '{"message":"not found"}' }; }
    m = path.match(/^\/v1\/messages\/(.+)$/);
    if (m) { const c = state.messages[decodeURIComponent(m[1])]; return c ? { code: 200, text: JSON.stringify({ data: c }) } : { code: 404, text: '{"message":"not found"}' }; }
    return { code: 404, text: '{}' };
  };
  return state;
}

/** An app with a partner (Terri, 903-555-0123), Quo connected and the webhook registered. */
function connectedApp() {
  const ctx = { user: OWNER, appUrl: 'https://script.google.com/a/macros/armortexroofs.com/s/ABC/exec' };
  const app = loadApp(ctx);
  app.setup();
  app.saveUser({ email: TANNER, name: 'Tanner', role: 'sales' });
  app.importPartners('Name,Email,Phone,Brokerage\nTerri Searcy,terri@example.com,(903) 555-0123,Texas Real Estate Executives\nCarla Conley,carla@example.com,903-555-0124,TREE', { sourceList: 'tyler', rep: TANNER });
  const state = quoApi(ctx, {});
  app.saveQuoApiKey('key-123');
  app.quoRegisterWebhook(ctx.appUrl);
  const token = app.PropertiesService.getScriptProperties().getProperty('QUO_HOOK_TOKEN');
  const post = (envelope, params) => app.doPost({ parameter: Object.assign({ src: 'quo', token: token }, params || {}), postData: { contents: JSON.stringify(envelope) } });
  return { app, ctx, state, token, post };
}

function callEnvelope(type, resource, extra) {
  return Object.assign({ id: 'EV-' + type, apiVersion: '2026-03-30', createdAt: NOW.toISOString(), type: type,
    data: { resource: resource, context: Object.assign({ orgId: 'OR1', phoneNumberId: 'PN1', userId: 'US1', participants: { workspace: ['+19035550100'], external: ['+19035550123'], resolution: 'available' } }, extra || {}), links: { quo: null } } });
}

test('connecting: a bad key is refused and not kept; a good key lists numbers and users', () => {
  const ctx = { user: OWNER };
  const app = loadApp(ctx);
  app.setup();
  quoApi(ctx, {});
  assert.throws(() => app.saveQuoApiKey('wrong'), /rejected that key/);
  assert.equal(app.quoStatus().keySet, false);
  const st = app.saveQuoApiKey('key-123');
  assert.equal(st.keySet, true); assert.equal(st.keyTail, '-123');
  assert.deepEqual(st.numbers.map(n => n.id), ['PN1', 'PN2']);
  assert.deepEqual(st.numbers[0].users, [TANNER]);
  assert.deepEqual(st.watch, ['PN1', 'PN2'], 'first connect watches everything');
  assert.throws(() => app.saveQuoApiKey(''), /Paste the API key/);
});

test('registering the webhook: /exec only, token in the URL, events + numbers sent, old one deleted', () => {
  const { app, ctx, state } = connectedApp();
  assert.equal(state.webhooks.length, 1);
  const hook = state.webhooks[0];
  assert.ok(/^https:\/\/script\.google\.com\/.+\/exec\?src=quo&token=[A-Za-z0-9]+$/.test(hook.url), hook.url);
  assert.deepEqual(hook.events, app.QUO_HOOK_EVENTS);
  assert.deepEqual(hook.resourceIds, ['PN1', 'PN2']);
  assert.throws(() => app.quoRegisterWebhook('https://script.google.com/a/macros/x/s/ABC/dev'), /\/exec/);
  // the /dev deployment id with /exec on the end is the trap Brian fell into on 2026-11-22
  app.saveSettings({ dev_url: 'https://script.google.com/a/macros/x/s/DEVID123/dev' });
  assert.throws(() => app.quoRegisterWebhook('https://script.google.com/a/macros/x/s/DEVID123/exec'), /Manage deployments/);
  // narrowing the numbers re-registers and removes the old webhook
  app.saveQuoWatch(['PN1']);
  assert.equal(state.webhooks.length, 2);
  assert.deepEqual(state.webhooks[1].resourceIds, ['PN1']);
  assert.deepEqual(state.deleted, ['/webhooks/1']);
  const st = app.quoStatus();
  assert.equal(st.webhookId, '2');
  assert.ok(st.webhookUrl.indexOf('token=…') !== -1, 'token is hidden from the UI');
  // Tanner cannot touch any of this
  ctx.user = TANNER;
  assert.throws(() => app.quoStatus(), /cannot do that/);
  assert.throws(() => app.quoRegisterWebhook(ctx.appUrl), /cannot do that/);
  ctx.user = OWNER;
});

test('doPost: wrong source or token stores nothing', () => {
  const { app, post } = connectedApp();
  const r1 = JSON.parse(app.doPost({ parameter: { src: 'other' }, postData: { contents: '{}' } }).getContent());
  assert.equal(r1.ok, false);
  const r2 = JSON.parse(post(callEnvelope('call.completed', { id: 'AC1' }), { token: 'nope' }).getContent());
  assert.equal(r2.ok, false); assert.equal(r2.error, 'bad token');
  assert.equal(app.$rows('Events').length, 0);
});

test('a finished outgoing call lands on the matching partner, bumps Last Contact, and is verified against Quo first', () => {
  const { app, state, post } = connectedApp();
  const res = { id: 'AC1', direction: 'outgoing', status: 'answered', createdAt: '2026-11-24T14:50:00Z', answeredAt: '2026-11-24T14:50:05Z', completedAt: '2026-11-24T14:55:00Z', duration: 295, hasVoicemail: false };
  // not known to Quo's API → a forged or stale post → ignored
  let r = JSON.parse(post(callEnvelope('call.completed', res)).getContent());
  assert.equal(r.result.action, 'ignored'); assert.match(r.result.reason, /could not confirm call AC1/);
  assert.equal(app.$rows('Events').length, 0);
  // now Quo knows it
  state.calls.AC1 = { id: 'AC1', direction: 'outgoing', status: 'completed', duration: 295, participants: ['+19035550123'], createdAt: res.createdAt, completedAt: res.completedAt };
  r = JSON.parse(post(callEnvelope('call.completed', res)).getContent());
  assert.equal(r.result.action, 'added');
  const ev = app.$rows('Events')[0];
  const terri = app.$rows('Partners').find(p => p.Name === 'Terri Searcy');
  assert.equal(ev['Partner ID'], terri.ID);
  assert.equal(ev.Kind, 'call'); assert.equal(ev.Outcome, 'talked'); assert.equal(ev.Direction, 'out');
  assert.equal(String(ev.Duration), '295'); assert.equal(ev.Phone, '9035550123');
  assert.equal(ev.By, TANNER); assert.equal(ev.Source, 'quo'); assert.equal(ev['Source ID'], 'AC1');
  assert.equal(ev['Needs Review'], '');
  assert.equal(new Date(ev.At).toISOString(), '2026-11-24T14:55:00.000Z');
  assert.equal(new Date(terri['Last Contact']).toISOString(), '2026-11-24T14:55:00.000Z');
  // the same delivery again (Quo retries) does not duplicate
  r = JSON.parse(post(callEnvelope('call.completed', res)).getContent());
  assert.equal(r.result.action, 'updated');
  assert.equal(app.$rows('Events').length, 1);
  // the record shows it
  const rec = app.getPartner(terri.ID);
  assert.equal(rec.metrics.calls, 1); assert.equal(rec.metrics.talked, 1);
});

test('recording, transcript, summary and voicemail update the same call row, in any order', () => {
  const { app, state, post } = connectedApp();
  state.calls.AC2 = { id: 'AC2', direction: 'outgoing', status: 'completed', duration: 61, participants: ['+19035550123'], createdAt: '2026-11-24T14:00:00Z', completedAt: '2026-11-24T14:01:01Z' };
  // transcript arrives before the call.completed event
  let r = JSON.parse(post(callEnvelope('call.transcript.completed', { callId: 'AC2', createdAt: '2026-11-24T14:01:30Z', duration: 61, processingStatus: 'completed', dialogue: [{ userId: 'US1', identifier: null, content: 'Hi Terri, Tanner with ArmorTex.', start: 0, end: 3 }, { userId: null, identifier: '+19035550123', content: 'Oh hi, yes send the sample.', start: 3, end: 6 }] })).getContent());
  assert.equal(r.result.action, 'added');
  r = JSON.parse(post(callEnvelope('call.completed', { id: 'AC2', direction: 'outgoing', status: 'answered', createdAt: '2026-11-24T14:00:00Z', completedAt: '2026-11-24T14:01:01Z', duration: 61, hasVoicemail: false })).getContent());
  assert.equal(r.result.action, 'updated');
  r = JSON.parse(post(callEnvelope('call.recording.completed', { id: 'AC2', direction: 'outgoing', duration: 61, recordings: [{ id: 'RE1', duration: 61, type: 'audio/mpeg', url: 'https://rec.example.com/RE1.mp3' }] })).getContent());
  assert.equal(r.result.action, 'updated');
  r = JSON.parse(post(callEnvelope('call.summary.completed', { callId: 'AC2', processingStatus: 'completed', summary: ['Terri wants the sample report.'], nextSteps: ['Email the sample today.'], handledByAiAgent: false, jobs: [] })).getContent());
  assert.equal(r.result.action, 'updated');
  // an in-progress summary is ignored, not stored half-done
  r = JSON.parse(post(callEnvelope('call.summary.completed', { callId: 'AC2', processingStatus: 'in-progress', summary: null, nextSteps: null })).getContent());
  assert.equal(r.result.action, 'ignored');
  const evs = app.$rows('Events');
  assert.equal(evs.length, 1);
  const ev = evs[0];
  assert.equal(ev.Outcome, 'talked'); assert.equal(String(ev.Duration), '61');
  assert.equal(ev['Recording URL'], 'https://rec.example.com/RE1.mp3');
  assert.equal(ev.Transcript, 'Tanner Fought: Hi Terri, Tanner with ArmorTex.\nTerri Searcy: Oh hi, yes send the sample.', 'the other side is named when the number is known');
  assert.equal(ev.Snippet, 'Terri wants the sample report. Next: Email the sample today.');
  // a voicemail we left on an unanswered call
  state.calls.AC3 = { id: 'AC3', direction: 'outgoing', status: 'no-answer', duration: 0, participants: ['+19035550124'], createdAt: '2026-11-24T14:10:00Z', completedAt: '2026-11-24T14:10:40Z' };
  post(callEnvelope('call.completed', { id: 'AC3', direction: 'outgoing', status: 'unanswered', createdAt: '2026-11-24T14:10:00Z', completedAt: '2026-11-24T14:10:40Z', duration: null, hasVoicemail: false }, { participants: { workspace: ['+19035550100'], external: ['+19035550124'], resolution: 'available' } }));
  post(callEnvelope('call.voicemail.completed', { id: 'ACvm', voicemailId: 'VM1', callId: 'AC3', direction: 'outgoing', duration: 12, from: '+19035550100', to: '+19035550124', transcript: 'Hi Carla, Tanner here, call me back.', recordingUrl: 'https://rec.example.com/VM1.mp3', createdAt: '2026-11-24T14:10:50Z' }));
  const carla = app.$rows('Partners').find(p => p.Name === 'Carla Conley');
  const vm = app.$rows('Events').find(e => e['Source ID'] === 'AC3');
  assert.equal(vm['Partner ID'], carla.ID); assert.equal(vm.Outcome, 'voicemail'); assert.equal(vm.Transcript, 'Hi Carla, Tanner here, call me back.'); assert.equal(vm['Recording URL'], 'https://rec.example.com/VM1.mp3');
});

test('texts: one in, one out; an incoming text shows under Today\'s replies and wants a call', () => {
  const { app, state, post } = connectedApp();
  state.messages.AM1 = { id: 'AM1', direction: 'incoming', from: '+19035550123', to: ['+19035550100'], text: 'Can you look at 214 Bayhills Dr?', createdAt: '2026-11-24T14:30:00Z' };
  state.messages.AM2 = { id: 'AM2', direction: 'outgoing', from: '+19035550100', to: ['+19035550123'], text: 'On it, report by Thursday.', createdAt: '2026-11-24T14:32:00Z' };
  let r = JSON.parse(post({ id: 'EVm1', type: 'message.received', createdAt: NOW.toISOString(), data: { resource: { id: 'AM1', direction: 'incoming', text: 'Can you look at 214 Bayhills Dr?', media: [], status: 'received', createdAt: '2026-11-24T14:30:00Z' }, context: { orgId: 'OR1', phoneNumberId: 'PN1', userId: 'US1', contacts: { ids: [], lookupStatus: 'none' }, senderIdentifier: '+19035550123', recipientIdentifiers: ['+19035550100'] }, links: { quo: null } } }).getContent());
  assert.equal(r.result.action, 'added');
  r = JSON.parse(post({ id: 'EVm2', type: 'message.delivered', createdAt: NOW.toISOString(), data: { resource: { id: 'AM2', direction: 'outgoing', text: 'On it, report by Thursday.', media: [], status: 'delivered', createdAt: '2026-11-24T14:32:00Z' }, context: { orgId: 'OR1', phoneNumberId: 'PN1', userId: 'US1', contacts: { ids: [], lookupStatus: 'none' }, senderIdentifier: '+19035550100', recipientIdentifiers: ['+19035550123'] }, links: { quo: null } } }).getContent());
  assert.equal(r.result.action, 'added');
  const terri = app.$rows('Partners').find(p => p.Name === 'Terri Searcy');
  const evs = app.$rows('Events').filter(e => e['Partner ID'] === terri.ID);
  assert.deepEqual(evs.map(e => [e.Kind, e.Direction, e.Outcome, e.By]), [['text', 'in', 'received', 'quo'], ['text', 'out', 'sent', TANNER]]);
  assert.equal(evs[0].Snippet, 'Can you look at 214 Bayhills Dr?');
  const work = app.getTodayWork({ rep: 'all' });
  assert.deepEqual(work.replies.map(x => x.event.Kind), ['text']);
  assert.deepEqual(work.calls.map(p => [p.Name, p.why]), [['Terri Searcy', 'replied']]);
  assert.equal(app.getPartner(terri.ID).metrics.texts, 2);
});

test('a missed incoming call puts them on the call list and does not count as contact; a call back clears it', () => {
  const { app, state, post } = connectedApp();
  const terri = app.$rows('Partners').find(p => p.Name === 'Terri Searcy');
  state.calls.AC5 = { id: 'AC5', direction: 'incoming', status: 'missed', duration: 0, participants: ['+19035550123'], createdAt: '2026-11-24T13:00:00Z', completedAt: '2026-11-24T13:00:30Z' };
  post(callEnvelope('call.completed', { id: 'AC5', direction: 'incoming', status: 'unanswered', createdAt: '2026-11-24T13:00:00Z', completedAt: '2026-11-24T13:00:30Z', duration: null, hasVoicemail: false }));
  let ev = app.$rows('Events')[0];
  assert.equal(ev.Outcome, 'missed'); assert.equal(ev.Direction, 'in'); assert.equal(ev.By, 'quo');
  assert.equal(app.$rows('Partners').find(p => p.ID === terri.ID)['Last Contact'], '', 'missing their call is not contact');
  let work = app.getTodayWork({ rep: 'all' });
  assert.deepEqual(work.calls.map(p => [p.Name, p.why]), [['Terri Searcy', 'missed']]);
  assert.equal(app.recountPartnerStages().updated, 0);
  // Tanner calls back
  state.calls.AC6 = { id: 'AC6', direction: 'outgoing', status: 'completed', duration: 120, participants: ['+19035550123'], createdAt: '2026-11-24T13:30:00Z', completedAt: '2026-11-24T13:32:00Z' };
  post(callEnvelope('call.completed', { id: 'AC6', direction: 'outgoing', status: 'answered', createdAt: '2026-11-24T13:30:00Z', completedAt: '2026-11-24T13:32:00Z', duration: 120, hasVoicemail: false }));
  work = app.getTodayWork({ rep: 'all' });
  assert.deepEqual(work.calls, []);
  assert.equal(new Date(app.$rows('Partners').find(p => p.ID === terri.ID)['Last Contact']).toISOString(), '2026-11-24T13:32:00.000Z');
});

test('a number nobody has goes to the review queue; dismiss clears it; adding the number later attaches the next one', () => {
  const { app, state, post } = connectedApp();
  state.calls.AC7 = { id: 'AC7', direction: 'incoming', status: 'completed', duration: 40, participants: ['+19035559999'], createdAt: '2026-11-24T12:00:00Z', completedAt: '2026-11-24T12:00:40Z' };
  const r = JSON.parse(post(callEnvelope('call.completed', { id: 'AC7', direction: 'incoming', status: 'answered', createdAt: '2026-11-24T12:00:00Z', completedAt: '2026-11-24T12:00:40Z', duration: 40, hasVoicemail: false }, { participants: { workspace: ['+19035550100'], external: ['+19035559999'], resolution: 'available' } })).getContent());
  assert.equal(r.result.action, 'review');
  const ev = app.$rows('Events')[0];
  assert.equal(ev['Partner ID'], ''); assert.equal(ev['Needs Review'], 'Yes'); assert.equal(ev.Phone, '9035559999');
  assert.match(ev.Snippet, /Unknown number \(903\) 555-9999/);
  let work = app.getTodayWork({ rep: 'all' });
  assert.equal(work.needsReview.length, 1); assert.equal(work.needsReview[0].partner, null);
  assert.equal(app.getTodayWork({ rep: 'mine' }).needsReview.length, 0, 'unknown numbers are the owner\'s to sort out');
  app.resolveReview(ev.ID, 'dismiss');
  assert.equal(app.getTodayWork({ rep: 'all' }).needsReview.length, 0);
  // the owner adds the number to Carla; her next call matches
  const carla = app.$rows('Partners').find(p => p.Name === 'Carla Conley');
  app.savePartner(carla.ID, { phone: '903-555-9999' });
  state.calls.AC8 = { id: 'AC8', direction: 'incoming', status: 'completed', duration: 10, participants: ['+19035559999'], createdAt: '2026-11-24T12:30:00Z', completedAt: '2026-11-24T12:30:10Z' };
  const r2 = JSON.parse(post(callEnvelope('call.completed', { id: 'AC8', direction: 'incoming', status: 'answered', createdAt: '2026-11-24T12:30:00Z', completedAt: '2026-11-24T12:30:10Z', duration: 10, hasVoicemail: false }, { participants: { workspace: ['+19035550100'], external: ['+19035559999'], resolution: 'available' } })).getContent());
  assert.equal(r2.result.action, 'added'); assert.equal(r2.result.partnerId, carla.ID);
});

test('test event + delivery log: the receiver records a sample without storing it', () => {
  const { app, post } = connectedApp();
  const sample = callEnvelope('call.completed', { id: 'ACsampleactivity0000000000000000', direction: 'incoming', status: 'answered', duration: 42, hasVoicemail: false });
  post(sample);
  const st = app.quoStatus();
  assert.equal(st.lastHook.type, 'call.completed'); assert.equal(st.lastHook.result.action, 'ignored');
  assert.equal(app.$rows('Events').length, 0);
  const d = app.quoSendTestEvent('call.completed');
  assert.equal(d.deliveries[0].status, 'success');
  assert.deepEqual(d.deliveries[0].attempts.map(a => [a.code, a.body]), [[302, 'Moved Temporarily The document has moved']], 'each attempt shows what our URL answered');
  assert.equal(d.status.lastHook, null, 'sending a test clears the last-hook marker so the UI waits for the new one');
});

test('call-through-Quo switch: pages get the Quo number to dial from, nothing secret', () => {
  const { app } = connectedApp();
  assert.deepEqual(app._quoLinkConfig_(), { viaApp: false, from: '+19035550100' });
  app.saveQuoCallLinks(true);
  assert.deepEqual(app._quoLinkConfig_(), { viaApp: true, from: '+19035550100' });
  assert.equal(app.quoStatus().callLinks, true);
  app.saveQuoWatch(['PN2']);
  assert.equal(app._quoLinkConfig_().from, '+19035550199', 'dials from the watched number');
  // the page shell carries it for every role
  const html = app.doGet({ parameter: { page: 'today' } }).getContent();
  assert.ok(html.indexOf('"viaApp":true') !== -1 && html.indexOf('+19035550199') !== -1);
  assert.ok(html.indexOf('key-123') === -1, 'the API key never reaches the browser');
});

test('later Quo events change only their own cells; the call time written first is never re-written', () => {
  const { app, state, post } = connectedApp();
  state.calls.AC9 = { id: 'AC9', direction: 'outgoing', status: 'completed', duration: 30, participants: ['+19035550123'], createdAt: '2026-11-24T14:00:00Z', completedAt: '2026-11-24T14:00:30Z' };
  post(callEnvelope('call.completed', { id: 'AC9', direction: 'outgoing', status: 'answered', createdAt: '2026-11-24T14:00:00Z', completedAt: '2026-11-24T14:00:30Z', duration: 30, hasVoicemail: false }));
  const sheet = app.$sheet('Events');
  const atCol = sheet[0].indexOf('At');
  const before = sheet[1][atCol];
  const writes = [];
  const tab = app.SpreadsheetApp.openById(app.PropertiesService.getScriptProperties().getProperty('OUTREACH_SHEET_ID')).getSheetByName('Events');
  const origGetRange = tab.getRange.bind(tab);
  tab.getRange = function (r, c, nr, nc) { const rg = origGetRange(r, c, nr, nc); const sv = rg.setValue && rg.setValue.bind(rg); if (sv) rg.setValue = function (v) { writes.push([r, c]); return sv(v); }; return rg; };
  post(callEnvelope('call.summary.completed', { callId: 'AC9', processingStatus: 'completed', summary: ['Short call.'], nextSteps: [], handledByAiAgent: false, jobs: [] }));
  post(callEnvelope('call.recording.completed', { id: 'AC9', direction: 'outgoing', duration: 30, recordings: [{ id: 'RE9', duration: 30, type: 'audio/mpeg', url: 'https://rec.example.com/RE9.mp3' }] }));
  assert.ok(writes.length > 0, 'updates went through per-cell writes');
  assert.ok(writes.every(w => w[1] !== atCol + 1), 'the At cell was not touched by the updates');
  assert.equal(app.$sheet('Events')[1][atCol], before);
  assert.equal(app.$rows('Events')[0].Snippet, 'Short call.');
  assert.equal(app.$rows('Events')[0]['Recording URL'], 'https://rec.example.com/RE9.mp3');
});

test('contacts: push creates once, re-push updates, Quo-deleted contacts are re-created, and the app stays the source of truth', () => {
  const { app, ctx, state } = connectedApp();
  // Terri and Carla are pushable; a third partner with neither phone nor email is not
  app.addPartner({ type: 'realtor', name: 'No Contact Info' });
  let st = app.quoContactsStatus();
  assert.deepEqual([st.total, st.pushable, st.inQuo, st.missing], [3, 2, 0, 2]);
  let r = app.quoPushContacts({ limit: 60 });
  assert.deepEqual([r.created, r.updated, r.failed, r.remaining], [2, 0, 0, 0]);
  const terri = app.$rows('Partners').find(p => p.Name === 'Terri Searcy');
  assert.equal(terri['Quo Contact ID'], 'CT1');
  const sent = state.contacts.CT1;
  assert.equal(sent.externalId, terri.ID); assert.equal(sent.source, 'armortex-outreach');
  assert.deepEqual(sent.defaultFields.phoneNumbers, [{ name: 'mobile', value: '+19035550123' }]);
  assert.deepEqual(sent.defaultFields.emails, [{ name: 'work', value: 'terri@example.com' }]);
  assert.equal(sent.defaultFields.firstName, 'Terri'); assert.equal(sent.defaultFields.lastName, 'Searcy');
  assert.equal(sent.defaultFields.company, 'Texas Real Estate Executives'); assert.equal(sent.defaultFields.role, 'Realtor');
  assert.ok(sent.sourceUrl.indexOf('page=partner&id=' + terri.ID) !== -1);
  assert.equal(app.quoContactsStatus().missing, 0);
  // editing in the app flows to Quo
  app.savePartner(terri.ID, { company: 'TREE Longview', phone: '903-555-0199' });
  assert.equal(state.contacts.CT1.defaultFields.company, 'TREE Longview');
  assert.deepEqual(state.contacts.CT1.defaultFields.phoneNumbers, [{ name: 'mobile', value: '+19035550199' }]);
  assert.throws(() => app.savePartner(terri.ID, { name: '' }), /Name is required/);
  assert.throws(() => app.savePartner(terri.ID, { email: 'carla@example.com' }), /already has the email/);
  // Quo lost it (deleted there) → re-push makes a new one and keeps the new id
  delete state.contacts.CT1;
  r = app.quoPushContacts({ limit: 60, all: true });
  assert.deepEqual([r.created, r.updated], [1, 1]);
  assert.equal(app.$rows('Partners').find(p => p.Name === 'Terri Searcy')['Quo Contact ID'], 'CT3');
  // a new partner added by hand goes straight to Quo
  const id = app.addPartner({ type: 'inspector', name: 'Carl Dawson', company: 'ETHI', phone: '903 555 0201' });
  assert.equal(app.$rows('Partners').find(p => p.ID === id)['Quo Contact ID'], 'CT4');
  assert.equal(state.contacts.CT4.defaultFields.role, 'Home inspector');
  // Tanner cannot run the bulk push
  ctx.user = TANNER;
  assert.throws(() => app.quoPushContacts({}), /cannot do that/);
  ctx.user = OWNER;
});

test('contact.updated from Quo: only a changed phone/email comes back, matched by our ID; strangers are ignored', () => {
  const { app, post } = connectedApp();
  app.quoPushContacts({ limit: 60 });
  const terri = app.$rows('Partners').find(p => p.Name === 'Terri Searcy');
  const ev = (res) => ({ id: 'EVc', type: 'contact.updated', createdAt: NOW.toISOString(), data: { resource: res, context: { orgId: 'OR1', userId: 'US1', sharedWithIds: [] }, links: { quo: null } } });
  let r = JSON.parse(post(ev({ id: 'CT1', firstName: 'Theresa', lastName: 'Searcy', company: 'Somewhere Else', externalId: terri.ID, emails: [{ value: 'terri@example.com', type: 'email' }], phoneNumbers: [{ value: '+19035550777', type: 'phone-number' }], updatedAt: NOW.toISOString() })).getContent());
  assert.equal(r.result.action, 'updated'); assert.deepEqual(r.result.fields, ['Phone']);
  const after = app.$rows('Partners').find(p => p.ID === terri.ID);
  assert.equal(after.Phone, '9035550777');
  assert.equal(after.Name, 'Terri Searcy', 'name is not taken from Quo'); assert.equal(after.Company, 'Texas Real Estate Executives', 'company is not taken from Quo');
  r = JSON.parse(post(ev({ id: 'CT9', firstName: 'Stranger', externalId: null, emails: [], phoneNumbers: [{ value: '+15550000000', type: 'phone-number' }], updatedAt: NOW.toISOString() })).getContent());
  assert.equal(r.result.action, 'ignored');
  assert.equal(app.$rows('Partners').length, 2);
});
