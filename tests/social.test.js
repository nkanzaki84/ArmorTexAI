// Social media drafts: any signed-in role drafts (Caitlin is view-only on
// the CRM but writes here); nothing posts; the owner deletes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const CAITLIN = 'caitlin@armortexroofs.com';

test('social drafts: create, save, status flow, duplicate, delete, roles', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  app.saveUser({ email: CAITLIN, name: 'Caitlin', role: 'viewonly' });
  app.$as(CAITLIN);
  assert.throws(() => app.createSocialPost({}), /title or a caption/);
  const { id } = app.createSocialPost({ title: 'Hail season reminder', platforms: ['Instagram', 'Facebook', 'Bluesky'], caption: 'Check your roof after the storm.\nMore text.', hashtags: '#TylerTX' });
  assert.match(id, /^SP-\d+$/);
  let p = app.listSocialPosts()[0];
  assert.equal(p.title, 'Hail season reminder');
  deq(p.platforms, ['Instagram', 'Facebook'], 'unknown platform dropped');
  assert.equal(p.status, 'idea');
  assert.equal(p.createdBy, CAITLIN);
  // title falls back to the first caption line
  const two = app.createSocialPost({ caption: 'Before and after on Judson Rd\nphotos' });
  assert.equal(app.listSocialPosts().find(x => x.id === two.id).title, 'Before and after on Judson Rd');
  // saving and the status flow
  app.saveSocialPost(id, { status: 'ready', plannedDate: '2026-12-03' });
  p = app.listSocialPosts().find(x => x.id === id);
  assert.equal(p.status, 'ready');
  assert.equal(String(p.plannedDate).slice(0, 10), '2026-12-03');
  assert.equal(p.postedAt, '');
  app.saveSocialPost(id, { status: 'posted', postUrl: 'https://instagram.com/p/abc' });
  p = app.listSocialPosts().find(x => x.id === id);
  assert.ok(p.postedAt, 'Posted At stamped once');
  assert.equal(p.postUrl, 'https://instagram.com/p/abc');
  app.saveSocialPost(id, { status: 'draft' });
  assert.equal(app.listSocialPosts().find(x => x.id === id).postedAt, '', 'back to draft clears Posted At');
  assert.throws(() => app.saveSocialPost(id, { status: 'live' }), /Status must be/);
  assert.throws(() => app.saveSocialPost(id, { title: '' }), /Title is required/);
  // duplicate → new idea, no date
  const dup = app.duplicateSocialPost(id);
  const d = app.listSocialPosts().find(x => x.id === dup.id);
  assert.equal(d.title, 'Hail season reminder (copy)');
  assert.equal(d.status, 'idea');
  assert.equal(d.plannedDate, '');
  deq(d.platforms, ['Instagram', 'Facebook']);
  // sorting: planned first, newest planned on top
  assert.equal(app.listSocialPosts()[0].id, id);
  // Caitlin cannot delete; the owner can
  assert.throws(() => app.deleteSocialPost(dup.id), /cannot do that/);
  app.$as(OWNER);
  app.deleteSocialPost(dup.id);
  assert.equal(app.listSocialPosts().length, 2);
  // the page renders for Caitlin with the New post button
  const html = app.doGet({ parameter: { page: 'social' } }).getContent();
  assert.match(html, /<h1>Social<\/h1>/);
  assert.match(html, /"canWrite":true/);
});
