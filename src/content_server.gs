// ============================================================
// Content library (built 2026-11-23, Brian: "there also needs to be a
// content library"). Reusable pieces for posts and emails: photos, videos,
// graphics, caption snippets, email text, documents (the sample report),
// testimonials, links. Files stay in Drive/Canva; this holds the link,
// the text, tags and notes. Any signed-in role adds; the owner deletes.
// ============================================================

function _contentById_(id) {
  const r = _byId_(TAB.CONTENT, id);
  if (!r) throw new Error('Content not found: ' + id);
  return r;
}

function _contentClean_(payload, row) {
  if (payload.title !== undefined) row['Title'] = String(payload.title || '').trim();
  if (payload.kind !== undefined) {
    const k = String(payload.kind || 'photo');
    if (CONTENT_KINDS.indexOf(k) === -1) throw new Error('Kind must be one of ' + CONTENT_KINDS.join(', ') + '.');
    row['Kind'] = k;
  }
  if (payload.link !== undefined) row['Link'] = String(payload.link || '').trim();
  if (payload.text !== undefined) row['Text'] = String(payload.text || '');
  if (payload.tags !== undefined) row['Tags'] = _normTags_(payload.tags).join(',');
  if (payload.notes !== undefined) row['Notes'] = String(payload.notes || '');
  return row;
}

function _contentOut_(r) {
  return {
    id: String(r['ID']), title: String(r['Title'] || ''), kind: String(r['Kind'] || 'photo'), link: String(r['Link'] || ''), text: String(r['Text'] || ''),
    tags: _csvList_(r['Tags']), notes: String(r['Notes'] || ''), uses: Number(r['Uses']) || 0,
    createdAt: r['Created At'] || '', createdBy: String(r['Created By'] || ''), updatedAt: r['Updated At'] || '', updatedBy: String(r['Updated By'] || ''),
  };
}

/** Everything in the library, newest first. Any role. */
function listContent() {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  return _readTab_(TAB.CONTENT).map(_contentOut_).sort(function (a, b) { return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime(); });
}

function createContent(payload) {
  const me = _requireRole_(SOCIAL_WRITE_ROLES);
  payload = payload || {};
  const row = _contentClean_(Object.assign({ kind: 'photo' }, payload), {});
  if (!row['Title']) throw new Error('Give it a title.');
  if (!row['Link'] && !String(row['Text'] || '').trim()) throw new Error('Add a link or some text; an empty item is no use later.');
  const id = _nextId_(TAB.CONTENT);
  const now = new Date();
  _appendRows_(TAB.CONTENT, [Object.assign({ 'ID': id, 'Title': '', 'Kind': 'photo', 'Link': '', 'Text': '', 'Tags': '', 'Notes': '', 'Uses': 0 }, row, { 'Created At': now, 'Created By': me.email, 'Updated At': now, 'Updated By': me.email })]);
  return { id: id };
}

function saveContent(id, payload) {
  const me = _requireRole_(SOCIAL_WRITE_ROLES);
  const r = _contentById_(id);
  const row = _contentClean_(payload || {}, {});
  if (row['Title'] === '') throw new Error('Title is required.');
  row['Updated At'] = new Date(); row['Updated By'] = me.email;
  _updateRow_(TAB.CONTENT, r._row, row);
  return { ok: true };
}

function deleteContent(id) {
  _requireRole_(ADMIN_ROLES);
  const r = _contentById_(id);
  _getTab_(TAB.CONTENT).deleteRow(r._row);
  return { ok: true };
}

/** Count a use (the Social editor pulled it in, or "Use in a post"). */
function _contentUsed_(id) {
  const r = _byId_(TAB.CONTENT, id);
  if (r) _updateRow_(TAB.CONTENT, r._row, { 'Uses': (Number(r['Uses']) || 0) + 1 });
}

/** Start a social draft from a library item: text becomes the caption, a picture/video becomes the image link. */
function useContentInPost(id) {
  _requireRole_(SOCIAL_WRITE_ROLES);
  const r = _contentById_(id);
  const kind = String(r['Kind'] || '');
  const visual = ['photo', 'video', 'graphic'].indexOf(kind) !== -1;
  const post = createSocialPost({
    title: String(r['Title']), status: 'idea',
    caption: visual ? '' : String(r['Text'] || ''),
    imageLink: visual ? String(r['Link'] || '') : '',
    notes: (visual && r['Text'] ? String(r['Text']) + '\n' : '') + (r['Link'] && !visual ? 'Link: ' + String(r['Link']) + '\n' : '') + 'From the library: ' + String(r['ID']),
  });
  _contentUsed_(id);
  return post;
}

/** The Social editor's picker took this item. */
function markContentUsed(id) {
  _requireRole_(SOCIAL_WRITE_ROLES);
  _contentUsed_(id);
  return { ok: true };
}
