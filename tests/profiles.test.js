const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';

test('every profile field has a Partners column and every type has a win response', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  const cols = JSON.parse(JSON.stringify(app.HEADERS.Partners));
  const profiles = JSON.parse(JSON.stringify(app.PARTNER_TYPE_PROFILES));
  const wins = JSON.parse(JSON.stringify(app.WIN_RESPONSES));
  const responses = JSON.parse(JSON.stringify(app.RESPONSES));
  JSON.parse(JSON.stringify(app.PARTNER_TYPES)).forEach(t => assert.ok(profiles[t], 'profile for ' + t));
  Object.keys(profiles).forEach(t => {
    profiles[t].fields.forEach(f => assert.ok(cols.indexOf(f.key) !== -1, t + ' field ' + f.key + ' needs a column'));
    assert.ok(wins.indexOf(profiles[t].win) !== -1, t + ' win must be in WIN_RESPONSES');
    assert.ok(responses.indexOf(profiles[t].win) !== -1, t + ' win must be a valid Response');
  });
});

test('profile fields save with validation; a win makes the partner a Partner; metrics come back', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  const pm = app.addPartner({ type: 'property_manager', name: 'Greg Albright', company: 'Albright PM', email: 'greg@apm.com', phone: '903-555-0401' });
  app.savePartner(pm, { profile: { 'Doors Managed': '1,200', 'Property Types': 'single family', 'Decision Maker': 'Yes' } });
  let rec = app.getPartner(pm);
  assert.equal(rec.partner['Doors Managed'], 1200);
  assert.equal(rec.partner['Decision Maker'], 'Yes');
  assert.equal(rec.profile.label, 'Property manager');
  assert.equal(rec.metrics.won, false);
  assert.throws(() => app.savePartner(pm, { profile: { 'Doors Managed': 'lots' } }), /must be a number/);
  assert.throws(() => app.savePartner(pm, { profile: { 'Decision Maker': 'Maybe' } }), /must be one of/);
  assert.throws(() => app.savePartner(pm, { profile: { 'Shoe Size': '12' } }), /Unknown profile field/);

  app.savePartner(pm, { response: 'Sent a property' });
  app.recountPartnerStages();
  rec = app.getPartner(pm);
  assert.equal(rec.partner.Stage, 'Partner');
  assert.equal(rec.metrics.won, true);

  const insp = app.addPartner({ type: 'inspector', name: 'Carl Dawson', email: 'carl@ethi.com' });
  app.savePartner(insp, { profile: { 'Avg Listing Value': 1 } });   // allowed: columns are shared, UI just won't show it
  app._appendRows_('Referrals', [
    { ID: 'R-1', Date: new Date(), Direction: 'in', 'Partner ID': insp, 'Customer Or Address': '12 Oak', 'Report Sent At': new Date(), 'Signed Or Lost': 'signed', 'Contract Amount': 14500 },
    { ID: 'R-2', Date: new Date(), Direction: 'out', 'Partner ID': insp, 'Customer Or Address': 'Mrs Lee' },
  ]);
  app.logPartnerEvent(insp, 'call', 'talked', 'wants samples');
  app.logPartnerEvent(insp, 'call', 'voicemail', '');
  const m = app.getPartner(insp).metrics;
  assert.equal(m.referralsIn, 1); assert.equal(m.referralsOut, 1);
  assert.equal(m.reportsSent, 1); assert.equal(m.jobsSigned, 1); assert.equal(m.jobValue, 14500);
  assert.equal(m.calls, 2); assert.equal(m.talked, 1);
  assert.equal(m.won, true);
  app.recountPartnerStages();
  assert.equal(app.getPartner(insp).partner.Stage, 'Partner', 'a referral in also makes a Partner');
});

test('the funnel counts every type\'s win as step 4', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  const a = app.addPartner({ type: 'realtor', name: 'R', email: 'r@x.com' });
  const b = app.addPartner({ type: 'insurance', name: 'I', email: 'i@x.com' });
  app._updateRows_('Partners', app.$rows('Partners').map(p => ({ rowIndex: p._row, row: { Version: 'A' } })));
  app._appendRows_('Emails', [a, b].map((id, i) => ({ ID: 'E-' + i, 'Partner ID': id, Version: 'A', Step: 'first', 'Sent At': new Date(), Status: 'sent' })));
  app.savePartner(a, { response: 'Sent an address' });
  app.savePartner(b, { response: 'Sent a claim' });
  const row = app.getCampaignStats().rows.find(r => r.version === 'A');
  assert.equal(row.addresses, 2);
});
