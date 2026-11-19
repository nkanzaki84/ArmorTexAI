/**
 * ArmorTex Outreach — comments_server.gs
 * Pinned comments on any page (developer tool, ported from SFM Job Manager).
 *
 * 💬 Comment arms the page; the next click drops a pin on that element and
 * opens a box. A pin is anchored to page + side + record id + a CSS path + the
 * element's text. Whoever may see comments (COMMENT_ROLES) sees the pin and
 * can reply; Resolve hides it. Settings lists every open thread.
 *
 * Tab `Comments`: one row per comment. Root row: Thread ID = its own ID,
 * carries the anchor + Status. Replies repeat the Thread ID, anchor blank.
 */

function _cmUser_() {
  const s = _requireRole_(COMMENT_ROLES);
  return { email: s.email, name: s.name };
}

function _cmNameFor_(email) {
  email = _normEmail_(email);
  if (!email) return '';
  if (email === _normEmail_(OWNER_EMAIL)) return 'Brian';
  try {
    const row = _readTab_(TAB.USERS).filter(function (u) { return _normEmail_(u['Email']) === email; })[0];
    if (row && String(row['Name'] || '').trim()) return String(row['Name']).trim();
  } catch (err) { /* tab missing */ }
  return email.split('@')[0];
}

function _cmPlain_(r) {
  return {
    commentId: String(r['ID'] || ''),
    threadId: String(r['Thread ID'] || r['ID'] || ''),
    status: String(r['Status'] || '').trim() || 'Open',
    page: String(r['Page'] || '').trim(),
    side: String(r['Side'] || '').trim(),
    recordId: String(r['Record ID'] || '').trim(),
    selector: String(r['Selector'] || '').trim(),
    quote: String(r['Quote'] || '').trim(),
    label: String(r['Label'] || '').trim(),
    text: String(r['Text'] || ''),
    author: _normEmail_(r['Author']),
    authorName: String(r['Author Name'] || '').trim(),
    to: String(r['To'] || '').trim(),
    createdAt: r['Created At'] ? String(r['Created At']) : '',
    resolvedAt: r['Resolved At'] ? String(r['Resolved At']) : '',
    resolvedBy: String(r['Resolved By'] || '').trim(),
    screenshotId: String(r['Screenshot Drive ID'] || '').trim(),
    screenshotUrl: String(r['Screenshot URL'] || '').trim(),
    _row: r._row,
  };
}

function _cmRows_() {
  try { return _readTab_(TAB.COMMENTS).map(_cmPlain_).filter(function (c) { return c.commentId; }); }
  catch (err) { return []; }
}

/** Rows → threads. Root carries the anchor and status; comments oldest first. */
function _cmThreads_(rows, me) {
  const byThread = {};
  rows.forEach(function (c) {
    const t = byThread[c.threadId] || (byThread[c.threadId] = { root: null, comments: [] });
    if (c.commentId === c.threadId) t.root = c;
    t.comments.push(c);
  });
  const num = function (id) { return Number(String(id).replace(/^\D+/, '')) || 0; };
  const out = [];
  Object.keys(byThread).forEach(function (k) {
    const t = byThread[k];
    const root = t.root || t.comments[0];
    t.comments.sort(function (a, b) { return num(a.commentId) - num(b.commentId); });
    const toList = root.to ? root.to.split(/[,;\s]+/).filter(Boolean).map(_normEmail_) : [];
    out.push({
      threadId: root.threadId, status: root.status, page: root.page, side: root.side, recordId: root.recordId,
      selector: root.selector, quote: root.quote, label: root.label,
      author: root.author, authorName: root.authorName, to: root.to, toList: toList,
      createdAt: root.createdAt, resolvedAt: root.resolvedAt, resolvedBy: root.resolvedBy,
      lastAt: t.comments[t.comments.length - 1].createdAt,
      mine: !!me && (root.author === me || toList.indexOf(me) !== -1),
      hasScreenshot: t.comments.some(function (c) { return !!c.screenshotId; }),
      comments: t.comments.map(function (c) { return { commentId: c.commentId, text: c.text, author: c.author, authorName: c.authorName, createdAt: c.createdAt, mine: !!me && c.author === me, screenshotId: c.screenshotId }; }),
    });
  });
  out.sort(function (a, b) { return (a.status === b.status ? 0 : (a.status === 'Open' ? -1 : 1)) || (b.lastAt > a.lastAt ? 1 : b.lastAt < a.lastAt ? -1 : 0); });
  return out;
}

/**
 * Threads pinned to one page. A thread with a record id shows only on that
 * record; one without shows on every record of that page.
 * opts: { page, recordId?, includeResolved? }
 */
function listPageComments(opts) {
  opts = opts || {};
  const me = _cmUser_().email;
  const page = String(opts.page || '').trim();
  if (!page) return [];
  const rid = String(opts.recordId || '').trim();
  return _cmThreads_(_cmRows_(), me).filter(function (t) {
    if (t.page !== page) return false;
    if (t.recordId && t.recordId !== rid) return false;
    if (!opts.includeResolved && t.status !== 'Open') return false;
    return true;
  });
}

/** Every thread, for the inbox on Settings. status 'Open' (default) | 'Resolved' | 'All'. */
function listCommentThreads(opts) {
  opts = opts || {};
  const me = _cmUser_().email;
  const status = String(opts.status || 'Open');
  let threads = _cmThreads_(_cmRows_(), me);
  if (String(opts.scope || 'all') !== 'all') threads = threads.filter(function (t) { return t.mine; });
  if (status !== 'All') threads = threads.filter(function (t) { return t.status === status; });
  return threads.slice(0, Number(opts.limit) || 200);
}

/** Teammates to address a comment to: active Users. */
function listTeamContacts() {
  _cmUser_();
  return _readTab_(TAB.USERS)
    .filter(function (u) { return String(u['Active'] || 'Yes').toLowerCase() !== 'no'; })
    .map(function (u) { return { email: _normEmail_(u['Email']), name: String(u['Name'] || '').trim() }; });
}

function _cmShotFolder_() {
  const root = DriveApp.getRootFolder();
  const it = root.getFoldersByName(COMMENT_SHOTS_FOLDER);
  const base = it.hasNext() ? it.next() : root.createFolder(COMMENT_SHOTS_FOLDER);
  const year = String(new Date().getFullYear());
  const it2 = base.getFoldersByName(year);
  return it2.hasNext() ? it2.next() : base.createFolder(year);
}

/**
 * New thread (no threadId) or a reply (threadId). Emails the people in `to`
 * (new thread) or the thread's author + its people (reply), reply-to the sender.
 * p: { page, side?, recordId?, selector?, quote?, label?, text, to?, threadId?, url?,
 *      screenshotBase64?, screenshotMime? }
 */
function addPageComment(p) {
  p = p || {};
  const me = _cmUser_();
  const text = String(p.text || '').trim();
  if (!text) throw new Error('Type the comment first.');
  if (text.length > 4000) throw new Error('That comment is too long (4,000 characters max).');
  const threadId = String(p.threadId || '').trim();
  const rows = _cmRows_();
  let root = null;
  if (threadId) {
    root = rows.filter(function (c) { return c.commentId === threadId; })[0];
    if (!root) throw new Error('That comment thread is gone.');
  }
  const page = root ? root.page : String(p.page || '').trim();
  if (!page) throw new Error('No page to pin this to.');
  const to = String(p.to || '').split(/[,;\s]+/).map(_normEmail_).filter(Boolean);
  const bad = to.filter(function (e) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); });
  if (bad.length) throw new Error('That does not look like an email address: ' + bad.join(', '));

  const id = _nextId_(TAB.COMMENTS);
  const now = new Date();
  let shotFile = null, shotBlob = null;
  if (p.screenshotBase64) {
    const bytes = Utilities.base64Decode(String(p.screenshotBase64));
    if (bytes.length > COMMENT_SHOT_MAX) throw new Error('That screenshot is too big to attach (8 MB max).');
    const mime = String(p.screenshotMime || 'image/png');
    shotBlob = Utilities.newBlob(bytes, mime, 'comment-' + id + (mime.indexOf('jpeg') !== -1 ? '.jpg' : '.png'));
    try { shotFile = _cmShotFolder_().createFile(shotBlob); } catch (err) { shotFile = null; }
  }
  const row = {
    'ID': id,
    'Thread ID': root ? root.threadId : id,
    'Status': root ? '' : 'Open',
    'Page': page,
    'Side': root ? '' : String(p.side || '').trim(),
    'Record ID': root ? '' : String(p.recordId || '').trim(),
    'Selector': root ? '' : String(p.selector || '').trim().slice(0, 500),
    'Quote': root ? '' : String(p.quote || '').trim().slice(0, 200),
    'Label': root ? '' : String(p.label || '').trim().slice(0, 120),
    'Text': text,
    'Author': me.email,
    'Author Name': me.name || _cmNameFor_(me.email),
    'To': root ? '' : to.join(', '),
    'Created At': now,
    'Resolved At': '',
    'Resolved By': '',
    'Screenshot Drive ID': shotFile ? shotFile.getId() : '',
    'Screenshot URL': shotFile ? shotFile.getUrl() : '',
  };
  _appendRows_(TAB.COMMENTS, [row]);
  if (root && root.status === 'Resolved') _cmSetStatus_(root.threadId, 'Open', me.email);   // a reply reopens

  let notify = root ? [root.author].concat(root.to ? root.to.split(/[,;\s]+/) : []) : to;
  notify = notify.map(_normEmail_).filter(function (e, i, a) { return e && e !== me.email && a.indexOf(e) === i; });
  let emailed = false;
  if (notify.length) {
    const anchor = root || _cmPlain_(row);
    const where = anchor.page + (anchor.recordId ? ' · ' + anchor.recordId : '') + (anchor.label ? ' › ' + anchor.label : '');
    const link = String(p.url || '').trim() || _cmPageUrl_(anchor);
    const subject = (root ? 'Reply' : 'Comment') + ' from ' + row['Author Name'] + ' on ' + where;
    const body = [
      row['Author Name'] + ' (' + me.email + ') ' + (root ? 'replied' : 'commented') + ' · ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'MMM d, yyyy h:mm a'),
      'Where:  ' + where,
      anchor.quote ? 'On:     "' + anchor.quote + '"' : '',
      '',
      text,
      shotFile ? '\nScreenshot attached (also on the pin in the app).' : '',
      '',
      'Open it: ' + link + (link.indexOf('#') === -1 ? '#comment=' + (root ? root.threadId : id) : ''),
      'Reply to this email to answer ' + row['Author Name'] + ' directly, or reply on the pin in the app.',
    ].filter(function (l, i, a) { return l !== '' || (i > 0 && a[i - 1] !== ''); }).join('\n');
    try {
      MailApp.sendEmail(Object.assign({ to: notify.join(','), subject: subject, body: body, replyTo: me.email, name: 'ArmorTex Outreach' }, shotBlob ? { attachments: [shotBlob] } : {}));
      emailed = true;
    } catch (err) { Logger.log('comment email failed: ' + err); }
  }
  const thread = _cmThreads_(_cmRows_(), me.email).filter(function (t) { return t.threadId === (root ? root.threadId : id); })[0];
  return { ok: true, commentId: id, threadId: root ? root.threadId : id, emailed: emailed, notified: notify, thread: thread, screenshotId: shotFile ? shotFile.getId() : '' };
}

function _cmPageUrl_(a) {
  let base = '';
  try { base = ScriptApp.getService().getUrl(); } catch (err) { base = ''; }
  let q = '?page=' + encodeURIComponent(a.page || '');
  if (a.side) q += '&side=' + encodeURIComponent(a.side);
  if (a.recordId) q += '&id=' + encodeURIComponent(a.recordId);
  return base + q;
}

function _cmSetStatus_(threadId, status, me) {
  const idx = _findRowIndex_(TAB.COMMENTS, function (r) { return String(r['ID']) === String(threadId); });
  if (idx === -1) throw new Error('That comment thread is gone.');
  _updateRow_(TAB.COMMENTS, idx, {
    'Status': status,
    'Resolved At': status === 'Resolved' ? new Date() : '',
    'Resolved By': status === 'Resolved' ? me : '',
  });
}

/** Resolve (hide the pin) or reopen a thread. */
function resolveCommentThread(threadId, reopen) {
  const me = _cmUser_();
  _cmSetStatus_(threadId, reopen ? 'Open' : 'Resolved', me.email);
  return _cmThreads_(_cmRows_(), me.email).filter(function (t) { return t.threadId === String(threadId); })[0] || null;
}

/** The screenshot filed with a comment, as base64 for the thread panel. Only
 *  files a Comments row names are served, never an arbitrary Drive id. */
function getCommentScreenshot(commentId) {
  _cmUser_();
  const row = _cmRows_().filter(function (c) { return c.commentId === String(commentId); })[0];
  if (!row || !row.screenshotId) throw new Error('No screenshot on that comment.');
  const file = DriveApp.getFileById(row.screenshotId);
  const blob = file.getBlob();
  return { commentId: row.commentId, mime: String(file.getMimeType() || 'image/png'), base64: Utilities.base64Encode(blob.getBytes()), name: file.getName() };
}
