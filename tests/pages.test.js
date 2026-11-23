const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const PAGES = [
  { page: 'today' }, { page: 'marketing' }, { page: 'partners' }, { page: 'partner', id: 'P-1' }, { page: 'partner', id: 'P-1', from: 'marketing' },
  { page: 'homes' }, { page: 'home', id: 'H-1' }, { page: 'campaigns' }, { page: 'campaign' }, { page: 'campaign', id: 'CP-1' }, { page: 'settings' }, { page: 'nope' },
];
const USERS = [
  [OWNER, 'owner'],
  ['tanner@armortexroofs.com', 'sales'],
  ['caitlin@armortexroofs.com', 'viewonly'],
  ['stranger@armortexroofs.com', 'denied'],
];

test('every page renders for every role on /exec and /dev without a template error', () => {
  for (const door of ['https://x/s/AKf/exec', 'https://x/s/AKf/dev']) {
    const app = loadApp({ user: OWNER, appUrl: door });
    app.setup();
    app.saveUser({ email: 'tanner@armortexroofs.com', name: 'Tanner', role: 'sales' });
    app.saveUser({ email: 'caitlin@armortexroofs.com', name: 'Caitlin', role: 'viewonly' });
    app.addPartner({ type: 'realtor', name: 'Ann', email: 'ann@x.com' });
    for (const [email, role] of USERS) {
      app.$as(email);
      for (const params of PAGES) {
        for (const side of ['partners', 'homes']) {
          let html;
          try { html = app.doGet({ parameter: Object.assign({ side }, params) }).getContent(); }
          catch (e) { assert.fail(`${role} ${JSON.stringify(params)} side=${side} on ${door}: ${e.message}`); }
          assert.ok(html.indexOf('<!DOCTYPE html>') === 0, 'renders a document');
          if (role === 'denied') assert.match(html, /isn't on the team list/);
          else if (params.page === 'settings' && role !== 'owner') assert.match(html, /can't open/);
          else assert.doesNotMatch(html, /isn't on the team list|can't open/);
        }
      }
    }
  }
});
