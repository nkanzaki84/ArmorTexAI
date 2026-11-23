// Campaigns as records: audience, dealing letters, per-campaign copy, the
// batch drawing from running campaigns, schedule plan, results.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const TANNER = 'tanner@armortexroofs.com';
const ADDRESS = '3310 South Broadway Ave, Ste 225A, Tyler, TX 75701';
const OPT = "Reply 'no thanks' and I won't email again.";
const BODY = 'Hi {{first}},\n\nFree roof report on any listing within 48 hours.\n\nWant a sample?\n\nBrian\n' + ADDRESS + '\n' + OPT;
const TUE = new Date('2026-12-01T15:00:00Z');   // a Tuesday
const seeded = (s) => () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

function appWithLists() {
  const app = loadApp({ user: OWNER });
  app.setup();
  app.saveUser({ email: TANNER, name: 'Tanner', role: 'sales' });
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT });
  const rows = ['Name,Email,Brokerage,Notes'];
  for (let i = 1; i <= 30; i++) rows.push(`Realtor ${i},r${i}@example.com,${['KW', 'RE/MAX', 'eXp'][i % 3]},${i === 7 ? 'sent 11/3' : ''}`);
  app.importPartners(rows.join('\n'), { sourceList: 'tyler', rep: TANNER });
  app.importPartners('Name,Email,Brokerage\nOld Partner,old@example.com,KW', { sourceList: 'established', established: true });
  app.importPartners('Name,Email,Company\nInspector One,insp@example.com,ETHI', { type: 'inspector', sourceList: 'inspectors' });
  return app;
}

test('setup seeds the first campaign and owns the seeded letters', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  const cs = app.listCampaigns();
  assert.equal(cs.length, 1);
  assert.equal(cs[0].name, 'Realtor email test'); assert.equal(cs[0].status, 'running'); assert.equal(cs[0].type, 'realtor');
  assert.deepEqual(cs[0].versions, ['A', 'B', 'C', 'E']);
  assert.ok(app.listVersions().every(v => v['Campaign ID'] === cs[0].id));
  app.setup();
  assert.equal(app.listCampaigns().length, 1, 'setup is idempotent');
});

test('create: copies the type\'s letters, starts as draft; audience shows who matches and why others are left out', () => {
  const app = appWithLists();
  const first = app.listCampaigns()[0].id;
  app.saveVersion('A', { subject: 'Roof report (A)', body: BODY, followUpBody: 'Still interested?' }, first);
  const { id } = app.createCampaign({ name: 'Tyler realtors · December', type: 'realtor', lists: ['tyler'], versions: ['A', 'B'], startDate: '2026-12-01' });
  assert.equal(id, 'CP-2');
  const c = app.getCampaign(id);
  assert.equal(c.campaign.status, 'draft');
  assert.deepEqual(c.versions.map(v => [v.Letter, v.Subject, v.Locked]), [['A', 'Roof report (A)', ''], ['B', '', '']], 'wording copied from the first campaign, unlocked');
  const a = c.audience;
  assert.equal(a.members.length, 0); assert.equal(a.undealt, 29, '30 on the list minus the hand-emailed one');
  assert.deepEqual(a.excluded, { 'emailed by hand': 1 });
  // the book and other types never match
  const insp = app.createCampaign({ name: 'Inspectors', type: 'inspector', versions: ['A'] });
  assert.equal(app.campaignAudience(insp.id).undealt, 1);
  assert.throws(() => app.createCampaign({ name: '', type: 'realtor' }), /name/);
  assert.throws(() => app.createCampaign({ name: 'x', type: 'realtor', versions: [] }), /letter/);
});

test('deal letters: joins the audience, deals in turn within brokerages, keeps existing letters, never re-deals; one campaign per person', () => {
  const app = appWithLists();
  const { id } = app.createCampaign({ name: 'Dec', type: 'realtor', lists: ['tyler'], versions: ['A', 'B', 'C'] });
  let r = app.dealLetters(id, { rng: seeded(3) });
  assert.equal(r.dealt, 29);
  assert.deepEqual(Object.keys(r.counts).sort(), ['A', 'B', 'C']);
  assert.ok(Object.values(r.counts).every(n => n >= 9 && n <= 10), JSON.stringify(r.counts));
  const members = app.$rows('Partners').filter(p => p['Campaign ID'] === id);
  assert.equal(members.length, 29);
  assert.ok(members.every(p => 'ABC'.indexOf(p.Version) !== -1));
  r = app.dealLetters(id, { rng: seeded(4) });
  assert.equal(r.dealt, 0, 'nothing left to deal');
  // a second campaign on the same list cannot take them
  const other = app.createCampaign({ name: 'Again', type: 'realtor', lists: ['tyler'], versions: ['A'] });
  assert.equal(app.campaignAudience(other.id).excluded['other campaign'], 29);
  assert.equal(app.dealLetters(other.id).dealt, 0);
  // a newcomer on the list is dealt on the next press, and only them
  app.importPartners('Name,Email,Brokerage\nNew Realtor,new@example.com,KW', { sourceList: 'tyler' });
  r = app.dealLetters(id, { rng: seeded(5) });
  assert.equal(r.dealt, 1);
  // removing someone before any send frees them; after a send it is refused
  const m = members[0];
  app.removeFromCampaign(id, m.ID);
  assert.equal(app.$rows('Partners').find(p => p.ID === m.ID)['Campaign ID'], '');
  app._appendRows_('Emails', [{ ID: 'E-1', 'Partner ID': members[1].ID, Version: members[1].Version, Step: 'first', 'Sent At': TUE, Status: 'sent', 'Campaign ID': id }]);
  assert.throws(() => app.removeFromCampaign(id, members[1].ID), /Already emailed/);
  // Tanner cannot deal
  const ctx = { user: TANNER };
  const asTanner = loadApp(ctx);
  asTanner.setup();
  assert.throws(() => asTanner.dealLetters('CP-1'), /signed in|cannot do that|Users list/);
});

test('running needs valid letters; the batch draws only from running campaigns with their own cap, days and wording', () => {
  const app = appWithLists();
  const first = app.listCampaigns()[0].id;
  // the seeded first campaign has no wording and no members: it contributes nothing and does not block
  const { id } = app.createCampaign({ name: 'Dec', type: 'realtor', lists: ['tyler'], versions: ['A', 'B'], dailyCap: 4, sendingDays: 'Tue,Wed', followUpDays: 2 });
  app.dealLetters(id, { rng: seeded(1) });
  assert.throws(() => app.saveCampaign(id, { status: 'running' }), /Not ready to run/);
  app.saveVersion('A', { subject: 'A', body: BODY, followUpBody: 'Hi {{first}}, still interested?' }, id);
  app.saveVersion('B', { subject: 'B', body: BODY, followUpBody: 'Hi {{first}}, still interested?' }, id);
  let b = app.buildTodayBatch({ now: TUE });
  assert.equal(b.firsts.length, 0, 'a draft campaign sends nothing');
  app.saveCampaign(id, { status: 'running' });
  b = app.buildTodayBatch({ now: TUE });
  assert.equal(b.cap, 4 + 50, 'caps add up across running campaigns');
  assert.equal(b.firsts.length, 4, 'this campaign\'s cap, not Settings\'');
  assert.deepEqual(b.problems, []);
  assert.ok(b.firsts.every(p => p['Campaign ID'] === id));
  assert.deepEqual(b.campaigns.map(c => [c.name, c.firsts]), [['Realtor email test', 0], ['Dec', 4]]);
  // Thursday is not one of its days
  const THU = new Date('2026-12-03T15:00:00Z');
  b = app.buildTodayBatch({ now: THU });
  assert.ok(b.problems.some(p => /not a sending day for Dec/.test(p)));
  assert.equal(b.firsts.length, 4, 'still previewable');
  // paused: nothing offered
  app.saveCampaign(id, { status: 'paused' });
  assert.equal(app.buildTodayBatch({ now: TUE }).firsts.length, 0);
  app.saveCampaign(id, { status: 'running' });
  // send: wording from this campaign, Campaign ID on the rows, follow-up at +2 business days, letters lock per campaign
  const rep = app.sendTodayBatch({ now: TUE });
  assert.equal(rep.sent, 4); assert.deepEqual(rep.errors, []);
  const emails = app.$rows('Emails');
  assert.ok(emails.every(e => e['Campaign ID'] === id));
  const fu = emails.filter(e => e.Step === 'followup');
  assert.equal(fu.length, 4);
  assert.equal(new Date(fu[0]['Scheduled For']).toISOString().slice(0, 10), '2026-12-03');
  assert.ok(app.listVersions(id).every(v => v.Locked === 'Yes'));
  assert.ok(app.listVersions(first).every(v => v.Locked !== 'Yes'), 'the other campaign\'s letters stay editable');
  assert.throws(() => app.saveVersion('A', { subject: 'x', body: BODY }, id), /locked/);
  assert.equal(app.getCampaign(id).campaign.sent, 4);
  // the starting date holds a campaign back
  const later = app.createCampaign({ name: 'Jan', type: 'inspector', versions: ['A'], startDate: '2027-01-06' });
  app.saveVersion('A', { subject: 'I', body: BODY }, later.id);
  app.dealLetters(later.id);
  app.saveCampaign(later.id, { status: 'running' });
  b = app.buildTodayBatch({ now: new Date('2026-12-02T15:00:00Z') });
  assert.ok(b.problems.some(p => /Jan starts 2027-01-06/.test(p)));
});

test('schedule plan draws the days out; results list everyone with sent, follow-up, reply, response and calls; stats are per campaign', () => {
  const app = appWithLists();
  const { id } = app.createCampaign({ name: 'Dec', type: 'realtor', lists: ['tyler'], versions: ['A', 'B'], dailyCap: 10, sendingDays: 'Tue,Wed,Thu', followUpDays: 4, startDate: '2026-12-01' });
  app.saveVersion('A', { subject: 'A', body: BODY, followUpBody: 'Still?' }, id);
  app.saveVersion('B', { subject: 'B', body: BODY, followUpBody: 'Still?' }, id);
  app.dealLetters(id, { rng: seeded(2) });
  app.saveCampaign(id, { status: 'running' });
  const c = app.getCampaign(id);
  assert.equal(c.plan.firstsLeft, 29);
  assert.deepEqual(c.plan.days.slice(0, 3).map(d => [d.date, d.firsts, d.followUps]), [['2026-12-01', 10, 0], ['2026-12-02', 10, 0], ['2026-12-03', 9, 0]]);
  assert.ok(c.plan.days.some(d => d.followUps > 0), 'follow-ups appear 4 business days later');
  assert.equal(c.plan.finish, c.plan.days[c.plan.days.length - 1].date);
  // send a day, get a reply and a call
  app.sendTodayBatch({ now: TUE });
  const sent = app.$rows('Emails').filter(e => e.Step === 'first');
  assert.equal(sent.length, 10);
  const who = sent[0]['Partner ID'];
  app._appendRows_('Events', [{ ID: 'EV-1', 'Partner ID': who, Kind: 'reply', At: new Date(TUE.getTime() + 3600000), Snippet: 'Sure, send it', By: 'trigger' }]);
  app.savePartner(who, { response: 'Sent an address' });
  app.logPartnerEvent(who, 'call', 'talked', 'great call');
  const res = app.campaignResults(id);
  assert.equal(res.rows.length, 29);
  const row = res.rows.find(r => r.ID === who);
  assert.ok(row.sentAt && row.repliedAt);
  assert.equal(row.followUp.status, 'queued');
  assert.equal(row.response, 'Sent an address'); assert.equal(row.calls, 1); assert.equal(row.lastCall.outcome, 'talked');
  assert.equal(res.rows.filter(r => !r.sentAt).length, 19);
  const s = app.getCampaignStats(id);
  assert.equal(s.rows.reduce((n, r) => n + r.sent, 0), 10);
  assert.equal(s.rows.reduce((n, r) => n + r.replied, 0), 1);
  assert.equal(s.rows.reduce((n, r) => n + r.addresses, 0), 1);
  assert.equal(app.getCampaignStats('CP-1').rows.length, 0, 'the other campaign has nothing');
  const led = app.listCampaigns().find(x => x.id === id);
  assert.deepEqual([led.sent, led.replied, led.wins, led.audience], [10, 1, 1, 29]);
});

test('the five-address test becomes its own small running campaign with borrowed letters', () => {
  const app = appWithLists();
  const first = app.listCampaigns()[0].id;
  ['A', 'B', 'C'].forEach(l => app.saveVersion(l, { subject: 'Test ' + l, body: BODY, followUpBody: 'Did it reach you?' }, first));
  const r = app.createTestCampaign('brian+1@armortexroofs.com\nbrian+2@armortexroofs.com, brian+3@armortexroofs.com');
  assert.equal(r.added, 3); assert.equal(r.dealt, 3); assert.equal(r.running, true, r.problem);
  const c = app.getCampaign(r.campaignId);
  assert.equal(c.campaign.name, 'Five-address test'); assert.deepEqual(c.campaign.lists, ['test']);
  assert.deepEqual(c.versions.map(v => v.Subject), ['Test A', 'Test B', 'Test C']);
  const b = app.buildTodayBatch({ now: TUE });
  assert.equal(b.firsts.length, 3);
  assert.ok(b.firsts.every(p => p['Campaign ID'] === r.campaignId));
  // pressing it again reuses the campaign
  const again = app.createTestCampaign('brian+1@armortexroofs.com');
  assert.equal(again.campaignId, r.campaignId); assert.equal(again.existed, 1);
});

test('Send now sends one campaign\'s batch today regardless of its days; refused unless running; owner only', () => {
  const app = appWithLists();
  const { id } = app.createCampaign({ name: 'Dec', type: 'realtor', lists: ['tyler'], versions: ['A'], sendingDays: 'Tue', dailyCap: 3 });
  app.saveVersion('A', { subject: 'A', body: BODY, followUpBody: 'Still?' }, id);
  app.dealLetters(id, { rng: seeded(1) });
  assert.throws(() => app.sendCampaignNow(id), /Start sending/);
  app.saveCampaign(id, { status: 'running' });
  const SUN = new Date('2026-11-22T20:00:00Z');
  const b = app.buildTodayBatch({ now: SUN, campaignId: id, force: true });
  assert.equal(b.firsts.length, 3); assert.deepEqual(b.campaigns.map(c => c.id), [id]);
  const r = app.sendCampaignNow(id);
  assert.equal(r.sent, 3); assert.deepEqual(r.problems, []);
  assert.ok(app.$rows('Emails').filter(e => e.Step === 'first').every(e => e['Campaign ID'] === id));
  // the other running campaign (the seeded first one) was not touched by Send now
  assert.equal(app.getCampaign('CP-1').campaign.sent, 0);
});
