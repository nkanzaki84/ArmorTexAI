const { test } = require('node:test');
const assert = require('node:assert/strict');
// Values built inside the fake VM have foreign prototypes; compare as plain JSON.
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const ADDRESS = '123 Main St, Longview, TX 75601';
const OPT_OUT = "Reply 'no thanks' and I won't email again.";
const GOOD_BODY = `Hi there,\n\nWe do a free photo roof report on any listing within 48 hours.\n\nWant me to send over a sample report?\n\nTanner\nArmorTex Roofing\n${ADDRESS}\n${OPT_OUT}`;

function seeded(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function csvOf(n) {
  const lines = ['Name,Email,Brokerage'];
  for (let i = 1; i <= n; i++) lines.push(`Agent ${i},agent${i}@example.com,Co ${i % 5}`);
  return lines.join('\n');
}
function readyApp(n) {
  const app = loadApp({ user: OWNER });
  app.setup();
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT_OUT });
  ['A', 'B', 'C', 'E'].forEach(l => app.saveVersion(l, { subject: 'Roof report for your listings (' + l + ')', body: GOOD_BODY, followUpBody: 'Just checking in. Still happy to send a sample report?' }));
  app.importPartners(csvOf(n));
  app.assignVersions({ rng: seeded(5) });
  return app;
}
const TUE = new Date('2026-12-01T15:00:00Z'); // Tue Dec 1 2026, 9am Central
const SAT = new Date('2026-12-05T15:00:00Z');

test('validateVersion enforces address, opt-out, plain text, closing question', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  // defaults are seeded (Tyler address, opt-out line); a body without them fails
  const noFooter = app.validateVersion({ Channel: 'email', Subject: 's', Body: 'hello?' });
  assert.ok(noFooter.some(p => /business address/.test(p)));
  assert.ok(noFooter.some(p => /opt-out line/.test(p)));
  // and an emptied setting is reported as such
  app.saveSettings({ business_address: '' });
  assert.ok(app.validateVersion({ Channel: 'email', Subject: 's', Body: 'hello?' }).some(p => /Business address setting is empty/.test(p)));
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT_OUT });
  deq(app.validateVersion({ Channel: 'email', Subject: 's', Body: GOOD_BODY }), []);
  const bad = app.validateVersion({ Channel: 'email', Subject: '', Body: 'See https://example.com <b>now</b>. ' + OPT_OUT });
  assert.ok(bad.some(p => /No subject/.test(p)));
  assert.ok(bad.some(p => /business address/.test(p)));
  assert.ok(bad.some(p => /link/.test(p)));
  assert.ok(bad.some(p => /HTML/.test(p)));
  assert.ok(bad.some(p => /asking for a reply/.test(p)));
  deq(app.validateVersion({ Channel: 'postcard', Body: '' }), [], 'postcards are not email-validated');
});

test('versions lock once sending starts', () => {
  const app = readyApp(4);
  app._lockVersion_('A');
  assert.throws(() => app.saveVersion('A', { subject: 'x', body: GOOD_BODY }), /locked/);
  assert.doesNotThrow(() => app.saveVersion('B', { subject: 'x', body: GOOD_BODY }));
});

test('today batch: cap, even spread across versions, sending days, pause, DNC', () => {
  const app = readyApp(200);
  let b = app.buildTodayBatch({ now: TUE });
  assert.equal(b.sendingDay, true);
  assert.equal(b.cap, 50);
  assert.equal(b.firsts.length, 50);
  deq(b.problems, []);
  const byV = {};
  b.firsts.forEach(p => { byV[p.Version] = (byV[p.Version] || 0) + 1; });
  deq(byV, { A: 13, B: 13, C: 12, E: 12 });

  // Saturday is not a sending day → flagged, still previewable with force
  b = app.buildTodayBatch({ now: SAT });
  assert.equal(b.sendingDay, false);
  assert.ok(b.problems.some(p => /not a sending day/.test(p)));

  // pause
  app.saveSettings({ pause_sending: 'Yes' });
  assert.ok(app.buildTodayBatch({ now: TUE }).problems.some(p => /paused/.test(p)));
  app.saveSettings({ pause_sending: 'No' });

  // DNC partner never appears; already-emailed partner never appears
  const first = b.firsts[0];
  app.setPartnerDoNotContact(first.ID, true);
  app._appendRows_('Emails', [{ ID: 'E-1', 'Partner ID': b.firsts[1].ID, Version: b.firsts[1].Version, Step: 'first', 'Sent At': new Date(TUE.getTime() - 86400000 * 7), Status: 'sent' }]);
  b = app.buildTodayBatch({ now: TUE });
  assert.ok(!b.firsts.some(p => p.ID === first.ID));
  assert.ok(!b.firsts.some(p => p.ID === app.$rows('Emails')[0]['Partner ID']));

  // cap counts what already went out today
  app.saveSettings({ daily_cap: '10' });
  app._appendRows_('Emails', [1, 2, 3].map(i => ({ ID: 'E-x' + i, 'Partner ID': 'P-' + (190 + i), Version: 'A', Step: 'first', 'Sent At': TUE, Status: 'sent' })));
  b = app.buildTodayBatch({ now: TUE });
  assert.equal(b.sentToday, 3);
  assert.equal(b.room, 7);
  assert.equal(b.firsts.length, 7);
});

test('today batch: due follow-ups come first and count against the cap', () => {
  const app = readyApp(60);
  app.saveSettings({ daily_cap: '5' });
  const ids = app.$rows('Partners').slice(0, 3).map(p => p.ID);
  app._appendRows_('Emails', ids.map((id, i) => ({ ID: 'E-f' + i, 'Partner ID': id, Version: 'A', Step: 'followup', 'Scheduled For': new Date(TUE.getTime() - 86400000), Status: 'queued' })));
  // one follow-up scheduled for the future must wait
  app._appendRows_('Emails', [{ ID: 'E-future', 'Partner ID': app.$rows('Partners')[3].ID, Version: 'B', Step: 'followup', 'Scheduled For': new Date(TUE.getTime() + 86400000 * 3), Status: 'queued' }]);
  const b = app.buildTodayBatch({ now: TUE });
  assert.equal(b.followUps.length, 3);
  assert.equal(b.firsts.length, 2);
  assert.ok(!b.firsts.some(p => ids.indexOf(p.ID) !== -1), 'partners with queued follow-ups are not re-sent a first email');
});

test('today batch refuses a version that fails validation', () => {
  const app = readyApp(8);
  app.saveVersion('C', { subject: 'oops', body: 'no address or opt out here' });
  const b = app.buildTodayBatch({ now: TUE });
  assert.ok(b.problems.some(p => /^Version C:/.test(p)));
});

test('stats recount from Emails + Events, counts beside rates', () => {
  const app = readyApp(40);
  const ps = app.$rows('Partners');
  const a = ps.filter(p => p.Version === 'A');
  app._appendRows_('Emails', a.slice(0, 4).map((p, i) => ({ ID: 'E-' + i, 'Partner ID': p.ID, Version: 'A', Step: 'first', 'Sent At': TUE, Status: i === 3 ? 'bounced' : 'sent' })));
  app._appendRows_('Events', [
    { ID: 'EV-1', 'Partner ID': a[0].ID, Kind: 'reply', At: TUE, Snippet: 'Sure, send it' },
    { ID: 'EV-2', 'Partner ID': a[0].ID, Kind: 'reply', At: TUE, Snippet: 'second reply counts once' },
    { ID: 'EV-3', 'Partner ID': a[1].ID, Kind: 'call', Outcome: 'talked', At: TUE },
  ]);
  app.savePartner(a[0].ID, { response: 'Sent an address' });
  app._appendRows_('Referrals', [{ ID: 'R-1', Date: TUE, Direction: 'in', 'Partner ID': a[0].ID, 'Customer Or Address': '9 Oak St', 'Report Sent At': TUE, 'Signed Or Lost': 'signed' }]);
  const s = app.getCampaignStats();
  const A = s.rows.find(r => r.version === 'A');
  assert.equal(A.assigned, 10);
  assert.equal(A.sent, 4);
  assert.equal(A.bounced, 1);
  assert.equal(A.replied, 1);
  assert.equal(A.talked, 1);
  assert.equal(A.addresses, 1);
  assert.equal(A.referrals, 1);
  assert.equal(A.reportsSent, 1);
  assert.equal(A.signed, 1);
  assert.equal(A.replyRate, 0.25);
  assert.match(s.note, /125 realtors per version/);

  const rc = app.recountPartnerStages();
  assert.ok(rc.updated >= 2);
  const after = app.$rows('Partners');
  assert.equal(after.find(p => p.ID === a[0].ID).Stage, 'Partner');
  assert.equal(after.find(p => p.ID === a[1].ID).Stage, 'Contacted');
  assert.equal(after.find(p => p.ID === a[3].ID).Response, 'Bounced');
});
