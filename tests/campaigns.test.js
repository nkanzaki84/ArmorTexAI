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
  assert.deepEqual(cs[0].versions, ['A'], 'one letter unless you ask for more');
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
  assert.equal(app.campaignAudience(other.id).excluded['in another campaign'], 29);
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
  // dropping a wording: unused letters go, holders are re-dealt; a letter that went out stays
  const before = app.$rows('Partners').filter(p => p['Campaign ID'] === id && p.Version === 'C').length;
  assert.ok(before > 0);
  let rw = app.removeWording(id, 'C');
  assert.deepEqual(rw.versions, ['A', 'B']);
  assert.ok(rw.redealt >= before, 'holders of C were dealt again (plus anyone free to join)');
  assert.equal(app.$rows('Campaigns').find(c => c.ID === id).Versions, 'A,B');
  assert.ok(app.$rows('Partners').filter(p => p['Campaign ID'] === id).every(p => 'AB'.indexOf(p.Version) !== -1 && p.Version));
  assert.throws(() => app.removeWording(id, members[1].Version), /already went out/);
  const otherLetter = members[1].Version === 'A' ? 'B' : 'A';
  rw = app.removeWording(id, otherLetter);
  assert.deepEqual(rw.versions, [members[1].Version]);
  assert.throws(() => app.removeWording(id, members[1].Version), /at least one/);
  assert.ok(app.getCampaign(id).campaign.versions.length === 1);
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

test('one letter by default; the call plan puts no-reply people on the call list after N business days', () => {
  const app = appWithLists();
  const { id } = app.createCampaign({ name: 'Dec', type: 'realtor', lists: ['tyler'], dailyCap: 5, callAfterDays: 3 });
  assert.deepEqual(app.getCampaign(id).campaign.versions, ['A'], 'A only unless asked');
  assert.equal(app.getCampaign(id).campaign.callAfterDays, 3);
  app.saveVersion('A', { subject: 'A', body: BODY, followUpBody: 'Still?' }, id);
  app.dealLetters(id, { rng: seeded(1) });
  app.saveCampaign(id, { status: 'running' });
  const plan = app.getCampaign(id).plan;
  assert.ok(plan.days.some(d => d.calls > 0), 'calls appear in the drawn-out plan');
  app.sendTodayBatch({ now: TUE });   // Tue Dec 1: 5 first emails
  const sent = app.$rows('Emails').filter(e => e.Step === 'first').map(e => e['Partner ID']);
  assert.equal(sent.length, 5);
  // Thu Dec 3: only 2 business days later → not yet
  assert.equal(app.getTodayWork({ rep: 'all', now: new Date('2026-12-03T16:00:00Z') }).calls.filter(p => p.why === 'noreply').length, 0);
  // Fri Dec 4: 3 business days → due, except one who replied (gets 'replied') and one already called
  app._appendRows_('Events', [{ ID: 'EV-r', 'Partner ID': sent[0], Kind: 'reply', At: new Date('2026-12-02T15:00:00Z'), By: 'trigger' }]);
  app._appendRows_('Events', [{ ID: 'EV-c', 'Partner ID': sent[1], Kind: 'call', Outcome: 'voicemail', At: new Date('2026-12-03T15:00:00Z'), By: 'tanner@armortexroofs.com' }]);
  const calls = app.getTodayWork({ rep: 'all', now: new Date('2026-12-04T16:00:00Z') }).calls;
  assert.deepEqual(calls.filter(p => p.why === 'noreply').map(p => p.ID).sort(), sent.slice(2).sort());
  assert.equal(calls.find(p => p.ID === sent[0]).why, 'replied');
  assert.ok(!calls.some(p => p.ID === sent[1]), 'already called since the email');
  // no call step → nobody from the plan
  app.saveCampaign(id, { callAfterDays: '' });
  assert.equal(app.getTodayWork({ rep: 'all', now: new Date('2026-12-04T16:00:00Z') }).calls.filter(p => p.why === 'noreply').length, 0);
});

test('tags are filed lowercase and deduped; duplicate copies wording (unlocked), plan and tags but no people; done leaves Today', () => {
  const app = appWithLists();
  const { id } = app.createCampaign({ name: 'Dec', type: 'realtor', lists: ['tyler'], tags: 'Realtors, Tyler , december, realtors', dailyCap: 4, callAfterDays: 5 });
  assert.deepEqual(app.getCampaign(id).campaign.tags, ['realtors', 'tyler', 'december']);
  app.saveCampaign(id, { tags: ['Q4', 'tyler'] });
  assert.deepEqual(app.listCampaigns().find(c => c.id === id).tags, ['q4', 'tyler']);
  assert.deepEqual(app.createCampaign({ name: 'Insp', type: 'inspector' }).id && app.listCampaigns()[0].tags, ['inspector'], 'default tag = the type');
  app.saveVersion('A', { subject: 'Dec subject', body: BODY, followUpBody: 'Still?' }, id);
  app.dealLetters(id, { rng: seeded(2) });
  app.saveCampaign(id, { status: 'running' });
  app.sendTodayBatch({ now: TUE });
  assert.ok(app.listVersions(id).every(v => v.Locked === 'Yes'));
  const copy = app.duplicateCampaign(id, { name: 'Dec again' });
  const c2 = app.getCampaign(copy.id);
  assert.equal(c2.campaign.status, 'draft'); assert.equal(c2.campaign.audience, 0); assert.deepEqual(c2.campaign.lists, []);
  assert.deepEqual(c2.campaign.tags, ['q4', 'tyler']); assert.equal(c2.campaign.cap, 4); assert.equal(c2.campaign.callAfterDays, 5);
  assert.deepEqual(c2.versions.map(v => [v.Subject, v.Locked]), [['Dec subject', '']], 'the copy has editable wording again');
  // done: off Today, numbers kept
  app.saveCampaign(id, { status: 'done' });
  assert.equal(app.buildTodayBatch({ now: TUE }).campaigns.some(c => c.id === id), false);
  assert.equal(app.listCampaigns().find(c => c.id === id).sent, 4);
});

test('release and series: a finished campaign frees its people after the cooling-off; Part 2 takes the silent ones; said-no stays out', () => {
  const app = appWithLists();
  const p1 = app.createCampaign({ name: 'Part 1', type: 'realtor', lists: ['tyler'], versions: ['A'], dailyCap: 50, sendingDays: 'Tue,Wed,Thu' });
  app.saveVersion('A', { subject: 'One', body: BODY, followUpBody: 'Hi {{first}}, still there?' }, p1.id);
  app.dealLetters(p1.id, { rng: seeded(2) });
  app.saveCampaign(p1.id, { status: 'running' });
  const rep = app.sendTodayBatch({ now: TUE });
  assert.equal(rep.sent, 29);
  const members = app.$rows('Partners').filter(p => p['Campaign ID'] === p1.id);
  // two reply, one says no
  const e = {}; app.$rows('Emails').filter(x => x.Step === 'first').forEach(x => { e[x['Partner ID']] = x; });
  [0, 1].forEach(i => app._updateRow_('Emails', e[members[i].ID]._row, { Status: 'replied' }));
  app._updateRow_('Partners', members[0]._row, { Stage: 'Replied', Response: 'Replied' });
  app._updateRow_('Partners', members[1]._row, { Stage: 'Replied', Response: 'Replied' });
  app._updateRow_('Partners', members[2]._row, { Stage: 'Replied', Response: 'Not interested' });
  // while Part 1 is open, nobody can be taken
  const p2 = app.createCampaign({ name: 'Part 2', type: 'realtor', lists: [p1.id], versions: ['A'] });
  let aud = app.campaignAudience(p2.id);
  assert.equal(aud.excluded['in another campaign'], 27, 'silent ones are still Part 1\'s while it runs');
  assert.equal(aud.matching, 0);
  // Part 1 done → free, but the cooling-off holds them
  app.saveCampaign(p1.id, { status: 'done' });
  aud = app.campaignAudience(p2.id);
  assert.equal(aud.excluded['emailed in the last 90 days'], 26);
  assert.equal(aud.excluded['said no'], 1);
  assert.ok(!aud.excluded['in another campaign']);
  // cooling-off over
  app.saveSettings({ reengage_days: '0' });
  aud = app.campaignAudience(p2.id);
  assert.equal(aud.matching, 26, 'the 29 minus 2 who replied minus 1 who said no');
  assert.equal(app.getCampaign(p2.id).campaign.listNames[0], 'no reply to “Part 1”');
  assert.equal(app.getCampaign(p2.id).earlier.find(x => x.id === p1.id).noReply, 27, 'pool counts everyone silent; said-no is cut by the exclusion');
  const dealt = app.dealLetters(p2.id, { rng: seeded(3) });
  assert.equal(dealt.dealt, 26);
  assert.ok(app.$rows('Partners').filter(p => p['Campaign ID'] === p2.id).length === 26);
  // Part 1 keeps its history and numbers
  assert.equal(app.getCampaignStats(p1.id).rows.reduce((n, r) => n + r.sent, 0), 29);
  assert.equal(app.campaignResults(p1.id).rows.length, 29);
  // Part 2 sends to them fresh: a new first email, not blocked by the old one
  app.saveVersion('A', { subject: 'Two', body: BODY, followUpBody: 'Hi {{first}}, one more thing.' }, p2.id);
  app.saveCampaign(p2.id, { status: 'running' });
  const b = app.buildTodayBatch({ now: new Date('2026-12-08T15:00:00Z'), campaignId: p2.id });
  assert.equal(b.firsts.length, 26);
  assert.ok(b.firsts.every(p => p['Campaign ID'] === p2.id));
});
