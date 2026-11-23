/**
 * ArmorTex Outreach — lists_server.gs
 * Curated lists: a named group of people, picked by hand or by filter.
 * A person can be on many lists. Lists only answer "who"; the pipeline
 * (Stage) answers "how far along". Campaigns point at lists (Brian,
 * 2026-11-23: "a lists section where I can create different email lists").
 *
 * Membership lives on the partner: Partners.Lists = "L-1,L-4". Sales and the
 * owner build lists; deleting one is owner only.
 */

function _partnerListIds_(p) {
  return String(p['Lists'] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}

function _listById_(id) {
  const l = _byId_(TAB.LISTS, id);
  if (!l) throw new Error('List not found: ' + id);
  return l;
}

/** Every list with its size. Any role. */
function listLists() {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const counts = {};
  _readTab_(TAB.PARTNERS).forEach(function (p) { _partnerListIds_(p).forEach(function (id) { counts[id] = (counts[id] || 0) + 1; }); });
  return _readTab_(TAB.LISTS).map(function (l) {
    return { id: String(l['ID']), name: String(l['Name'] || ''), notes: String(l['Notes'] || ''), count: counts[String(l['ID'])] || 0, createdAt: l['Created At'] || '', createdBy: String(l['Created By'] || '') };
  });
}

function createList(payload) {
  const me = _requireRole_(WRITE_ROLES);
  payload = payload || {};
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Give the list a name.');
  if (_readTab_(TAB.LISTS).some(function (l) { return String(l['Name']).trim().toLowerCase() === name.toLowerCase(); })) throw new Error('There is already a list called ' + name + '.');
  const id = _nextId_(TAB.LISTS);
  _appendRows_(TAB.LISTS, [{ 'ID': id, 'Name': name, 'Notes': String(payload.notes || ''), 'Created At': new Date(), 'Created By': me.email }]);
  return { id: id };
}

function saveList(id, payload) {
  _requireRole_(WRITE_ROLES);
  const l = _listById_(id);
  const row = {};
  if (payload.name !== undefined) { const n = String(payload.name).trim(); if (!n) throw new Error('Name is required.'); row['Name'] = n; }
  if (payload.notes !== undefined) row['Notes'] = String(payload.notes || '');
  _updateRow_(TAB.LISTS, l._row, row);
  return { ok: true };
}

/** Delete a list and take everyone off it. A campaign that points at it keeps its members (they were stamped when dealt). Owner only. */
function deleteList(id) {
  _requireRole_(ADMIN_ROLES);
  const l = _listById_(id);
  removeFromList(id, _readTab_(TAB.PARTNERS).filter(function (p) { return _partnerListIds_(p).indexOf(String(id)) !== -1; }).map(function (p) { return p['ID']; }));
  const tab = _getTab_(TAB.LISTS);
  tab.deleteRow(l._row);
  return { ok: true };
}

/** The people on a list, newest addition last. Any role. */
function listMembers(id) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  _listById_(id);
  return _readTab_(TAB.PARTNERS).filter(function (p) { return _partnerListIds_(p).indexOf(String(id)) !== -1; }).map(function (p) {
    return { ID: p['ID'], Name: p['Name'], Type: p['Type'], Company: p['Company'], Area: p['Area'], Email: p['Email'], Phone: p['Phone'], Stage: p['Stage'], Rep: p['Rep'], 'Source List': p['Source List'], 'Campaign ID': p['Campaign ID'], 'Do Not Contact': p['Do Not Contact'] };
  });
}

/** Put people on a list. Already-on is fine. Returns how many were new. */
function addToList(id, partnerIds) {
  _requireRole_(WRITE_ROLES);
  _listById_(id);
  const want = {};
  (partnerIds || []).forEach(function (pid) { want[String(pid)] = true; });
  const updates = [];
  _readTab_(TAB.PARTNERS).forEach(function (p) {
    if (!want[String(p['ID'])]) return;
    const mine = _partnerListIds_(p);
    if (mine.indexOf(String(id)) !== -1) return;
    mine.push(String(id));
    updates.push({ rowIndex: p._row, row: { 'Lists': mine.join(',') } });
  });
  _updateRows_(TAB.PARTNERS, updates);
  return { added: updates.length };
}

function removeFromList(id, partnerIds) {
  _requireRole_(WRITE_ROLES);
  const want = {};
  (partnerIds || []).forEach(function (pid) { want[String(pid)] = true; });
  const updates = [];
  _readTab_(TAB.PARTNERS).forEach(function (p) {
    if (!want[String(p['ID'])]) return;
    const mine = _partnerListIds_(p);
    if (mine.indexOf(String(id)) === -1) return;
    updates.push({ rowIndex: p._row, row: { 'Lists': mine.filter(function (x) { return x !== String(id); }).join(',') } });
  });
  _updateRows_(TAB.PARTNERS, updates);
  return { removed: updates.length };
}

/**
 * Who matches a filter, for the "add everyone who…" box. Any role.
 * filter: { type, sourceList, area (contains), stage, rep, q (name/company) }
 * Never includes the Partners book unless includeBook, never do-not-contact.
 */
function matchPartners(filter) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  filter = filter || {};
  const area = String(filter.area || '').trim().toLowerCase();
  const q = String(filter.q || '').trim().toLowerCase();
  const rep = _normEmail_(filter.rep || '');
  return _readTab_(TAB.PARTNERS).filter(function (p) {
    if (_yes_(p['Do Not Contact'])) return false;
    if (!filter.includeBook && (String(p['Stage']) === 'Partner' || p['Partner Since'])) return false;
    if (filter.type && String(p['Type']) !== String(filter.type)) return false;
    if (filter.sourceList && String(p['Source List'] || '').trim() !== String(filter.sourceList)) return false;
    if (filter.stage && String(p['Stage'] || 'Prospect') !== String(filter.stage)) return false;
    if (rep && _normEmail_(p['Rep']) !== rep) return false;
    if (area && String(p['Area'] || '').toLowerCase().indexOf(area) === -1) return false;
    if (q && [p['Name'], p['Company'], p['Email']].join(' ').toLowerCase().indexOf(q) === -1) return false;
    return true;
  }).map(function (p) { return { ID: p['ID'], Name: p['Name'], Company: p['Company'], Area: p['Area'], Type: p['Type'], Stage: p['Stage'] }; });
}

/** Add everyone matching the filter. Returns how many were new. */
function addMatchingToList(id, filter) {
  _requireRole_(WRITE_ROLES);
  return addToList(id, matchPartners(filter).map(function (p) { return p.ID; }));
}
