/**
 * ArmorTex Outreach — partners.gs
 * Partner import, version assignment, partner list and record.
 */

// ============================================================
// Import (Automation 1)
// ============================================================

// Accepted header spellings → our column. Matching is case/space-insensitive.
const PARTNER_IMPORT_ALIASES = {
  'name': 'Name', 'full name': 'Name', 'agent': 'Name', 'agent name': 'Name', 'contact': 'Name',
  'first name': '_first', 'first': '_first', 'last name': '_last', 'last': '_last',
  'email': 'Email', 'e-mail': 'Email', 'email address': 'Email',
  'phone': 'Phone', 'mobile': 'Phone', 'cell': 'Phone', 'phone number': 'Phone',
  'company': 'Company', 'brokerage': 'Company', 'office': 'Company', 'firm': 'Company', 'agency': 'Company',
  'area': 'Area', 'city': 'Area', 'market': 'Area', 'territory': 'Area',
  'type': 'Type', 'partner type': 'Type',
  'notes': 'Notes',
};

/**
 * Import partners from CSV text. Skips rows with no email, duplicate emails
 * (within the file and against existing Partners), and emails on the
 * do-not-contact list. New rows start at stage Prospect with no version.
 *
 * @param {string} csvText
 * @param {{type?: string, sourceList?: string}} opts  default type 'realtor'
 * @return {{added:number, skipped:{noEmail:number, duplicate:number, doNotContact:number}, columns:string[]}}
 */
function importPartners(csvText, opts) {
  const me = _requireRole_(ADMIN_ROLES);
  opts = opts || {};
  const type = String(opts.type || 'realtor').toLowerCase();
  if (PARTNER_TYPES.indexOf(type) === -1) throw new Error('Unknown partner type: ' + type);
  const parsed = _parsePartnerCsv_(csvText);
  const existing = _readTab_(TAB.PARTNERS);
  const seen = {};
  const dnc = {};
  existing.forEach(function (p) {
    const e = _normEmail_(p['Email']);
    if (e) seen[e] = true;
    if (e && _yes_(p['Do Not Contact'])) dnc[e] = true;
  });
  _doNotContactEmails_().forEach(function (e) { dnc[e] = true; });

  const skipped = { noEmail: 0, duplicate: 0, doNotContact: 0 };
  const rows = [];
  const now = new Date();
  parsed.rows.forEach(function (r) {
    const email = _normEmail_(r.Email);
    if (!email || email.indexOf('@') === -1) { skipped.noEmail++; return; }
    if (dnc[email]) { skipped.doNotContact++; return; }
    if (seen[email]) { skipped.duplicate++; return; }
    seen[email] = true;
    rows.push({
      'Name': r.Name || email.split('@')[0],
      'Type': (r.Type && PARTNER_TYPES.indexOf(String(r.Type).toLowerCase()) !== -1) ? String(r.Type).toLowerCase() : type,
      'Company': r.Company || '',
      'Phone': _digits_(r.Phone),
      'Email': email,
      'Area': r.Area || '',
      'Stage': 'Prospect',
      'Version': '',
      'Response': '',
      'Do Not Contact': '',
      'Last Contact': '',
      'Next Step': '',
      'Notes': r.Notes || '',
      'Source List': opts.sourceList || ('import ' + _dateKey_(now)),
      'Added At': now,
      'Added By': me.email,
    });
  });
  const ids = _nextId_(TAB.PARTNERS, rows.length);
  rows.forEach(function (row, i) { row['ID'] = ids[i]; });
  _appendRows_(TAB.PARTNERS, rows);
  return { added: rows.length, skipped: skipped, columns: parsed.columns };
}

/** CSV → { columns:[mapped names], rows:[{Name, Email, …}] } */
function _parsePartnerCsv_(csvText) {
  const table = Utilities.parseCsv(String(csvText || '').replace(/^﻿/, ''));
  if (!table.length) return { columns: [], rows: [] };
  const header = table[0].map(function (h) { return String(h || '').trim().toLowerCase().replace(/\s+/g, ' '); });
  const map = header.map(function (h) { return PARTNER_IMPORT_ALIASES[h] || null; });
  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const line = table[i];
    if (!line.some(function (c) { return String(c).trim() !== ''; })) continue;
    const r = {};
    map.forEach(function (col, j) { if (col) r[col] = String(line[j] === undefined ? '' : line[j]).trim(); });
    if (!r.Name && (r._first || r._last)) r.Name = [r._first, r._last].filter(Boolean).join(' ');
    delete r._first; delete r._last;
    rows.push(r);
  }
  return { columns: map.filter(Boolean), rows: rows };
}

// ============================================================
// Version assignment (Automation 2)
// ============================================================

/**
 * Assign A/B/C/E to every partner of `type` that has no version yet. Within
 * each company the partners are shuffled and dealt out in turn, starting at
 * a rotating offset, so every version gets a fair mix of brokerages. A
 * version, once assigned, is never changed.
 *
 * @param {{type?: string, versions?: string[], rng?: function}} opts
 * @return {{assigned:number, counts:Object}}
 */
function assignVersions(opts) {
  _requireRole_(ADMIN_ROLES);
  opts = opts || {};
  const type = String(opts.type || 'realtor').toLowerCase();
  const versions = opts.versions || EMAIL_VERSIONS;
  const rng = opts.rng || Math.random;
  const partners = _readTab_(TAB.PARTNERS);
  const todo = partners.filter(function (p) {
    return String(p['Type']).toLowerCase() === type && !String(p['Version'] || '').trim() && !_yes_(p['Do Not Contact']);
  });
  // group by company (blank company = each on their own)
  const groups = {};
  todo.forEach(function (p) {
    const key = String(p['Company'] || '').trim().toLowerCase() || ('solo:' + p['ID']);
    (groups[key] = groups[key] || []).push(p);
  });
  // Deal: rotate the starting version from group to group so small groups
  // don't all land on A.
  const counts = {};
  versions.forEach(function (v) { counts[v] = 0; });
  // Start each group where the global deal left off, so totals stay even.
  let cursor = 0;
  const updates = [];
  const groupKeys = _shuffle_(Object.keys(groups), rng);
  groupKeys.forEach(function (key) {
    _shuffle_(groups[key], rng).forEach(function (p) {
      const v = versions[cursor % versions.length];
      cursor++;
      counts[v]++;
      updates.push({ rowIndex: p._row, row: { 'Version': v } });
    });
  });
  _updateRows_(TAB.PARTNERS, updates);
  return { assigned: updates.length, counts: counts };
}

// ============================================================
// List + record
// ============================================================

/**
 * @param {{type?:string, stage?:string, version?:string, response?:string, q?:string, includeDnc?:boolean}} filters
 */
function listPartners(filters) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  filters = filters || {};
  const q = String(filters.q || '').trim().toLowerCase();
  return _readTab_(TAB.PARTNERS).filter(function (p) {
    if (filters.type && String(p['Type']) !== filters.type) return false;
    if (filters.stage && String(p['Stage']) !== filters.stage) return false;
    if (filters.version && String(p['Version']) !== filters.version) return false;
    if (filters.response && String(p['Response']) !== filters.response) return false;
    if (!filters.includeDnc && _yes_(p['Do Not Contact'])) return false;
    if (q) {
      const hay = [p['Name'], p['Company'], p['Email'], p['Phone'], p['Area']].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function getPartner(id) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const p = _byId_(TAB.PARTNERS, id);
  if (!p) throw new Error('Partner not found: ' + id);
  const emails = _readTab_(TAB.EMAILS).filter(function (e) { return String(e['Partner ID']) === String(id); });
  const events = _readTab_(TAB.EVENTS).filter(function (e) { return String(e['Partner ID']) === String(id); });
  const referrals = _readTab_(TAB.REFERRALS).filter(function (r) { return String(r['Partner ID']) === String(id); });
  return { partner: p, emails: emails, events: events, referrals: referrals };
}

/** Add a partner by hand. */
function addPartner(payload) {
  const me = _requireRole_(WRITE_ROLES);
  const email = _normEmail_(payload.email);
  if (email && _findRowIndex_(TAB.PARTNERS, function (p) { return _normEmail_(p['Email']) === email; }) !== -1) {
    throw new Error('A partner with that email already exists.');
  }
  const type = String(payload.type || 'realtor').toLowerCase();
  if (PARTNER_TYPES.indexOf(type) === -1) throw new Error('Unknown partner type: ' + type);
  const row = {
    'ID': _nextId_(TAB.PARTNERS),
    'Name': String(payload.name || '').trim(),
    'Type': type,
    'Company': String(payload.company || '').trim(),
    'Phone': _digits_(payload.phone),
    'Email': email,
    'Area': String(payload.area || '').trim(),
    'Stage': 'Prospect', 'Version': '', 'Response': '', 'Do Not Contact': '',
    'Last Contact': '', 'Next Step': String(payload.nextStep || '').trim(),
    'Notes': String(payload.notes || '').trim(),
    'Source List': 'manual', 'Added At': new Date(), 'Added By': me.email,
  };
  if (!row['Name']) throw new Error('Name is required.');
  _appendRows_(TAB.PARTNERS, [row]);
  return row['ID'];
}

/** Update the editable fields of a partner (never Version, never Stage). */
function savePartner(id, payload) {
  _requireRole_(WRITE_ROLES);
  const idx = _findRowIndex_(TAB.PARTNERS, function (p) { return String(p['ID']) === String(id); });
  if (idx === -1) throw new Error('Partner not found: ' + id);
  const allowed = { name: 'Name', company: 'Company', phone: 'Phone', email: 'Email', area: 'Area', nextStep: 'Next Step', notes: 'Notes', response: 'Response' };
  const row = {};
  Object.keys(allowed).forEach(function (k) {
    if (payload[k] === undefined) return;
    let v = String(payload[k]).trim();
    if (k === 'phone') v = _digits_(v);
    if (k === 'email') v = _normEmail_(v);
    if (k === 'response' && RESPONSES.indexOf(v) === -1) throw new Error('Unknown response: ' + v);
    row[allowed[k]] = v;
  });
  _updateRow_(TAB.PARTNERS, idx, row);
  return { ok: true };
}

/** Log a call (or a note) on a partner. */
function logPartnerEvent(id, kind, outcome, note) {
  const me = _requireRole_(WRITE_ROLES);
  if (['call', 'note'].indexOf(kind) === -1) throw new Error('Kind must be call or note.');
  const idx = _findRowIndex_(TAB.PARTNERS, function (p) { return String(p['ID']) === String(id); });
  if (idx === -1) throw new Error('Partner not found: ' + id);
  const now = new Date();
  _appendRows_(TAB.EVENTS, [{
    'ID': _nextId_(TAB.EVENTS), 'Partner ID': id, 'Home ID': '', 'Email ID': '',
    'Kind': kind, 'Outcome': String(outcome || ''), 'At': now, 'Snippet': String(note || ''), 'By': me.email, 'Needs Review': '',
  }]);
  if (kind === 'call') _updateRow_(TAB.PARTNERS, idx, { 'Last Contact': now });
  return { ok: true };
}

/** Mark a partner do-not-contact (or clear it). Cancels queued emails. */
function setPartnerDoNotContact(id, on, reason) {
  const me = _requireRole_(WRITE_ROLES);
  const idx = _findRowIndex_(TAB.PARTNERS, function (p) { return String(p['ID']) === String(id); });
  if (idx === -1) throw new Error('Partner not found: ' + id);
  _updateRow_(TAB.PARTNERS, idx, { 'Do Not Contact': on ? 'Yes' : '', 'Response': on ? 'Opted out' : '' });
  if (on) {
    _cancelQueuedEmails_(id);
    _appendRows_(TAB.EVENTS, [{
      'ID': _nextId_(TAB.EVENTS), 'Partner ID': id, 'Home ID': '', 'Email ID': '',
      'Kind': 'opt-out', 'Outcome': 'manual', 'At': new Date(), 'Snippet': String(reason || ''), 'By': me.email, 'Needs Review': '',
    }]);
  }
  return { ok: true };
}

/** Set of lowercase emails that must never be emailed: DNC partners plus the
 *  do_not_contact setting list (one per line or comma separated). */
function _doNotContactEmails_() {
  const out = {};
  _readTab_(TAB.PARTNERS).forEach(function (p) { if (_yes_(p['Do Not Contact'])) { const e = _normEmail_(p['Email']); if (e) out[e] = true; } });
  String(_setting_('do_not_contact') || '').split(/[\n,;]+/).forEach(function (e) { e = _normEmail_(e); if (e) out[e] = true; });
  return Object.keys(out);
}
