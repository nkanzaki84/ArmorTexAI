// ============================================================
// Offices (built 2026-11-23, Brian: "I like the offices idea"). A brokerage
// is the second lens on prospects: the same people grouped by where they
// sit. One office visit touches every agent there. Offices are derived
// from Partners.Company (normalised) and kept in the Offices tab for the
// facts only an office has: address, phone, manager, visits.
// ============================================================

/** Company → a key that survives the usual spelling differences. */
function _officeKey_(name) {
  let s = String(name || '').toLowerCase().trim();
  if (!s) return '';
  s = s.replace(/&/g, ' and ').replace(/\./g, '').replace(/[,'’"()\/\-]/g, ' ');
  s = s.replace(/\b(the|llc|inc|co|ltd|lp|pllc|corp|company|group|team|realty|realtors|real estate|brokerage|properties|property|associates|partners|agency|office)\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // brand shorthand → the long form, so KW / Keller Williams and RE/MAX / Remax land together
  s = s.replace(/\bre max\b/g, 'remax').replace(/\bkw\b/g, 'keller williams').replace(/\bc21\b/g, 'century 21').replace(/\bcb\b/g, 'coldwell banker').replace(/\bbhhs\b/g, 'berkshire hathaway homeservices').replace(/\bexp\b/g, 'exp');
  s = s.replace(/^keller williams tyler$/, 'keller williams');
  return s.replace(/\s+/g, ' ').trim();
}

/** Walk Partners: give everyone with a Company an Office ID, creating offices as needed. Returns {created, linked}. */
function _syncOffices_(me) {
  const offices = _readTab_(TAB.OFFICES);
  const byKey = {};
  offices.forEach(function (o) {
    byKey[_officeKey_(o['Name'])] = o;
    _csvList_(o['Aliases']).forEach(function (a) { byKey[_officeKey_(a)] = o; });
  });
  const partners = _readTab_(TAB.PARTNERS);
  const updates = [];
  const created = [];
  const now = new Date();
  const who = (me && me.email) || _userEmail_() || '';
  partners.forEach(function (p) {
    if (String(p['Office ID'] || '').trim()) return;
    const key = _officeKey_(p['Company']);
    if (!key) return;
    let o = byKey[key];
    if (!o) {
      o = { 'ID': '', 'Name': String(p['Company']).trim(), 'Aliases': '', 'Address': '', 'Phone': '', 'Manager': '', 'Notes': '', 'Last Visit': '', 'Created At': now, 'Created By': who, 'Updated At': now, 'Updated By': who };
      byKey[key] = o; created.push(o);
    }
    updates.push({ p: p, o: o });
  });
  if (created.length) {
    const ids = _nextId_(TAB.OFFICES, created.length);
    created.forEach(function (o, i) { o['ID'] = ids[i]; });
    _appendRows_(TAB.OFFICES, created);
  }
  _updateRows_(TAB.PARTNERS, updates.map(function (u) { return { rowIndex: u.p._row, row: { 'Office ID': String(u.o['ID']) } }; }));
  return { created: created.length, linked: updates.length };
}

function _officeById_(id) {
  const o = _byId_(TAB.OFFICES, id);
  if (!o) throw new Error('Office not found: ' + id);
  return o;
}

function _visitsByOffice_() {
  const out = {};
  _readTab_(TAB.EVENTS).forEach(function (ev) {
    if (ev['Kind'] !== 'visit' || !ev['Office ID']) return;
    (out[String(ev['Office ID'])] = out[String(ev['Office ID'])] || []).push(ev);
  });
  Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return new Date(b['At']) - new Date(a['At']); }); });
  return out;
}

/** Every office with its agent counts and last visit. Any role. Write roles get a sync first so new imports show up. */
function listOffices() {
  const session = _requireRole_(ROLES.map(function (r) { return r.key; }));
  if (WRITE_ROLES.indexOf(session.role) !== -1) _syncOffices_(session);
  const visits = _visitsByOffice_();
  const agg = {};
  _readTab_(TAB.PARTNERS).forEach(function (p) {
    const oid = String(p['Office ID'] || '').trim();
    if (!oid) return;
    const a = agg[oid] = agg[oid] || { agents: 0, replied: 0, partners: 0, emailed: 0, types: {} };
    a.agents++;
    const tier = _tierOf_(p);
    if (tier === 'marketing') a.replied++;
    if (tier === 'partners') a.partners++;
    if (String(p['Stage']) === 'Contacted' || String(p['Stage']) === 'Replied' || String(p['Stage']) === 'Partner') a.emailed++;
    a.types[String(p['Type'])] = (a.types[String(p['Type'])] || 0) + 1;
  });
  return _readTab_(TAB.OFFICES).map(function (o) {
    const a = agg[String(o['ID'])] || { agents: 0, replied: 0, partners: 0, emailed: 0, types: {} };
    const v = visits[String(o['ID'])] || [];
    return { id: String(o['ID']), name: String(o['Name'] || ''), aliases: _csvList_(o['Aliases']), address: String(o['Address'] || ''), phone: String(o['Phone'] || ''), manager: String(o['Manager'] || ''), notes: String(o['Notes'] || ''),
      agents: a.agents, replied: a.replied, partners: a.partners, emailed: a.emailed, types: a.types, visits: v.length, lastVisit: v.length ? v[0]['At'] : (o['Last Visit'] || '') };
  }).sort(function (a, b) { return (b.agents - a.agents) || a.name.localeCompare(b.name); });
}

/** One office: facts, its agents, its visits. */
function getOffice(id) {
  const session = _requireRole_(ROLES.map(function (r) { return r.key; }));
  const o = _officeById_(id);
  const metrics = _partnerMetricsMap_();
  const agents = _readTab_(TAB.PARTNERS).filter(function (p) { return String(p['Office ID']) === String(id); }).map(function (p) {
    const m = metrics[p['ID']] || { calls: 0, referralsIn: 0 };
    return { ID: p['ID'], Name: p['Name'], Type: p['Type'], Email: p['Email'], Phone: p['Phone'], Stage: p['Stage'], Response: p['Response'], Rep: p['Rep'], tier: _tierOf_(p), 'Last Contact': p['Last Contact'] || '', calls: m.calls, referralsIn: m.referralsIn, dnc: _yes_(p['Do Not Contact']) };
  }).sort(function (a, b) { const r = { partners: 0, marketing: 1, prospects: 2 }; return (r[a.tier] - r[b.tier]) || String(a.Name).localeCompare(String(b.Name)); });
  const visits = (_visitsByOffice_()[String(id)] || []).map(function (ev) { return { ID: ev['ID'], At: ev['At'], Outcome: ev['Outcome'], Snippet: ev['Snippet'], By: ev['By'] }; });
  return {
    office: { id: String(o['ID']), name: String(o['Name'] || ''), aliases: _csvList_(o['Aliases']), address: String(o['Address'] || ''), phone: String(o['Phone'] || ''), manager: String(o['Manager'] || ''), notes: String(o['Notes'] || ''), lastVisit: visits.length ? visits[0].At : (o['Last Visit'] || '') },
    agents: agents, visits: visits, outcomes: VISIT_OUTCOMES, canWrite: WRITE_ROLES.indexOf(session.role) !== -1,
  };
}

function saveOffice(id, payload) {
  const me = _requireRole_(WRITE_ROLES);
  const o = _officeById_(id);
  payload = payload || {};
  const row = {};
  if (payload.name !== undefined) { const n = String(payload.name).trim(); if (!n) throw new Error('Name is required.'); row['Name'] = n; }
  ['address', 'phone', 'manager', 'notes'].forEach(function (k) { if (payload[k] !== undefined) row[k.charAt(0).toUpperCase() + k.slice(1)] = String(payload[k] || '').trim(); });
  if (payload.phone !== undefined) row['Phone'] = _digits_(payload.phone);
  row['Updated At'] = new Date(); row['Updated By'] = me.email;
  _updateRow_(TAB.OFFICES, o._row, row);
  return { ok: true };
}

/**
 * Log a visit to an office. Shows on every agent's record there, but is not a
 * call to any one of them (the call list is untouched). Owner or sales.
 */
function logOfficeVisit(id, payload) {
  const me = _requireRole_(WRITE_ROLES);
  const o = _officeById_(id);
  payload = payload || {};
  const outcome = String(payload.outcome || 'other');
  if (VISIT_OUTCOMES.indexOf(outcome) === -1) throw new Error('Outcome must be one of ' + VISIT_OUTCOMES.join(', ') + '.');
  const at = payload.at ? _parseLocalDate_(payload.at) : new Date();
  const met = String(payload.met || '').trim();
  const note = (met ? 'Met ' + met + '. ' : '') + String(payload.notes || '').trim();
  const ev = { 'ID': _nextId_(TAB.EVENTS), 'Partner ID': '', 'Home ID': '', 'Email ID': '', 'Kind': 'visit', 'Outcome': outcome, 'At': at, 'Snippet': note, 'By': me.email, 'Needs Review': '', 'Office ID': String(o['ID']) };
  _appendRows_(TAB.EVENTS, [ev]);
  _updateRow_(TAB.OFFICES, o._row, { 'Last Visit': at, 'Updated At': new Date(), 'Updated By': me.email });
  return { id: ev['ID'] };
}

/** Owner: fold one office into another (import spelling variants). Agents and visits move; the old name becomes an alias. */
function mergeOffices(keepId, mergeId) {
  const me = _requireRole_(ADMIN_ROLES);
  if (String(keepId) === String(mergeId)) throw new Error('Pick two different offices.');
  const keep = _officeById_(keepId), gone = _officeById_(mergeId);
  _updateRows_(TAB.PARTNERS, _readTab_(TAB.PARTNERS).filter(function (p) { return String(p['Office ID']) === String(mergeId); }).map(function (p) { return { rowIndex: p._row, row: { 'Office ID': String(keepId) } }; }));
  _updateRows_(TAB.EVENTS, _readTab_(TAB.EVENTS).filter(function (e) { return String(e['Office ID']) === String(mergeId); }).map(function (e) { return { rowIndex: e._row, row: { 'Office ID': String(keepId) } }; }));
  const aliases = _csvList_(keep['Aliases']).concat([String(gone['Name'])]).concat(_csvList_(gone['Aliases']));
  _updateRow_(TAB.OFFICES, keep._row, { 'Aliases': aliases.filter(function (a, i) { return a && aliases.indexOf(a) === i; }).join(','), 'Updated At': new Date(), 'Updated By': me.email });
  const idx = _findRowIndex_(TAB.OFFICES, function (o) { return String(o['ID']) === String(mergeId); });
  if (idx !== -1) _getTab_(TAB.OFFICES).deleteRow(idx);
  return { ok: true };
}

/**
 * Offices due a visit, for Today and the Calendar: members of a running campaign with a
 * visit step were first-emailed ≥ N business days ago and the office has not been visited
 * since the earliest of those emails. Returns one entry per office.
 */
function _visitsDue_(partners, now) {
  const emails = _readTab_(TAB.EMAILS);
  const firstSentAt = {};
  emails.forEach(function (e) { if (e['Step'] === 'first' && e['Sent At'] && e['Status'] !== 'cancelled' && (!firstSentAt[e['Partner ID']] || new Date(e['Sent At']) < new Date(firstSentAt[e['Partner ID']]))) firstSentAt[e['Partner ID']] = e['Sent At']; });
  const visits = _visitsByOffice_();
  const due = {};
  _readTab_(TAB.CAMPAIGNS).filter(function (c) { return String(c['Status']) === 'running' && _campaignSending_(c).visitAfterDays > 0; }).forEach(function (c) {
    const after = _campaignSending_(c).visitAfterDays;
    const isMember = _campaignMemberTest_(c['ID']);
    Object.keys(partners).forEach(function (id) {
      const p = partners[id];
      const oid = String(p['Office ID'] || '').trim();
      if (!oid || !isMember(p) || !firstSentAt[id]) return;
      const sent = new Date(firstSentAt[id]);
      if (_addBusinessDays_(sent, after).getTime() > now.getTime()) return;
      const lastVisit = (visits[oid] || [])[0];
      if (lastVisit && new Date(lastVisit['At']).getTime() >= sent.getTime()) return;
      const d = due[oid] = due[oid] || { officeId: oid, members: 0, campaign: String(c['Name']), campaignId: String(c['ID']), since: sent };
      d.members++;
      if (sent < d.since) d.since = sent;
    });
  });
  const offices = {};
  _readTab_(TAB.OFFICES).forEach(function (o) { offices[String(o['ID'])] = o; });
  return Object.keys(due).map(function (oid) {
    const o = offices[oid] || {};
    const agents = Object.keys(partners).filter(function (id) { return String(partners[id]['Office ID']) === oid; }).length;
    due[oid].since = new Date(due[oid].since).toISOString();   // never hand a Date to the browser: google.script.run drops the whole reply
    return Object.assign(due[oid], { name: String(o['Name'] || oid), address: String(o['Address'] || ''), phone: String(o['Phone'] || ''), manager: String(o['Manager'] || ''), agents: agents, lastVisit: (visits[oid] || [])[0] ? visits[oid][0]['At'] : '' });
  }).sort(function (a, b) { return (b.members - a.members) || (b.agents - a.agents); });
}
