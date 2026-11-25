// google.script.run returns null for any reply holding a Date object. Every
// page-facing function must answer with strings and numbers only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const ADDRESS = '3310 South Broadway Ave, Ste 225A, Tyler, TX 75701';
const OPT = "Reply 'no thanks' and I won't email again.";
const BODY = `Hi {{first}},\n\nFree roof report on any listing.\n\nWant a sample?\n\nBrian\nArmorTex Roofs\n${ADDRESS}\n${OPT}`;
const TUE = new Date('2026-12-01T15:00:00Z');
const seeded = (s) => () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

function findDates(v, path, out) {
  if (v instanceof Date || (v && typeof v === 'object' && typeof v.getTime === 'function' && typeof v.toISOString === 'function')) { out.push(path); return; }
  if (Array.isArray(v)) v.forEach((x, i) => findDates(x, path + '[' + i + ']', out));
  else if (v && typeof v === 'object') Object.keys(v).forEach(k => findDates(v[k], path + '.' + k, out));
}
const noDates = (name, v) => { const out = []; findDates(v, name, out); assert.deepEqual(out, [], name + ' hands a Date to the browser'); };

test('page-facing replies carry no Date objects', () => {
  const app = loadApp({ user: OWNER, quota: 1500 });
  app.setup();
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT, daily_cap: '10', reengage_days: '90' });
  app.importPartners(['Name,Email,Brokerage', 'A One,a1@x.com,KW', 'A Two,a2@x.com,KW', 'B One,b1@x.com,RE/MAX'].join('\n'), { sourceList: 'tyler' });
  const { id } = app.createCampaign({ name: 'Dec', type: 'realtor', lists: ['tyler'], versions: ['A'], visitAfterDays: 1, callAfterDays: 2 });
  app.saveVersion('A', { subject: 'One', body: BODY, followUpBody: 'Still there?' }, id);
  app.dealLetters(id, { rng: seeded(1) });
  app.saveCampaign(id, { status: 'running' });
  app.sendTodayBatch({ now: TUE });
  const p2 = app.createCampaign({ name: 'Part 2', type: 'realtor', lists: [id], versions: ['A'] });   // everyone excluded by the cooling-off → excludedPeople with lastSent
  const kw = app.listOffices().find(o => o.name === 'KW');
  app.logOfficeVisit(kw.id, { outcome: 'met_manager' });
  const pid = app.$rows('Partners')[0].ID;
  app.createSocialPost({ title: 'x', caption: 'y', plannedDate: '2026-12-10' });
  app.createContent({ title: 'c', kind: 'caption', text: 't' });
  const checks = {
    getCampaign: app.getCampaign(p2.id), getCampaign1: app.getCampaign(id), campaignAudience: app.campaignAudience(p2.id), listCampaigns: app.listCampaigns(), campaignResults: app.campaignResults(id),
    getTodayWork: app.getTodayWork({ now: new Date('2026-12-04T15:00:00Z') }), buildTodayBatch: app.buildTodayBatch({ now: TUE }),
    listOffices: app.listOffices(), getOffice: app.getOffice(kw.id), getPartner: app.getPartner(pid), listPartners: app.listPartners({}),
    getCalendar: app.getCalendar({ month: '2026-12', now: TUE }), listSocialPosts: app.listSocialPosts(), listContent: app.listContent(), listLists: app.listLists(),
    getSettings: app.getSettings(), getCurrentUserSession: app.getCurrentUserSession(), previewSampleReport: app.previewSampleReport(pid),
  };
  Object.keys(checks).forEach(k => noDates(k, checks[k]));
});
