// Content library: add, edit, tag, use in a post, delete; roles.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const CAITLIN = 'caitlin@armortexroofs.com';

test('content library: create, tags, edit, use in a post, delete, roles', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  app.saveUser({ email: CAITLIN, name: 'Caitlin', role: 'viewonly' });
  app.$as(CAITLIN);
  assert.throws(() => app.createContent({ title: '' }), /title/);
  assert.throws(() => app.createContent({ title: 'Empty' }), /link or some text/);
  assert.throws(() => app.createContent({ title: 'X', kind: 'meme', text: 'x' }), /Kind must be/);
  const photo = app.createContent({ title: 'Judson Rd', kind: 'photo', link: 'https://drive.google.com/file/d/a/view', text: 'before and after', tags: ['Before After', 'tyler', 'tyler'] });
  const cap = app.createContent({ title: 'Hail caption', kind: 'caption', text: 'Storm came through. Free roof check.', tags: ['hail'] });
  let items = app.listContent();
  assert.equal(items.length, 2);
  deq(items.find(i => i.id === photo.id).tags, ['before-after', 'tyler'], 'tags normalised and deduped');
  app.saveContent(cap.id, { title: 'Hail caption v2', tags: ['hail', 'storm'] });
  const c = app.listContent().find(i => i.id === cap.id);
  assert.equal(c.title, 'Hail caption v2');
  deq(c.tags, ['hail', 'storm']);
  assert.equal(c.updatedBy, CAITLIN);
  // use in a post: a visual becomes the image, text goes to notes; a caption becomes the caption
  const p1 = app.useContentInPost(photo.id);
  const post1 = app.listSocialPosts().find(p => p.id === p1.id);
  assert.equal(post1.imageLink, 'https://drive.google.com/file/d/a/view');
  assert.equal(post1.caption, '');
  assert.match(post1.notes, /before and after/);
  assert.match(post1.notes, new RegExp('From the library: ' + photo.id));
  const p2 = app.useContentInPost(cap.id);
  assert.equal(app.listSocialPosts().find(p => p.id === p2.id).caption, 'Storm came through. Free roof check.');
  assert.equal(app.listContent().find(i => i.id === cap.id).uses, 1);
  app.markContentUsed(cap.id);
  assert.equal(app.listContent().find(i => i.id === cap.id).uses, 2);
  // delete is the owner's
  assert.throws(() => app.deleteContent(photo.id), /cannot do that/);
  app.$as(OWNER);
  app.deleteContent(photo.id);
  assert.equal(app.listContent().length, 1);
  assert.match(app.doGet({ parameter: { page: 'content' } }).getContent(), /<h1>Content<\/h1>/);
});
