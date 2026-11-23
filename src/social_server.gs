// ============================================================
// Social media drafts (built 2026-11-23, Brian: "a social media section
// … just drafts for now"). Nothing posts from here: Caitlin writes the
// caption, marks it ready, copies it into Instagram/Facebook by hand, and
// marks it posted with the link. Any signed-in role can draft
// (SOCIAL_WRITE_ROLES); only the owner deletes.
// ============================================================

function _socialById_(id) {
  const p = _byId_(TAB.SOCIAL, id);
  if (!p) throw new Error('Post not found: ' + id);
  return p;
}

function _socialClean_(payload, row) {
  if (payload.title !== undefined) row['Title'] = String(payload.title || '').trim();
  if (payload.platforms !== undefined) row['Platforms'] = (payload.platforms || []).map(String).filter(function (p) { return SOCIAL_PLATFORMS.indexOf(p) !== -1; }).join(',');
  if (payload.caption !== undefined) row['Caption'] = String(payload.caption || '');
  if (payload.hashtags !== undefined) row['Hashtags'] = String(payload.hashtags || '').trim();
  if (payload.imageLink !== undefined) row['Image Link'] = String(payload.imageLink || '').trim();
  if (payload.plannedDate !== undefined) row['Planned Date'] = payload.plannedDate ? _parseLocalDate_(payload.plannedDate) : '';
  if (payload.notes !== undefined) row['Notes'] = String(payload.notes || '');
  if (payload.postUrl !== undefined) row['Post URL'] = String(payload.postUrl || '').trim();
  if (payload.status !== undefined) {
    const s = String(payload.status || 'idea');
    if (SOCIAL_STATUSES.indexOf(s) === -1) throw new Error('Status must be one of ' + SOCIAL_STATUSES.join(', ') + '.');
    row['Status'] = s;
  }
  return row;
}

/** Every draft, newest planned first. Any role. */
function listSocialPosts() {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  return _readTab_(TAB.SOCIAL).map(function (r) {
    return {
      id: String(r['ID']), title: String(r['Title'] || ''), platforms: _csvList_(r['Platforms']), caption: String(r['Caption'] || ''),
      hashtags: String(r['Hashtags'] || ''), imageLink: String(r['Image Link'] || ''), plannedDate: r['Planned Date'] || '',
      status: String(r['Status'] || 'idea'), postedAt: r['Posted At'] || '', postUrl: String(r['Post URL'] || ''), notes: String(r['Notes'] || ''),
      createdAt: r['Created At'] || '', createdBy: String(r['Created By'] || ''), updatedAt: r['Updated At'] || '', updatedBy: String(r['Updated By'] || ''),
    };
  }).sort(function (a, b) {
    const da = a.plannedDate ? new Date(a.plannedDate).getTime() : 0, db = b.plannedDate ? new Date(b.plannedDate).getTime() : 0;
    return (db - da) || (new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  });
}

function createSocialPost(payload) {
  const me = _requireRole_(SOCIAL_WRITE_ROLES);
  payload = payload || {};
  const row = _socialClean_(Object.assign({ status: 'idea' }, payload), {});
  if (!row['Title'] && !String(row['Caption'] || '').trim()) throw new Error('Give the post a title or a caption.');
  if (!row['Title']) row['Title'] = String(row['Caption']).split('\n')[0].slice(0, 60);
  const id = _nextId_(TAB.SOCIAL);
  const now = new Date();
  _appendRows_(TAB.SOCIAL, [Object.assign({ 'ID': id, 'Title': '', 'Platforms': '', 'Caption': '', 'Hashtags': '', 'Image Link': '', 'Planned Date': '', 'Status': 'idea', 'Posted At': '', 'Post URL': '', 'Notes': '' }, row, { 'Created At': now, 'Created By': me.email, 'Updated At': now, 'Updated By': me.email })]);
  return { id: id };
}

function saveSocialPost(id, payload) {
  const me = _requireRole_(SOCIAL_WRITE_ROLES);
  const p = _socialById_(id);
  const row = _socialClean_(payload || {}, {});
  if (row['Title'] === '') throw new Error('Title is required.');
  if (row['Status'] === 'posted' && String(p['Status']) !== 'posted') row['Posted At'] = new Date();
  if (row['Status'] && row['Status'] !== 'posted' && String(p['Status']) === 'posted') row['Posted At'] = '';
  row['Updated At'] = new Date(); row['Updated By'] = me.email;
  _updateRow_(TAB.SOCIAL, p._row, row);
  return { ok: true };
}

/** Copy a post as a new idea (same caption, platforms, hashtags, image; no date, not posted). */
function duplicateSocialPost(id) {
  const me = _requireRole_(SOCIAL_WRITE_ROLES);
  const p = _socialById_(id);
  return createSocialPost({ title: String(p['Title']) + ' (copy)', platforms: _csvList_(p['Platforms']), caption: p['Caption'], hashtags: p['Hashtags'], imageLink: p['Image Link'], notes: p['Notes'], status: 'idea' });
}

function deleteSocialPost(id) {
  _requireRole_(ADMIN_ROLES);
  const p = _socialById_(id);
  _getTab_(TAB.SOCIAL).deleteRow(p._row);
  return { ok: true };
}
