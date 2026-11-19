const { test } = require('node:test');
const assert = require('node:assert/strict');
// Values built inside the fake VM have foreign prototypes; compare as plain JSON.
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';

test('setup() creates every tab with its headers, seeds settings, versions, owner', () => {
  const app = loadApp({ user: OWNER });
  const report = app.setup();
  assert.ok(report.sheetId);
  Object.keys(app.HEADERS).forEach(tab => {
    const rows = app.$sheet(tab);
    deq(rows[0], app.HEADERS[tab], tab + ' headers');
  });
  const settings = app.getSettings();
  assert.equal(settings.daily_cap, '50');
  assert.equal(settings.sending_days, 'Tue,Wed,Thu');
  deq(app.listVersions().map(v => v.Letter), ['A', 'B', 'C', 'E']);
  assert.equal(app.listUsers()[0].Email, OWNER);
});

test('setup() is idempotent and only appends new headers', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  // simulate an older sheet missing the last Partners column
  const tab = app._getSpreadsheet_().getSheetByName('Partners');
  tab.rows[0] = tab.rows[0].slice(0, -1);
  tab.rows.push(['P-1', 'Ann', 'realtor', 'Co', '', 'ann@x.com', '', 'Prospect', '', '', '', '', '', '', 'list', '']);
  const report = app.setup();
  assert.ok(report.appended.some(s => s.startsWith('Partners: +Added By')));
  const rows = app.$rows('Partners');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Name, 'Ann');
  assert.equal(rows[0]['Added By'], '');
  assert.equal(app.listVersions().length, 4, 'versions not duplicated');
});

test('access: owner implicit, unlisted denied, roles enforced on writes', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  assert.equal(app.getCurrentUserSession().role, 'owner');

  app.saveUser({ email: 'tanner@armortexroofs.com', name: 'Tanner', role: 'sales' });
  app.saveUser({ email: 'caitlin@armortexroofs.com', name: 'Caitlin', role: 'viewonly' });

  app.$as('nobody@armortexroofs.com');
  assert.equal(app.getCurrentUserSession().denied, true);
  assert.throws(() => app.listPartners({}), /not on the Users list/);

  app.$as('caitlin@armortexroofs.com');
  assert.equal(app.getCurrentUserSession().role, 'viewonly');
  assert.doesNotThrow(() => app.listPartners({}));
  assert.throws(() => app.addPartner({ name: 'X', email: 'x@y.com' }), /cannot do that/);

  app.$as('tanner@armortexroofs.com');
  assert.doesNotThrow(() => app.addPartner({ name: 'X', email: 'x@y.com' }));
  assert.throws(() => app.importPartners('email\nq@q.com'), /cannot do that/);
  assert.throws(() => app.saveSettings({ daily_cap: '10' }), /cannot do that/);
  assert.throws(() => app.deleteUser(OWNER), /cannot do that/);

  app.$as(OWNER);
  assert.throws(() => app.deleteUser(OWNER), /cannot remove yourself/);
});

test('settings: daily cap cannot exceed the mailbox quota', () => {
  const app = loadApp({ user: OWNER, quota: 100 });
  app.setup();
  assert.throws(() => app.saveSettings({ daily_cap: '120' }), /above what this mailbox can send/);
  app.saveSettings({ daily_cap: '45' });
  assert.equal(app.getSettings().daily_cap, '45');
  assert.throws(() => app.saveSettings({ bogus: '1' }), /Unknown setting/);
});
