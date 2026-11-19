const { test } = require('node:test');
const assert = require('node:assert/strict');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';

function app() {
  const a = loadApp({ user: OWNER, mail: [] });
  a.setup();
  a.saveUser({ email: 'tanner@armortexroofs.com', name: 'Tanner Fought', role: 'sales' });
  return a;
}

test('setup creates the Comments tab', () => {
  const a = app();
  deq(a.$sheet('Comments')[0], a.HEADERS.Comments);
});

test('pin a comment, reply, resolve, reopen; emails go to the addressee', () => {
  const a = app();
  const r = a.addPageComment({ page: 'today', side: 'partners', selector: '#sendBtn', quote: 'Send batch', label: "Today's email batch", text: 'Make this button bigger on phones', to: 'tanner@armortexroofs.com', url: 'https://x/exec?page=today' });
  assert.equal(r.threadId, 'C-1');
  assert.equal(r.emailed, true);
  deq(r.notified, ['tanner@armortexroofs.com']);
  assert.equal(a.$ctx.mail.length, 1);
  assert.match(a.$ctx.mail[0].subject, /^Comment from Brian on today › Today's email batch/);
  assert.match(a.$ctx.mail[0].body, /#comment=C-1/);
  assert.equal(a.$ctx.mail[0].name, 'ArmorTex Outreach');

  let threads = a.listPageComments({ page: 'today' });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].selector, '#sendBtn');
  assert.equal(threads[0].comments.length, 1);
  deq(a.listPageComments({ page: 'partners' }), []);

  // reply from Tanner is refused (owner-only for now), owner reply works and notifies the addressee list minus self
  a.$as('tanner@armortexroofs.com');
  assert.throws(() => a.addPageComment({ threadId: 'C-1', text: 'ok' }), /cannot do that/);
  a.$as(OWNER);
  const rep = a.addPageComment({ threadId: 'C-1', text: 'Done in v0.1.1' });
  assert.equal(rep.threadId, 'C-1');
  assert.equal(rep.thread.comments.length, 2);
  assert.equal(rep.thread.comments[1].commentId, 'C-2');

  const resolved = a.resolveCommentThread('C-1', false);
  assert.equal(resolved.status, 'Resolved');
  assert.equal(resolved.resolvedBy, OWNER);
  deq(a.listPageComments({ page: 'today' }), [], 'resolved pins are hidden');
  assert.equal(a.listPageComments({ page: 'today', includeResolved: true }).length, 1);
  assert.equal(a.listCommentThreads({ status: 'Resolved' }).length, 1);

  // a reply reopens
  a.addPageComment({ threadId: 'C-1', text: 'Still too small' });
  assert.equal(a.listPageComments({ page: 'today' })[0].status, 'Open');
});

test('record-scoped pins show only on that record; screenshots are filed and served', () => {
  const a = app();
  a.addPageComment({ page: 'partner', side: 'partners', recordId: 'P-7', selector: '#rec', quote: 'x', text: 'Wrong phone format', screenshotBase64: Buffer.from('fakepng').toString('base64'), screenshotMime: 'image/png' });
  a.addPageComment({ page: 'partner', side: 'partners', selector: '#rec', quote: 'y', text: 'Every record: add a map link' });
  assert.equal(a.listPageComments({ page: 'partner', recordId: 'P-7' }).length, 2);
  assert.equal(a.listPageComments({ page: 'partner', recordId: 'P-8' }).length, 1);
  const t = a.listPageComments({ page: 'partner', recordId: 'P-7' }).find(x => x.recordId === 'P-7');
  assert.equal(t.hasScreenshot, true);
  const shot = a.getCommentScreenshot(t.comments[0].commentId);
  assert.equal(shot.mime, 'image/png');
  assert.equal(Buffer.from(shot.base64, 'base64').toString(), 'fakepng');
  assert.equal(a.DriveApp.$root.folders[0].name, 'ArmorTex Comment Screenshots');
  assert.throws(() => a.getCommentScreenshot('C-2'), /No screenshot/);
  assert.throws(() => a.addPageComment({ page: 'today', text: '' }), /Type the comment/);
  assert.throws(() => a.addPageComment({ page: 'today', text: 'hi', to: 'not-an-email' }), /does not look like an email/);
  deq(a.listTeamContacts().map(c => c.email).sort(), ['brian@armortexroofs.com', 'tanner@armortexroofs.com']);
});

test('dev url: setting, then constant, then /exec → /dev', () => {
  const a = app();
  assert.equal(a._appDevUrl_('https://script.google.com/a/macros/x/s/AKf/exec'), 'https://script.google.com/a/macros/x/s/AKf/dev');
  a.saveSettings({ dev_url: 'https://script.google.com/a/macros/x/s/DEV123/dev' });
  assert.equal(a._appDevUrl_('https://script.google.com/a/macros/x/s/AKf/exec'), 'https://script.google.com/a/macros/x/s/DEV123/dev');
  // doGet flags the test bench and exposes the dev URL and comment permission
  a.$ctx.appUrl = 'https://script.google.com/a/macros/x/s/DEV123/dev';
  const html = a.doGet({ parameter: { page: 'today' } }).getContent();
  assert.match(html, /<body class="dev-bench">/);
  assert.match(html, /isDev: true/);
  assert.match(html, /id="ownerTools"/);
  assert.match(html, /cmBanner/, 'comments included for the owner');
  a.$ctx.appUrl = 'https://script.google.com/a/macros/x/s/AKf/exec';
  a.$as('tanner@armortexroofs.com');
  const html2 = a.doGet({ parameter: { page: 'today' } }).getContent();
  assert.match(html2, /<body class="">/);
  assert.doesNotMatch(html2, /id="ownerTools"/);
  assert.doesNotMatch(html2, /cmBanner/);
});
