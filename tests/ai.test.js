// AI reply reading: Gemini says whether a reply is a "yes" to the sample
// report; suggest mode leaves a card on Today, auto mode sends the PDF.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const ADDRESS = '3310 South Broadway Ave, Ste 225A, Tyler, TX 75701';
const OPT = "Reply 'no thanks' and I won't email again.";
const BODY = `Hi {{first}},\n\nWe do a free photo roof report on any listing within 48 hours.\n\nWant me to send over a sample report?\n\nBrian\nArmorTex Roofs\n${ADDRESS}\n${OPT}`;
const TUE = new Date('2026-12-01T15:00:00Z');
const seeded = (s) => () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

/** A stand-in for Gemini: lists two models; classifies by a few words. */
function fakeGemini(ctx) {
  ctx.calls = [];
  ctx.fetchHandler = (url, opts) => {
    if (/generativelanguage\.googleapis\.com\/v1beta\/models\?/.test(url)) {
      if ((opts.headers || {})['x-goog-api-key'] !== 'AIza-good') return { code: 400, text: JSON.stringify({ error: { message: 'API key not valid' } }) };
      return { code: 200, text: JSON.stringify({ models: [
        { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash-lite', displayName: 'Lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding-001', displayName: 'Embed', supportedGenerationMethods: ['embedContent'] },
      ] }) };
    }
    if (/:generateContent$/.test(url)) {
      if (ctx.geminiDown) return { code: 503, text: JSON.stringify({ error: { message: 'overloaded' } }) };
      const body = JSON.parse(opts.payload);
      const reply = body.contents[0].parts[0].text.toLowerCase();
      ctx.calls.push({ url, reply });
      const verdict = /not for us|no thanks|not interested|remove me/.test(reply) ? 'no' : /sure|yes|cool to see|send it/.test(reply) ? 'yes' : 'unclear';
      return { code: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict, reason: 'fake: ' + verdict }) }] } }] }) };
    }
    return null;
  };
}

function ready(n, ctx) {
  const app = loadApp(Object.assign({ user: OWNER, quota: 1500 }, ctx || {}));
  app.setup();
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT, daily_cap: '50' });
  app.saveVersion('A', { subject: 'Roof report for {{company}} listings', body: BODY, followUpBody: 'Hi {{first}}, still happy to send a sample?' });
  const lines = ['Name,Email,Brokerage'];
  for (let i = 1; i <= n; i++) lines.push(`Agent ${i},agent${i}@example.com,Co ${i % 3}`);
  app.importPartners(lines.join('\n'));
  app.assignVersions({ versions: ['A'], rng: seeded(9) });
  const file = app.DriveApp.getRootFolder().createFile(app.Utilities.newBlob('%PDF-1.4 sample', 'application/pdf', 'sample.pdf'));
  app.saveSettings({ sample_report_file: file.getId() });
  return app;
}

test('settings: the key is proved by listing models, a default model is picked, modes are guarded', () => {
  const ctx = { user: OWNER }; fakeGemini(ctx);
  const app = loadApp(ctx); app.setup();
  assert.equal(app.aiStatus().connected, false);
  assert.throws(() => app.saveAiSettings({ mode: 'auto' }), /Save a Gemini key/);
  assert.throws(() => app.saveGeminiKey('AIza-bad'), /HTTP 400.*API key not valid/);
  const s = app.saveGeminiKey('AIza-good');
  assert.equal(s.connected, true);
  assert.equal(s.model, 'gemini-2.5-flash', 'plain flash wins over lite');
  deq(s.models.map(m => m.id).sort(), ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  assert.equal(s.mode, 'off');
  assert.throws(() => app.saveAiSettings({ mode: 'sometimes' }), /off, suggest or auto/);
  assert.equal(app.saveAiSettings({ mode: 'suggest' }).mode, 'suggest');
  deq(app.aiTestClassify('sure, would be cool to see'), { verdict: 'yes', reason: 'fake: yes' });
  assert.equal(app.clearGeminiKey().connected, false);
  assert.equal(app.aiStatus().mode, 'off', 'removing the key turns it off');
  // sales cannot touch it
  app.saveUser({ email: 'tanner@armortexroofs.com', name: 'Tanner', role: 'sales' });
  app.$as('tanner@armortexroofs.com');
  assert.throws(() => app.saveGeminiKey('AIza-good'), /cannot do that/);
});

test('suggest mode: a yes becomes a Today card; Send sends the PDF in the thread; no and unclear do nothing', () => {
  const ctx = { user: OWNER }; fakeGemini(ctx);
  const app = ready(4, ctx);
  app.saveGeminiKey('AIza-good');
  app.saveAiSettings({ mode: 'suggest' });
  app.sendTodayBatch({ now: TUE });
  const first = {}; app.$rows('Emails').filter(e => e.Step === 'first').forEach(e => { first[e['Partner ID']] = e; });
  const ps = app.$rows('Partners');
  const G = app.GmailApp;
  G.$reply(first[ps[0].ID]['Gmail Thread ID'], ps[0].Email, 'Sure, would be cool to see.\n\nOn Tue, Brian wrote:\n> old');
  G.$reply(first[ps[1].ID]['Gmail Thread ID'], ps[1].Email, 'Not for us right now, thanks anyway.');
  G.$reply(first[ps[2].ID]['Gmail Thread ID'], ps[2].Email, 'Who is this?');
  G.$reply(first[ps[3].ID]['Gmail Thread ID'], ps[3].Email, 'no thanks, please remove me');   // opt-out wording: never read
  const r = app.checkReplies();
  deq(r.ai, { read: 3, yes: 1, sent: 0, suggested: 1, errors: 0 });
  assert.equal(ctx.calls.length, 3, 'the opt-out was not sent to Gemini');
  assert.ok(ctx.calls.every(c => c.reply.indexOf('old') === -1), 'quoted history is stripped before reading');
  const evs = app.$rows('Events').filter(e => e.Kind === 'reply');
  const byP = {}; evs.forEach(e => { byP[e['Partner ID']] = e; });
  assert.equal(byP[ps[0].ID]['AI Verdict'], 'yes');
  assert.equal(byP[ps[0].ID]['AI Action'], 'suggested');
  assert.equal(byP[ps[1].ID]['AI Verdict'], 'no');
  assert.equal(byP[ps[1].ID]['AI Action'], '');
  assert.equal(byP[ps[2].ID]['AI Verdict'], 'unclear');
  assert.equal(byP[ps[3].ID]['AI Verdict'], '');
  assert.equal(app.GmailApp.$sent.filter(m => /multipart/.test(m.raw || '')).length, 0, 'nothing sent in suggest mode');

  let w = app.getTodayWork({ now: TUE });
  assert.equal(w.sampleRequests.length, 1);
  assert.equal(w.sampleRequests[0].partner.ID, ps[0].ID);
  // a person presses Send
  const sent = app.sendSuggestedSample(w.sampleRequests[0].event.ID);
  assert.equal(sent.inThread, true);
  const last = app.GmailApp.$sent[app.GmailApp.$sent.length - 1];
  assert.equal(last.threadId, first[ps[0].ID]['Gmail Thread ID']);
  assert.match(last.raw, /filename="sample.pdf"/);
  w = app.getTodayWork({ now: TUE });
  assert.equal(w.sampleRequests.length, 0, 'card gone once sent');
  assert.equal(app.$rows('Events').find(e => e['Partner ID'] === ps[0].ID && e.Kind === 'reply')['AI Action'], 'sent');
  // dismissing
  app._updateRow_('Events', byP[ps[2].ID]._row, { 'AI Verdict': 'yes', 'AI Action': 'suggested' });
  assert.equal(app.getTodayWork({ now: TUE }).sampleRequests.length, 1);
  app.dismissSampleSuggestion(byP[ps[2].ID].ID);
  assert.equal(app.getTodayWork({ now: TUE }).sampleRequests.length, 0);
});

test('auto mode: a yes sends the PDF at once, once per person; a Gemini outage reads as unclear and sends nothing', () => {
  const ctx = { user: OWNER }; fakeGemini(ctx);
  const app = ready(2, ctx);
  app.saveGeminiKey('AIza-good');
  app.saveAiSettings({ mode: 'auto' });
  app.sendTodayBatch({ now: TUE });
  const first = {}; app.$rows('Emails').filter(e => e.Step === 'first').forEach(e => { first[e['Partner ID']] = e; });
  const ps = app.$rows('Partners');
  const G = app.GmailApp;
  G.$reply(first[ps[0].ID]['Gmail Thread ID'], ps[0].Email, 'yes send it');
  let r = app.checkReplies();
  deq(r.ai, { read: 1, yes: 1, sent: 1, suggested: 0, errors: 0 });
  const ev = app.$rows('Events').find(e => e['Partner ID'] === ps[0].ID && e.Kind === 'reply');
  assert.equal(ev['AI Action'], 'sent');
  const sample = app.$rows('Emails').filter(e => e.Step === 'sample report');
  assert.equal(sample.length, 1);
  assert.equal(sample[0]['Partner ID'], ps[0].ID);
  assert.equal(app.GmailApp.$sent[app.GmailApp.$sent.length - 1].threadId, first[ps[0].ID]['Gmail Thread ID']);
  assert.equal(app.getTodayWork({ now: TUE }).sampleRequests.length, 0, 'auto leaves no card');
  // they say yes again: not sent twice
  G.$reply(first[ps[0].ID]['Gmail Thread ID'], ps[0].Email, 'yes please, send it again');
  r = app.checkReplies();
  assert.equal(r.ai.sent, 0);
  assert.equal(app.$rows('Emails').filter(e => e.Step === 'sample report').length, 1);
  assert.equal(app.$rows('Events').filter(e => e['Partner ID'] === ps[0].ID && e.Kind === 'reply').pop()['AI Action'], 'already sent');
  // Gemini down: unclear, nothing sent, the reply itself is still logged
  ctx.geminiDown = true;
  G.$reply(first[ps[1].ID]['Gmail Thread ID'], ps[1].Email, 'sure');
  r = app.checkReplies();
  assert.equal(r.replies, 1);
  deq({ sent: r.ai.sent, errors: r.ai.errors }, { sent: 0, errors: 1 });
  const ev2 = app.$rows('Events').find(e => e['Partner ID'] === ps[1].ID && e.Kind === 'reply');
  assert.equal(ev2['AI Verdict'], 'unclear');
  assert.match(ev2['AI Reason'], /error: Gemini HTTP 503/);
  assert.equal(app.$rows('Emails').filter(e => e.Step === 'sample report').length, 1);
});

test('off, or no sample file: replies are not read at all', () => {
  const ctx = { user: OWNER }; fakeGemini(ctx);
  const app = ready(1, ctx);
  app.saveGeminiKey('AIza-good');
  app.sendTodayBatch({ now: TUE });
  const e = app.$rows('Emails').find(x => x.Step === 'first');
  const p = app.$rows('Partners')[0];
  app.GmailApp.$reply(e['Gmail Thread ID'], p.Email, 'sure');
  let r = app.checkReplies();
  assert.equal(ctx.calls.length, 0);
  deq(r.ai, { read: 0, yes: 0, sent: 0, suggested: 0, errors: 0 });
  app.saveAiSettings({ mode: 'auto' });
  app.saveSettings({ sample_report_file: '' });
  app.GmailApp.$reply(e['Gmail Thread ID'], p.Email, 'yes');
  r = app.checkReplies();
  assert.equal(ctx.calls.length, 0, 'no file to send, so no call is spent');
});
