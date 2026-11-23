// Offices: derived from Company, matched across spellings, visits, the visit
// step on Today, merge, and the office line on the record.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const TANNER = 'tanner@armortexroofs.com';
const ADDRESS = '3310 South Broadway Ave, Ste 225A, Tyler, TX 75701';
const OPT = "Reply 'no thanks' and I won't email again.";
const BODY = `Hi {{first}},\n\nFree roof report on any listing.\n\nWant a sample?\n\nBrian\nArmorTex Roofs\n${ADDRESS}\n${OPT}`;
const TUE = new Date('2026-12-01T15:00:00Z');
const seeded = (s) => () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

test('offices: import groups agents by company across spellings; record, save, visit, merge, roles', () => {
  const app = loadApp({ user: OWNER, quota: 1500 });
  app.setup();
  app.saveUser({ email: TANNER, name: 'Tanner', role: 'sales' });
  app.saveUser({ email: 'c@armortexroofs.com', name: 'Caitlin', role: 'viewonly' });
  const r = app.importPartners(['Name,Email,Brokerage', 'A One,a1@x.com,Keller Williams Realty', 'A Two,a2@x.com,KW', 'A Three,a3@x.com,"Keller Williams, Tyler"', 'B One,b1@x.com,RE/MAX Pros', 'B Two,b2@x.com,Remax Pros', 'C One,c1@x.com,eXp Realty', 'D One,d1@x.com,'].join('\n'), { sourceList: 'tyler' });
  assert.equal(r.officesCreated, 3, 'KW spellings fold together; RE/MAX spellings fold together; no company → no office');
  let offices = app.listOffices();
  assert.deepEqual(JSON.parse(JSON.stringify(offices.map(o => [o.name, o.agents]))), [['Keller Williams Realty', 3], ['RE/MAX Pros', 2], ['eXp Realty', 1]]);
  const kw = offices[0];
  assert.ok(app.$rows('Partners').filter(p => p['Office ID'] === kw.id).length === 3);
  assert.equal(app.$rows('Partners').find(p => p.Name === 'D One')['Office ID'], '');
  // adding someone with a company links them; changing the company re-links
  const pid = app.addPartner({ type: 'realtor', name: 'New Agent', email: 'n@x.com', company: 'K.W.' });
  assert.equal(app.$rows('Partners').find(p => p.ID === pid)['Office ID'], kw.id);
  app.savePartner(pid, { company: 'eXp' });
  assert.equal(app.$rows('Partners').find(p => p.ID === pid)['Office ID'], offices[2].id);
  // record + save
  let o = app.getOffice(kw.id);
  assert.equal(o.agents.length, 3);
  assert.equal(o.visits.length, 0);
  app.saveOffice(kw.id, { address: '100 Main St, Tyler', manager: 'Pat', phone: '(903) 555-0100' });
  o = app.getOffice(kw.id);
  assert.equal(o.office.address, '100 Main St, Tyler');
  assert.equal(o.office.phone, '9035550100');
  // a visit shows on the office and on the agent's record, but is not a call
  app.$as(TANNER);
  assert.throws(() => app.logOfficeVisit(kw.id, { outcome: 'coffee' }), /Outcome must be/);
  app.logOfficeVisit(kw.id, { outcome: 'left_samples', met: 'Pat', notes: 'back Thursday', at: '2026-12-02' });
  o = app.getOffice(kw.id);
  assert.equal(o.visits.length, 1);
  assert.equal(o.visits[0].Outcome, 'left_samples');
  assert.match(o.visits[0].Snippet, /Met Pat\. back Thursday/);
  assert.equal(o.visits[0].By, TANNER);
  const rec = app.getPartner(app.$rows('Partners').find(p => p.Name === 'A One').ID);
  assert.equal(rec.office.name, 'Keller Williams Realty');
  assert.ok(rec.office.lastVisit);
  assert.equal(rec.partner['Last Contact'], '', 'a visit is not a call to the agent');
  assert.equal(app.listOffices()[0].visits, 1);
  // merge is the owner's
  assert.throws(() => app.mergeOffices(kw.id, offices[2].id), /cannot do that/);
  app.$as(OWNER);
  app.mergeOffices(kw.id, offices[2].id);
  offices = app.listOffices();
  assert.equal(offices.length, 2);
  assert.equal(offices[0].agents, 5, 'eXp\'s two moved over');
  assert.deepEqual(JSON.parse(JSON.stringify(offices[0].aliases)), ['eXp Realty']);
  // view-only can read, not write
  app.$as('c@armortexroofs.com');
  assert.equal(app.listOffices().length, 2);
  assert.throws(() => app.saveOffice(kw.id, { notes: 'x' }), /cannot do that/);
  app.$as(OWNER);
  assert.match(app.doGet({ parameter: { page: 'office', id: kw.id } }).getContent(), /← Offices/);
});

test('visit step: offices land on Today N business days after the first email until a visit is logged', () => {
  const app = loadApp({ user: OWNER, quota: 1500 });
  app.setup();
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT, daily_cap: '50' });
  app.importPartners(['Name,Email,Brokerage', 'A One,a1@x.com,KW', 'A Two,a2@x.com,KW', 'B One,b1@x.com,RE/MAX'].join('\n'), { sourceList: 'tyler' });
  const { id } = app.createCampaign({ name: 'Dec', type: 'realtor', lists: ['tyler'], versions: ['A'], sendingDays: 'Tue,Wed,Thu', callAfterDays: 7, visitAfterDays: 3 });
  assert.equal(app.getCampaign(id).sending.visitAfterDays, 3);
  app.saveVersion('A', { subject: 'One', body: BODY, followUpBody: 'Still there?' }, id);
  app.dealLetters(id, { rng: seeded(1) });
  app.saveCampaign(id, { status: 'running' });
  app.sendTodayBatch({ now: TUE });   // Tue Dec 1
  assert.equal(app.getTodayWork({ now: new Date('2026-12-03T15:00:00Z') }).visits.length, 0, 'not due yet');
  let w = app.getTodayWork({ now: new Date('2026-12-04T15:00:00Z') });   // Fri = 3 business days
  assert.equal(w.visits.length, 2);
  assert.equal(w.visits[0].name, 'KW');
  assert.equal(w.visits[0].members, 2);
  assert.equal(w.visits[1].name, 'RE/MAX');
  // a visit clears it; a visit before the email does not
  const kw = app.listOffices().find(o => o.name === 'KW');
  app.logOfficeVisit(kw.id, { outcome: 'met_manager', at: '2026-12-04' });
  w = app.getTodayWork({ now: new Date('2026-12-07T15:00:00Z') });
  assert.deepEqual(w.visits.map(v => v.name), ['RE/MAX']);
  // calendar shows the visit
  assert.equal(app.getCalendar({ month: '2026-12', now: TUE }).days['2026-12-04'].find(i => i.kind === 'visit').n, 1);
  // no visit step → nothing
  app.saveCampaign(id, { visitAfterDays: '' });
  assert.equal(app.getTodayWork({ now: new Date('2026-12-07T15:00:00Z') }).visits.length, 0);
});
