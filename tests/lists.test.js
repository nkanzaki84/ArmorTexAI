// Curated lists: named groups a campaign points at.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const TANNER = 'tanner@armortexroofs.com';

function appWithPeople() {
  const app = loadApp({ user: OWNER });
  app.setup();
  app.saveUser({ email: TANNER, name: 'Tanner', role: 'sales' });
  const rows = ['Name,Email,Brokerage,City'];
  for (let i = 1; i <= 12; i++) rows.push(`Realtor ${i},r${i}@example.com,${['KW', 'eXp'][i % 2]},${i <= 8 ? 'Tyler' : 'Longview'}`);
  app.importPartners(rows.join('\n'), { sourceList: 'tyler', rep: TANNER });
  app.importPartners('Name,Email,Brokerage\nOld Partner,old@example.com,KW', { sourceList: 'established', established: true });
  app.importPartners('Name,Email,Company\nInspector One,insp@example.com,ETHI', { type: 'inspector', sourceList: 'inspectors' });
  return app;
}

test('create, rename, add by hand and by filter, remove, delete; a person can be on many lists', () => {
  const app = appWithPeople();
  const { id } = app.createList({ name: 'Tyler realtors Tanner has met', notes: 'from the mixer' });
  assert.equal(id, 'L-1');
  assert.throws(() => app.createList({ name: 'tyler realtors tanner has met' }), /already a list/);
  assert.throws(() => app.createList({ name: '' }), /name/);
  const ps = app.$rows('Partners');
  assert.deepEqual(app.addToList(id, [ps[0].ID, ps[1].ID, ps[0].ID]), { added: 2 });
  assert.deepEqual(app.addToList(id, [ps[1].ID]), { added: 0 }, 'already on it');
  assert.equal(app.listLists()[0].count, 2);
  assert.deepEqual(app.listMembers(id).map(m => m.Name), ['Realtor 1', 'Realtor 2']);
  // by filter: Tyler realtors only, never the book
  const m = app.matchPartners({ type: 'realtor', area: 'tyler' });
  assert.equal(m.length, 8);
  assert.ok(!app.matchPartners({ type: 'realtor' }).some(p => p.Name === 'Old Partner'), 'the book is never swept in');
  assert.equal(app.addMatchingToList(id, { type: 'realtor', area: 'tyler' }).added, 6, 'two were already on it');
  assert.equal(app.listMembers(id).length, 8);
  // a second list, overlapping
  const l2 = app.createList({ name: 'Longview' }).id;
  app.addMatchingToList(l2, { area: 'Longview' });
  app.addToList(l2, [ps[0].ID]);
  assert.equal(app.$rows('Partners').find(p => p.ID === ps[0].ID).Lists, 'L-1,L-2');
  assert.deepEqual(app.removeFromList(id, [ps[0].ID]), { removed: 1 });
  assert.equal(app.$rows('Partners').find(p => p.ID === ps[0].ID).Lists, 'L-2');
  app.saveList(l2, { name: 'Longview realtors', notes: 'north side' });
  assert.equal(app.listLists().find(l => l.id === l2).name, 'Longview realtors');
  app.deleteList(l2);
  assert.equal(app.listLists().length, 1);
  assert.equal(app.$rows('Partners').find(p => p.ID === ps[0].ID).Lists, '', 'taken off the deleted list');
  assert.throws(() => app.listMembers(l2), /not found/);
});

test('roles: sales can build lists, only the owner deletes; view-only reads', () => {
  const ctx = { user: OWNER };
  const app = loadApp(ctx);
  app.setup();
  app.saveUser({ email: TANNER, name: 'Tanner', role: 'sales' });
  app.saveUser({ email: 'caitlin@armortexroofs.com', name: 'Caitlin', role: 'viewonly' });
  app.importPartners('Name,Email\nA,a@x.com', { sourceList: 's' });
  ctx.user = TANNER;
  const { id } = app.createList({ name: 'Mine' });
  app.addToList(id, [app.$rows('Partners')[0].ID]);
  assert.throws(() => app.deleteList(id), /cannot do that/);
  ctx.user = 'caitlin@armortexroofs.com';
  assert.equal(app.listMembers(id).length, 1);
  assert.throws(() => app.createList({ name: 'x' }), /cannot do that/);
  assert.throws(() => app.addToList(id, ['P-1']), /cannot do that/);
});

test('a campaign pointed at a list deals letters to its members; lists and import files mix', () => {
  const app = appWithPeople();
  app.saveSettings({ business_address: 'X', opt_out_line: 'Reply no' });
  const { id: l1 } = app.createList({ name: 'Met' });
  const ps = app.$rows('Partners').filter(p => p.Type === 'realtor' && p.Stage !== 'Partner');
  app.addToList(l1, ps.slice(0, 5).map(p => p.ID));
  const c = app.createCampaign({ name: 'Dec', type: 'realtor', lists: [l1], versions: ['A'] });
  assert.equal(app.getCampaign(c.id).audience.undealt, 5);
  assert.deepEqual(app.getCampaign(c.id).campaign.listNames, ['Met']);
  const r = app.dealLetters(c.id);
  assert.equal(r.dealt, 5);
  // import file + list together: union
  const c2 = app.createCampaign({ name: 'Wide', type: 'realtor', lists: [l1, 'tyler'], versions: ['A'] });
  const aud = app.campaignAudience(c2.id);
  assert.equal(aud.undealt, 7, 'the other 7 on the tyler file; the 5 on Met are in Dec already');
  assert.equal(aud.excluded['in another campaign'], 5);
  // the page shell renders the Lists page for every role
  assert.ok(app.doGet({ parameter: { page: 'lists' } }).getContent().indexOf('Your lists') !== -1);
});
