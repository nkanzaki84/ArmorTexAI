// View as: the owner sees and acts as another user; nobody else can.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const TANNER = 'tanner@armortexroofs.com';
const CAITLIN = 'caitlin@armortexroofs.com';

test('view as: owner becomes Tanner for every guard, can switch back from inside, others cannot', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  app.saveUser({ email: TANNER, name: 'Tanner', role: 'sales' });
  app.saveUser({ email: CAITLIN, name: 'Caitlin', role: 'viewonly' });
  assert.deepEqual(app.listViewAsChoices().map(p => p.name).sort(), ['Caitlin', 'Tanner']);
  assert.throws(() => app.setViewAs('nobody@armortexroofs.com'), /not on the Users list/);
  let s = app.setViewAs(TANNER);
  assert.equal(s.role, 'sales');
  assert.equal(s.email, TANNER);
  assert.equal(s.impersonating.realEmail, OWNER);
  assert.equal(s.impersonating.name, 'Tanner');
  // guards follow the viewed-as role
  assert.throws(() => app.getSettings() && app.saveSettings({ daily_cap: '10' }), /cannot do that/);
  assert.doesNotThrow(() => app.addPartner({ type: 'realtor', name: 'Ann', email: 'ann@x.com' }));
  assert.equal(app.listPartners({})[0].Rep, TANNER, 'sales default to themselves: recorded as Tanner');
  const html = app.doGet({ parameter: { page: 'today' } }).getContent();
  assert.match(html, /Viewing as <b>Tanner<\/b> \(Sales\)/);
  assert.doesNotMatch(html, /page=settings/);
  // still the real owner underneath: can switch again and back
  s = app.setViewAs(CAITLIN);
  assert.equal(s.role, 'viewonly');
  s = app.clearViewAs();
  assert.equal(s.role, 'owner');
  assert.equal(s.impersonating, null);
  // a removed user drops the view silently
  app.setViewAs(CAITLIN);
  const cRow = app.$rows('Users').find(u => String(u.Email).toLowerCase() === CAITLIN);
  app._updateRow_('Users', cRow._row, { Active: 'No' });
  assert.equal(app.getCurrentUserSession().role, 'owner');
  // Tanner cannot view as anyone
  app.$as(TANNER);
  assert.throws(() => app.setViewAs(OWNER), /Only the owner/);
  assert.throws(() => app.listViewAsChoices(), /Only the owner/);
});

test('reply snippets drop mail-app signatures and separator rules', () => {
  const app = loadApp({ user: OWNER });
  assert.equal(app._stripQuoted_('Nice here is the reply\n\nGet Outlook for Mac<https://aka.ms/x>\n\n________________________________\n\nFrom: Brian\nold'), 'Nice here is the reply');
  assert.equal(app._stripQuoted_('Sure thing.\nSent from my iPhone'), 'Sure thing.');
});
