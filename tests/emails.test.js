const { test } = require('node:test');
const assert = require('node:assert/strict');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const ADDRESS = '1200 Judson Rd, Longview, TX 75601';
const OPT = "Reply 'no thanks' and I won't email again.";
const BODY = `Hi {{first}},\n\nWe do a free photo roof report on any listing within 48 hours.\n\nWant me to send over a sample report?\n\nBrian Kanzaki\nArmorTex Roofs\n${ADDRESS}\n${OPT}`;
const TUE = new Date('2026-12-01T15:00:00Z');
const SAT = new Date('2026-12-05T15:00:00Z');

function seeded(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function ready(n, ctx) {
  const app = loadApp(Object.assign({ user: OWNER, quota: 1500 }, ctx || {}));
  app.setup();
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT, daily_cap: '50' });
  ['A', 'B', 'C'].forEach(l => app.saveVersion(l, { subject: 'Roof report for {{company}} listings (' + l + ')', body: BODY, followUpBody: 'Hi {{first}}, just checking in. Still happy to send a sample report?' }));
  const lines = ['Name,Email,Brokerage'];
  for (let i = 1; i <= n; i++) lines.push(`Agent ${i},agent${i}@example.com,Co ${i % 3}`);
  app.importPartners(lines.join('\n'));
  app.assignVersions({ versions: ['A', 'B', 'C'], rng: seeded(9) });
  return app;
}

test('sendTodayBatch sends personalised first emails, records ids, queues one follow-up, locks versions', () => {
  const app = ready(12);
  const r = app.sendTodayBatch({ now: TUE });
  assert.equal(r.sent, 12);
  deq(r.errors, []);
  const sent = app.GmailApp.$sent;
  assert.equal(sent.length, 12);
  assert.match(sent[0].subject, /Roof report for Co \d listings \([ABC]\)/);
  assert.match(sent[0].body, /^Hi Agent,/);                 // {{first}} filled
  assert.ok(sent[0].body.indexOf(ADDRESS) !== -1 && sent[0].body.indexOf(OPT) !== -1);
  assert.equal(sent[0].opts.name, 'Brian Kanzaki');
  const emails = app.$rows('Emails');
  assert.equal(emails.filter(e => e.Step === 'first' && e.Status === 'sent').length, 12);
  assert.ok(emails.filter(e => e.Step === 'first').every(e => e['Gmail Thread ID'] && e['Gmail Message ID']));
  const fu = emails.filter(e => e.Step === 'followup');
  assert.equal(fu.length, 12);
  assert.ok(fu.every(e => e.Status === 'queued' && !e['Sent At']));
  // 4 business days after Tue Dec 1 = Mon Dec 7
  assert.equal(new Date(fu[0]['Scheduled For']).toISOString().slice(0, 10), '2026-12-07');
  assert.ok(app.listVersions().filter(v => 'ABC'.indexOf(v.Letter) !== -1).every(v => v.Locked === 'Yes'));
  assert.ok(app.$rows('Partners').every(p => p.Stage === 'Contacted' && p['Last Contact']));
  // second press the same day: nothing left to send
  const again = app.sendTodayBatch({ now: TUE });
  assert.equal(again.sent, 0);
});

test('send refuses when paused or a version fails; not-a-sending-day only with admin force', () => {
  const app = ready(4);
  app.saveSettings({ pause_sending: 'Yes' });
  let r = app.sendTodayBatch({ now: TUE });
  assert.equal(r.sent, 0); assert.ok(r.problems.some(p => /paused/.test(p)));
  app.saveSettings({ pause_sending: 'No' });
  r = app.sendTodayBatch({ now: SAT });
  assert.equal(r.sent, 0); assert.ok(r.problems.some(p => /not a sending day/.test(p)));
  r = app.sendTodayBatch({ now: SAT, force: true });
  assert.equal(r.sent, 4, 'owner may force a test send on a Saturday');
  // sales cannot force
  app.saveUser({ email: 'tanner@armortexroofs.com', name: 'Tanner', role: 'sales' });
  const app2 = ready(2); app2.saveUser({ email: 'tanner@armortexroofs.com', name: 'Tanner', role: 'sales' }); app2.$as('tanner@armortexroofs.com');
  r = app2.sendTodayBatch({ now: SAT, force: true });
  assert.equal(r.sent, 0);
});

test('do-not-contact and quota are checked at the moment of sending', () => {
  const app = ready(6);
  const ps = app.$rows('Partners');
  app.setPartnerDoNotContact(ps[0].ID, true);
  app.saveSettings({ do_not_contact: ps[1].Email });
  app.$ctx.quota = 4;
  const r = app.sendTodayBatch({ now: TUE });
  assert.equal(r.sent, 4);
  assert.equal(r.skipped.dnc + r.skipped.quota, 0, 'batch already excludes DNC; quota trimmed inside');
  // viewonly cannot send
  app.saveUser({ email: 'c@armortexroofs.com', name: 'C', role: 'viewonly' }); app.$as('c@armortexroofs.com');
  assert.throws(() => app.sendTodayBatch({ now: TUE }), /cannot do that/);
});

test('follow-ups go out in the same thread with In-Reply-To, and never a third', () => {
  const app = ready(3);
  app.sendTodayBatch({ now: TUE });
  const firstThread = app.$rows('Emails').find(e => e.Step === 'first')['Gmail Thread ID'];
  const MON = new Date('2026-12-08T15:00:00Z'); // follow-ups due Dec 7, next sending day Tue Dec 8
  const r = app.sendTodayBatch({ now: MON, force: true });
  assert.equal(r.followUps, 3);
  assert.equal(r.sent, 0);
  const t = app.GmailApp.$threads[firstThread];
  assert.equal(t.messages.length, 2);
  assert.match(t.messages[1].subject, /^Re: /);
  assert.equal(t.messages[1].inReplyTo, t.messages[0].rfcId);
  assert.match(t.messages[1].body, /just checking in/);
  const emails = app.$rows('Emails');
  assert.equal(emails.filter(e => e.Status === 'queued').length, 0, 'no third email queued');
  const later = app.sendTodayBatch({ now: new Date('2026-12-15T15:00:00Z') });
  assert.equal(later.sent + later.followUps, 0);
});

test('checkReplies: reply, opt-out wording, address guess, bounce; idempotent', () => {
  const app = ready(5);
  app.sendTodayBatch({ now: TUE });
  const emails = app.$rows('Emails').filter(e => e.Step === 'first');
  const byPartner = {}; emails.forEach(e => { byPartner[e['Partner ID']] = e; });
  const ps = app.$rows('Partners');
  const G = app.GmailApp;
  G.$reply(byPartner[ps[0].ID]['Gmail Thread ID'], ps[0].Email, 'Sure, send the sample over.\n\nOn Tue, Brian wrote:\n> old stuff');
  G.$reply(byPartner[ps[1].ID]['Gmail Thread ID'], ps[1].Email, 'No thanks, please remove me.');
  G.$reply(byPartner[ps[2].ID]['Gmail Thread ID'], ps[2].Email, 'Can you look at 214 Bayhills Dr in Hideaway? Goes live Friday.');
  G.$reply(byPartner[ps[3].ID]['Gmail Thread ID'], 'mailer-daemon@googlemail.com', 'Address not found', { subject: 'Delivery Status Notification (Failure)' });

  const r = app.checkReplies();
  deq({ checked: r.checked, replies: r.replies, bounces: r.bounces, optOuts: r.optOuts, addresses: r.addresses }, { checked: 4, replies: 3, bounces: 1, optOuts: 1, addresses: 1 });

  const P = {}; app.$rows('Partners').forEach(p => { P[p.ID] = p; });
  assert.equal(P[ps[0].ID].Stage, 'Replied'); assert.equal(P[ps[0].ID].Response, 'Replied');
  assert.equal(P[ps[1].ID]['Do Not Contact'], 'Yes'); assert.equal(P[ps[1].ID].Response, 'Opted out');
  assert.equal(P[ps[2].ID].Response, 'Replied', 'address is only suggested until a person confirms');
  assert.equal(P[ps[3].ID].Response, 'Bounced');
  assert.equal(P[ps[4].ID].Stage, 'Contacted');

  const E = app.$rows('Emails');
  assert.equal(E.find(e => e['Partner ID'] === ps[0].ID && e.Step === 'first').Status, 'replied');
  assert.equal(E.find(e => e['Partner ID'] === ps[3].ID && e.Step === 'first').Status, 'bounced');
  [0, 1, 2, 3].forEach(i => assert.equal(E.find(e => e['Partner ID'] === ps[i].ID && e.Step === 'followup').Status, 'cancelled', 'follow-up cancelled for ' + i));
  assert.equal(E.find(e => e['Partner ID'] === ps[4].ID && e.Step === 'followup').Status, 'queued');

  const ev = app.$rows('Events');
  const reply0 = ev.find(x => x['Partner ID'] === ps[0].ID && x.Kind === 'reply');
  assert.equal(reply0.Snippet, 'Sure, send the sample over.', 'quoted history stripped');
  assert.equal(ev.find(x => x['Partner ID'] === ps[2].ID && x.Kind === 'reply').Outcome, 'address?');
  assert.equal(ev.find(x => x['Partner ID'] === ps[2].ID && x.Kind === 'reply')['Needs Review'], 'Yes');
  assert.ok(ev.some(x => x['Partner ID'] === ps[1].ID && x.Kind === 'opt-out' && x['Needs Review'] === 'Yes'));
  assert.ok(ev.some(x => x['Partner ID'] === ps[3].ID && x.Kind === 'bounce'));

  // run again: nothing new
  const r2 = app.checkReplies();
  assert.equal(r2.replies + r2.bounces, 0);
  assert.equal(app.$rows('Events').length, ev.length);

  // Today work: replies listed, calls ordered, review queue; confirming the address
  const w = app.getTodayWork();
  assert.equal(w.replies.length, 3);
  assert.equal(w.calls.length, 2, 'opted-out partner is not on the call list');
  assert.equal(w.needsReview.length, 2);
  app.resolveReview(ev.find(x => x['Partner ID'] === ps[2].ID && x.Kind === 'reply').ID, 'address');
  assert.equal(app.$rows('Partners').find(p => p.ID === ps[2].ID).Response, 'Sent an address');
  app.logPartnerEvent(ps[0].ID, 'call', 'talked', 'sending sample');
  assert.equal(app.getTodayWork().calls.length, 1);
  assert.equal(app.getTodayWork().needsReview.length, 1);
});

test('triggers: install is idempotent and status reports it', () => {
  const app = ready(1);
  assert.equal(app.getTriggerStatus().installed, false);
  app.installTriggers(); app.installTriggers();
  assert.equal(app.ScriptApp.$triggers.length, 1);
  assert.equal(app.ScriptApp.$triggers[0].minutes, 15);
  assert.equal(app.getTriggerStatus().installed, true);
  app.$as('nobody@armortexroofs.com');
  assert.throws(() => app.installTriggers(), /not on the Users list/);
});

test('placeholders: aliases fill in; unknown ones are refused before a send', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT });
  const p = { Name: 'Loretta Nelson', Company: 'Keller Williams', Area: 'Tyler' };
  assert.equal(app._fill_('Hi {{first name}} of {{brokerage}} in {{ city }}, {{Name}}', p), 'Hi Loretta of Keller Williams in Tyler, Loretta Nelson');
  assert.equal(app._fill_('{{typo}} stays', p), '{{typo}} stays');
  const ok = app.validateVersion({ Channel: 'email', Subject: 'Hi {{first name}}', Body: BODY.replace('{{first}}', '{{brokerage}}') });
  deq(ok, []);
  const bad = app.validateVersion({ Channel: 'email', Subject: 'x', Body: BODY.replace('{{first}}', '{{first nme}}'), 'Follow Up Body': 'Hi {{frist}}' });
  assert.ok(bad.some(m => /Unknown fill-in words: \{\{first nme\}\}, \{\{frist\}\}/.test(m)), bad.join(' | '));
});

test('the ends-with-a-question rule looks past the signature, phone, address, opt-out line and a P.S.', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT });
  const long = 'Hi {{first}},\n\nI\'m Brian, one of the owners of ArmorTex Roofs. We do roof reports on listings at no cost.\n\nMy partner Tanner inspects the roof and we send you a short photo report in under 48 hours, so you know its condition before the buyer\'s inspector does.\n\nWould you like to see a sample?\n\nBrian Kanzaki\nArmorTex Roofs\n(903) 920-0369\n' + ADDRESS + '\n\n' + OPT + '\n\nP.S. The report is yours to keep whether or not you ever call us.';
  assert.deepEqual(JSON.parse(JSON.stringify(app.validateVersion({ Channel: 'email', Subject: 'x', Body: long }))), []);
  const noQ = long.replace('Would you like to see a sample?', 'Let me know if you want a sample.');
  assert.ok(app.validateVersion({ Channel: 'email', Subject: 'x', Body: noQ }).some(m => /asking for a reply/.test(m)));
});
