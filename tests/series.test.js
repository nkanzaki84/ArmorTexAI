// Series campaigns: dated steps to warm people and partners, sent by Today
// when the date comes, drawn on the calendar; cold prospects never.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const ADDRESS = '3310 South Broadway Ave, Ste 225A, Tyler, TX 75701';
const OPT = "Reply 'no thanks' and I won't email again.";
const NEWS = 'Hi {{first}},\n\nTwo roofs we did this month in {{area}} and one hail tip: https://armortexroofs.com/news\n\nBrian\nArmorTex Roofs\n' + ADDRESS + '\n' + OPT;

function seeded() {
  const app = loadApp({ user: OWNER, quota: 1500 });
  app.setup();
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT, daily_cap: '50' });
  app.importPartners(['Name,Email,Brokerage,Area', 'Cold One,c1@x.com,KW,Tyler', 'Warm One,w1@x.com,KW,Tyler', 'Warm Two,w2@x.com,eXp,Longview', 'Hot One,h1@x.com,KW,Tyler'].join('\n'), { sourceList: 'tyler' });
  app.addPartner({ type: 'realtor', name: 'No Mail', company: 'KW', area: 'Tyler', email: '' });
  const by = {}; app.$rows('Partners').forEach(p => { by[p.Name] = p; });
  app._updateRow_('Partners', by['Warm One']._row, { Stage: 'Replied', Response: 'Replied' });
  app._updateRow_('Partners', by['Warm Two']._row, { Stage: 'Replied', Response: 'Replied' });
  app._updateRow_('Partners', by['No Mail']._row, { Stage: 'Replied', Response: 'Replied' });
  app.markAsPartner(by['Hot One'].ID);
  return { app, by };
}

test('series: warm and partners only; steps with dates; Today sends due steps; calendar shows them; steps lock', () => {
  const { app, by } = seeded();
  assert.throws(() => app.createCampaign({ name: 'x', type: 'realtor', kind: 'blast' }), /outreach or series/);
  const { id } = app.createCampaign({ name: 'Partner news', type: 'realtor', kind: 'series', tiers: ['marketing', 'partners'] });
  let c = app.getCampaign(id);
  assert.equal(c.campaign.kind, 'series');
  deq(c.campaign.tiers, ['marketing', 'partners']);
  assert.equal(c.steps.length, 1, 'one empty step to start');
  // audience: the two warm, the one partner; the cold one and the one without email are out
  const aud = app.campaignAudience(id);
  assert.equal(aud.undealt, 3);
  assert.equal(aud.excluded['no email'], 1);
  assert.ok(!aud.excluded['in the book'], 'partners are welcome in a series');
  const dealt = app.dealLetters(id);
  assert.equal(dealt.dealt, 3);
  assert.equal(app.$rows('Partners').find(p => p.Name === 'Warm One').Version, '', 'no letters in a series');
  assert.equal(app.$rows('Partners').find(p => p.Name === 'Cold One')['Campaign ID'], '');
  // steps
  app.saveStep(id, '1', { sendOn: '2026-12-03', subject: 'December roofs', body: NEWS });
  const s2 = app.addStep(id, { sendOn: '2026-12-17', subject: 'Holiday hours', body: NEWS });
  assert.equal(s2.n, '2');
  app.addStep(id, {});
  assert.throws(() => app.saveCampaign(id, { status: 'running' }), /Step 3: No date/);
  app.removeStep(id, '3');
  app.saveCampaign(id, { status: 'running' });
  c = app.getCampaign(id);
  deq(c.steps.map(s => [s.n, s.sendOn, s.members, s.sent]), [['1', '2026-12-03', 3, 0], ['2', '2026-12-17', 3, 0]]);
  // nothing due before the date, even on a sending day
  let b = app.buildTodayBatch({ now: new Date('2026-12-01T15:00:00Z') });
  assert.equal(b.steps.length, 0);
  // the calendar shows both steps with who still owes
  const cal = app.getCalendar({ month: '2026-12', now: new Date('2026-12-01T15:00:00Z') });
  const d3 = cal.days['2026-12-03'].find(i => i.kind === 'series');
  assert.equal(d3.n, 3); assert.equal(d3.step, '1'); assert.match(d3.label, /Step 1 · Partner news/);
  assert.equal(cal.days['2026-12-17'].find(i => i.kind === 'series').n, 3);
  // on the date (a Thursday) step 1 is due for all three; sending logs step rows and locks step 1
  b = app.buildTodayBatch({ now: new Date('2026-12-03T15:00:00Z') });
  assert.equal(b.steps.length, 3);
  assert.ok(b.steps.every(x => x.step === '1' && x.campaignId === id));
  const rep = app.sendTodayBatch({ now: new Date('2026-12-03T15:00:00Z') });
  assert.equal(rep.steps, 3);
  assert.equal(rep.sent, 0);
  const rows = app.$rows('Emails').filter(e => e['Campaign ID'] === id);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(e => e.Step === 'step 1' && e.Version === '1' && e.Status === 'sent'));
  assert.ok(!app.$rows('Emails').some(e => e.Step === 'followup'), 'no follow-ups in a series');
  assert.match(app.GmailApp.$sent[app.GmailApp.$sent.length - 1].body, /https:\/\/armortexroofs\.com\/news/, 'links are allowed');
  assert.equal(app.getCampaign(id).steps[0].locked, true);
  assert.throws(() => app.saveStep(id, '1', { subject: 'x' }), /already went out/);
  assert.throws(() => app.removeStep(id, '1'), /already went out/);
  // not sent twice; a Saturday still sends a step whose date has passed (catch-up); step 2 waits for its date
  b = app.buildTodayBatch({ now: new Date('2026-12-05T15:00:00Z') });
  assert.equal(b.steps.length, 0);
  // someone who joins late gets step 1 on the next Today
  app._updateRow_('Partners', by['Cold One']._row, { Stage: 'Replied', Response: 'Replied' });
  assert.equal(app.dealLetters(id).dealt, 1);
  b = app.buildTodayBatch({ now: new Date('2026-12-07T15:00:00Z') });
  assert.equal(b.steps.length, 1);
  assert.equal(b.steps[0].Name, 'Cold One');
  // step 2 on its day: everyone (4) including the late joiner; an opt-out in between is skipped
  app.setPartnerDoNotContact(by['Warm Two'].ID, true);
  b = app.buildTodayBatch({ now: new Date('2026-12-17T15:00:00Z') });
  deq(b.steps.map(x => x.step + ':' + x.Name).sort(), ['1:Cold One', '2:Cold One', '2:Hot One', '2:Warm One']);
  const cal2 = app.getCalendar({ month: '2026-12', now: new Date('2026-12-04T15:00:00Z') });
  assert.equal(cal2.days['2026-12-03'].find(i => i.kind === 'series').n, 1, 'the late joiner still owes step 1, so the chip stays with 1 to go');
  assert.equal(cal2.days['2026-12-03'].find(i => i.kind === 'sent').n, 3);
  // results by step
  const stats = app.getCampaignStats(id);
  assert.equal(stats.rows.find(r => r.version === '1').sent, 3);
  // duplicate copies the steps without dates
  const dup = app.duplicateCampaign(id, { name: 'Partner news 2' });
  const d = app.getCampaign(dup.id);
  assert.equal(d.campaign.kind, 'series');
  deq(d.steps.map(s => [s.n, s.sendOn, s.subject]), [['1', '', 'December roofs'], ['2', '', 'Holiday hours']]);
});
