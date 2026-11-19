const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';

test('marketing vs partners: section filter, mark/unmark, Partner Since, touch clock', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  const a = app.addPartner({ type: 'realtor', name: 'Ann', email: 'ann@x.com' });
  const b = app.addPartner({ type: 'inspector', name: 'Bob', email: 'bob@x.com', phone: '9035550001' });
  const c = app.addPartner({ type: 'realtor', name: 'Cat', email: 'cat@x.com' });

  assert.equal(app.listPartners({ section: 'marketing' }).length, 3);
  assert.equal(app.listPartners({ section: 'partners' }).length, 0);

  // by hand
  app.markAsPartner(b);
  let book = app.listPartners({ section: 'partners' });
  assert.equal(book.length, 1);
  assert.equal(book[0].Name, 'Bob');
  assert.equal(book[0].Response, 'Referred a job');
  assert.ok(book[0]['Partner Since']);
  assert.equal(book[0].daysSinceContact, null, 'never contacted');
  assert.equal(book[0].cold, false);

  // by a win response + recount stamps Partner Since once
  app.savePartner(a, { response: 'Sent an address' });
  app.recountPartnerStages();
  book = app.listPartners({ section: 'partners' });
  assert.equal(book.length, 2);
  const annSince = book.find(p => p.Name === 'Ann')['Partner Since'];
  assert.ok(annSince);
  app.recountPartnerStages();
  assert.equal(app.listPartners({ section: 'partners' }).find(p => p.Name === 'Ann')['Partner Since'], annSince, 'not re-stamped');
  assert.equal(app.listPartners({ section: 'marketing' }).length, 1);
  assert.equal(app.listPartners({ section: 'marketing' })[0].Name, 'Cat');

  // touch clock: an old call makes a partner cold; a fresh one warms it
  const old = new Date(Date.now() - 45 * 86400000);
  app._appendRows_('Events', [{ ID: 'EV-1', 'Partner ID': b, Kind: 'call', Outcome: 'talked', At: old, By: OWNER }]);
  app._updateRow_('Partners', app.getPartner(b).partner._row, { 'Last Contact': old });
  let bob = app.listPartners({ section: 'partners' }).find(p => p.Name === 'Bob');
  assert.equal(bob.cold, true);
  assert.ok(bob.daysSinceContact >= 45);
  app.logPartnerEvent(b, 'call', 'talked', 'caught up');
  bob = app.listPartners({ section: 'partners' }).find(p => p.Name === 'Bob');
  assert.equal(bob.cold, false);
  assert.equal(bob.metrics.calls, 2);

  // metrics ride along
  app._appendRows_('Referrals', [{ ID: 'R-1', Date: new Date(), Direction: 'in', 'Partner ID': b, 'Customer Or Address': '9 Elm', 'Signed Or Lost': 'signed', 'Contract Amount': 12000 }]);
  bob = app.listPartners({ section: 'partners' }).find(p => p.Name === 'Bob');
  assert.equal(bob.metrics.referralsIn, 1);
  assert.equal(bob.metrics.jobValue, 12000);

  // back to marketing
  app.unmarkPartner(b);
  const bobRec = app.getPartner(b).partner;
  assert.equal(bobRec.Stage, 'Replied');
  assert.equal(bobRec['Partner Since'], '');
  assert.equal(app.listPartners({ section: 'marketing' }).length, 2);

  // viewonly cannot move people
  app.saveUser({ email: 'c@armortexroofs.com', name: 'C', role: 'viewonly' });
  app.$as('c@armortexroofs.com');
  assert.throws(() => app.markAsPartner(c), /cannot do that/);
});

test('pages: marketing and partners render from the shared list; record back-link follows ?from=', () => {
  const app = loadApp({ user: OWNER, appUrl: 'https://x/exec' });
  app.setup();
  const m = app.doGet({ parameter: { page: 'marketing' } }).getContent();
  assert.match(m, /<h1 style="margin:0">Marketing<\/h1>/);
  assert.match(m, /Today's batch/);
  assert.match(m, /id="funnel"/);
  const p = app.doGet({ parameter: { page: 'partners' } }).getContent();
  assert.match(p, /<h1 style="margin:0">Partners<\/h1>/);
  assert.match(p, /Gone cold/);
  assert.doesNotMatch(p, /id="funnel"/);
  const r1 = app.doGet({ parameter: { page: 'partner', id: 'P-1', from: 'marketing' } }).getContent();
  assert.match(r1, /← Marketing/);
  const r2 = app.doGet({ parameter: { page: 'partner', id: 'P-1' } }).getContent();
  assert.match(r2, /← Partners/);
  assert.match(m, /page=marketing&side=partners" class="active"/);
});
