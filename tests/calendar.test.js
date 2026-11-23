// Calendar: one month of sends, plan, follow-ups, calls, replies, social posts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const ADDRESS = '3310 South Broadway Ave, Ste 225A, Tyler, TX 75701';
const OPT = "Reply 'no thanks' and I won't email again.";
const BODY = `Hi {{first}},\n\nFree roof report on any listing.\n\nWant a sample?\n\nBrian\nArmorTex Roofs\n${ADDRESS}\n${OPT}`;
const TUE = new Date('2026-12-01T15:00:00Z');
const seeded = (s) => () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

test('calendar: sent emails, queued follow-ups, the plan, replies, calls and posts land on their days', () => {
  const app = loadApp({ user: OWNER, quota: 1500 });
  app.setup();
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT, daily_cap: '3', sending_days: 'Tue,Wed,Thu' });
  app.saveVersion('A', { subject: 'Roof report for {{company}} listings', body: BODY, followUpBody: 'Still happy to send a sample?' });
  const lines = ['Name,Email,Brokerage'];
  for (let i = 1; i <= 8; i++) lines.push(`Agent ${i},agent${i}@example.com,Co ${i % 3}`);
  app.importPartners(lines.join('\n'));
  app.assignVersions({ versions: ['A'], rng: seeded(9) });
  app.sendTodayBatch({ now: TUE });   // 3 go out Tue Dec 1; follow-ups queued +4 business days (Mon Dec 7)
  const p = app.$rows('Partners')[0];
  app._appendRows_('Events', [
    { ID: 'EV-1', 'Partner ID': p.ID, Kind: 'reply', At: new Date('2026-12-02T16:00:00Z'), Snippet: 'sure', By: 'trigger' },
    { ID: 'EV-2', 'Partner ID': p.ID, Kind: 'call', Outcome: 'talked', At: new Date('2026-12-02T18:00:00Z'), By: OWNER },
  ]);
  app.createSocialPost({ title: 'Hail reminder', platforms: ['Instagram'], plannedDate: '2026-12-10', status: 'ready' });
  app.createSocialPost({ title: 'Old post', status: 'posted', plannedDate: '2026-11-20' });

  const cal = app.getCalendar({ month: '2026-12', now: TUE });
  assert.equal(cal.month, '2026-12');
  assert.equal(cal.today, '2026-12-01');
  assert.deepEqual(JSON.parse(JSON.stringify(cal.sendingDays)).sort(), ['thu', 'tue', 'wed']);
  const d1 = cal.days['2026-12-01'];
  assert.equal(d1.find(i => i.kind === 'sent').n, 3);
  assert.ok(!d1.some(i => i.kind === 'plan'), 'today already sent: no plan chip for today');
  assert.equal(cal.days['2026-12-07'].find(i => i.kind === 'followup').n, 3, 'follow-ups due 4 business days later');
  const d2 = cal.days['2026-12-02'];
  assert.equal(d2.find(i => i.kind === 'reply').n, 1);
  assert.equal(d2.find(i => i.kind === 'call').n, 1);
  const planDays = Object.keys(cal.days).filter(k => cal.days[k].some(i => i.kind === 'plan')).sort();
  assert.deepEqual(planDays, ['2026-12-02', '2026-12-03'], '5 left at 3/day on Wed and Thu');
  assert.equal(cal.days['2026-12-02'].find(i => i.kind === 'plan').n, 3);
  assert.equal(cal.days['2026-12-03'].find(i => i.kind === 'plan').n, 2);
  const social = cal.days['2026-12-10'].find(i => i.kind === 'social');
  assert.equal(social.label, 'Hail reminder');
  assert.equal(social.status, 'ready');
  assert.ok(!cal.days['2026-11-20'], 'other months stay out');
  const nov = app.getCalendar({ month: '2026-11', now: TUE });
  assert.equal(nov.days['2026-11-20'][0].kind, 'social');
  assert.equal(nov.days['2026-11-20'][0].status, 'posted');
  // the page renders
  assert.match(app.doGet({ parameter: { page: 'calendar' } }).getContent(), /<h1>Calendar<\/h1>/);
});
