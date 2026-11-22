/**
 * ArmorTex Outreach — partners.gs
 * Partner import, version assignment, partner list and record.
 */

// ============================================================
// Import (Automation 1)
// ============================================================

// Accepted header spellings → our column. Matching is case/space-insensitive.
const PARTNER_IMPORT_ALIASES = {
  'name': 'Name', 'full name': 'Name', 'agent': 'Name', 'agent name': 'Name', 'contact': 'Name', 'realtor name': 'Name', 'realtor': 'Name', 'contact name': 'Name',
  'first name': '_first', 'first': '_first', 'last name': '_last', 'last': '_last',
  'email': 'Email', 'e-mail': 'Email', 'email address': 'Email',
  'phone': 'Phone', 'mobile': 'Phone', 'cell': 'Phone', 'phone number': 'Phone',
  'call notes': '_callNotes',
  'company': 'Company', 'brokerage': 'Company', 'office': 'Company', 'firm': 'Company', 'agency': 'Company',
  'area': 'Area', 'city': 'Area', 'market': 'Area', 'territory': 'Area', 'market area': 'Area',
  'status': '_status',   // "Active Partner" on a row → that row goes straight into the book
  'type': 'Type', 'partner type': 'Type',
  'notes': 'Notes',
};

/**
 * Import partners from CSV text. Skips rows with no email, duplicate emails
 * (within the file and against existing Partners), and emails on the
 * do-not-contact list. New rows start at stage Prospect with no version.
 *
 * @param {string} csvText
 * @param {{type?: string, sourceList?: string, established?: boolean, rep?: string, handSentToCalls?: boolean}} opts
 *        type: default 'realtor'
 *        established: existing relationships → Partners book (Stage Partner, Partner Since = now), never the email test
 *        rep: staff email to own every imported row
 *        handSentToCalls (default true for prospects): rows whose Notes say "sent …" were already emailed by hand →
 *        Stage Contacted, Last Contact = that date, Skip Email Test, Call Queue
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
  const seenPhone = {};
  const dnc = {};
  existing.forEach(function (p) {
    const e = _normEmail_(p['Email']);
    if (e) seen[e] = true;
    const ph = _digits_(p['Phone']);
    if (ph) seenPhone[ph] = true;
    if (e && _yes_(p['Do Not Contact'])) dnc[e] = true;
  });
  _doNotContactEmails_().forEach(function (e) { dnc[e] = true; });

  const skipped = { noEmail: 0, duplicate: 0, doNotContact: 0, phoneOnly: 0, established: 0 };
  const rows = [];
  const now = new Date();
  const established = !!opts.established;
  const rep = _normEmail_(opts.rep || '');
  if (rep && !_isStaffEmail_(rep)) throw new Error('Not on the team: ' + rep);
  const handSent = opts.handSentToCalls === undefined ? !established : !!opts.handSentToCalls;
  let queued = 0;
  parsed.rows.forEach(function (r) {
    const email = _normEmail_(r.Email);
    const phone = _digits_(r.Phone);
    const hasEmail = !!email && email.indexOf('@') !== -1;
    if (!hasEmail && !phone) { skipped.noEmail++; return; }            // nothing to reach them by
    if (hasEmail && dnc[email]) { skipped.doNotContact++; return; }
    if (hasEmail && seen[email]) { skipped.duplicate++; return; }
    if (!hasEmail && seenPhone[phone]) { skipped.duplicate++; return; }
    if (hasEmail) seen[email] = true;
    if (phone) seenPhone[phone] = true;
    if (!hasEmail) skipped.phoneOnly = (skipped.phoneOnly || 0) + 1;    // kept, but the email test will skip them
    const rowEstablished = established || !!r._established;   // the file's own Status column can say "Active Partner"
    const hs = (handSent && !rowEstablished) ? _handSentDate_(r.Notes, now) : null;
    if (hs) queued++;
    rows.push({
      'Rep': rep,
      'Skip Email Test': hs ? 'Yes' : '',
      'Call Queue': hs ? 'Yes' : '',
      'Name': r.Name || (hasEmail ? email.split('@')[0] : phone),
      'Type': (r.Type && PARTNER_TYPES.indexOf(String(r.Type).toLowerCase()) !== -1) ? String(r.Type).toLowerCase() : type,
      'Company': r.Company || '',
      'Phone': _digits_(r.Phone),
      'Email': hasEmail ? email : '',
      'Area': r.Area || '',
      'Stage': rowEstablished ? 'Partner' : (hs ? 'Contacted' : 'Prospect'),
      'Version': '',
      'Response': '',
      'Do Not Contact': '',
      'Last Contact': hs ? hs : '',
      'Next Step': '',
      'Notes': r.Notes || '',
      'Source List': opts.sourceList || ('import ' + _dateKey_(now)),
      'Added At': now,
      'Added By': me.email,
      'Partner Since': rowEstablished ? now : '',
    });
    if (rowEstablished) skipped.established = (skipped.established || 0) + 1;
  });
  const ids = _nextId_(TAB.PARTNERS, rows.length);
  rows.forEach(function (row, i) { row['ID'] = ids[i]; });
  _appendRows_(TAB.PARTNERS, rows);
  return { added: rows.length, skipped: skipped, columns: parsed.columns, queuedForCalls: queued, rep: rep };
}

/** "sent 11/3" → a Date (this year, or last year if that would be in the future); "sent" alone → `now`. null if not hand-sent. */
function _handSentDate_(notes, now) {
  const m = HAND_SENT_RE.exec(String(notes || ''));
  if (!m) return null;
  if (!m[1]) return new Date(now.getTime());
  let y = m[3] ? Number(m[3]) : now.getFullYear();
  if (y < 100) y += 2000;
  let d = new Date(y, Number(m[1]) - 1, Number(m[2]));
  if (!m[3] && d.getTime() > now.getTime() + 86400000) d = new Date(y - 1, Number(m[1]) - 1, Number(m[2]));
  return isNaN(d.getTime()) ? new Date(now.getTime()) : d;
}

function _isStaffEmail_(email) {
  email = _normEmail_(email);
  if (!email) return false;
  if (email === _normEmail_(OWNER_EMAIL)) return true;
  return _readTab_(TAB.USERS).some(function (u) { return _normEmail_(u['Email']) === email && String(u['Active'] || 'Yes').toLowerCase() !== 'no'; });
}

/** Distinct import lists, newest first, with counts. */
function listSourceLists() {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const c = {};
  _readTab_(TAB.PARTNERS).forEach(function (p) { const k = String(p['Source List'] || '').trim() || '(none)'; c[k] = (c[k] || 0) + 1; });
  return Object.keys(c).map(function (k) { return { sourceList: k, count: c[k] }; }).sort(function (a, b) { return b.count - a.count; });
}

/** Give every partner in an import list to a rep (blank = unassign). Owner only. */
function assignRepToList(sourceList, rep) {
  _requireRole_(ADMIN_ROLES);
  rep = _normEmail_(rep || '');
  if (rep && !_isStaffEmail_(rep)) throw new Error('Not on the team: ' + rep);
  const updates = _readTab_(TAB.PARTNERS)
    .filter(function (p) { return String(p['Source List'] || '').trim() === String(sourceList).trim(); })
    .map(function (p) { return { rowIndex: p._row, row: { 'Rep': rep } }; });
  _updateRows_(TAB.PARTNERS, updates);
  return { updated: updates.length };
}

/** Retrofit the hand-sent rule on an already-imported list. Owner only. */
function applyHandSentRule(sourceList) {
  _requireRole_(ADMIN_ROLES);
  const now = new Date();
  const updates = [];
  _readTab_(TAB.PARTNERS).forEach(function (p) {
    if (String(p['Source List'] || '').trim() !== String(sourceList).trim()) return;
    if (String(p['Stage']) === 'Partner' || p['Partner Since']) return;
    const d = _handSentDate_(p['Notes'], now);
    if (!d) return;
    updates.push({ rowIndex: p._row, row: { 'Skip Email Test': 'Yes', 'Call Queue': 'Yes', 'Stage': p['Stage'] === 'Prospect' ? 'Contacted' : p['Stage'], 'Last Contact': p['Last Contact'] || d } });
  });
  _updateRows_(TAB.PARTNERS, updates);
  // anything queued must leave the email test, even if a version was already dealt
  const cancelled = updates.map(function (u) { return _readTab_(TAB.PARTNERS).filter(function (p) { return p._row === u.rowIndex; })[0]; })
    .filter(Boolean).reduce(function (n, p) { return n + _cancelQueuedEmails_(p['ID']); }, 0);
  return { updated: updates.length, cancelledEmails: cancelled };
}

/** Put a partner on (or take them off) the call list by hand. */
function setCallQueue(id, on) {
  _requireRole_(WRITE_ROLES);
  const p = _byId_(TAB.PARTNERS, id);
  if (!p) throw new Error('Partner not found: ' + id);
  _updateRow_(TAB.PARTNERS, p._row, { 'Call Queue': on ? 'Yes' : '' });
  return { ok: true };
}

/**
 * CSV → { columns:[mapped names], rows:[{Name, Email, …}] }
 * The header row is the first row (within the first 25) with at least two
 * recognised column names, so a title block or summary rows above it are
 * ignored, as are leading empty columns.
 */
function _parsePartnerCsv_(csvText) {
  const table = Utilities.parseCsv(String(csvText || '').replace(/^\uFEFF/, ''));
  if (!table.length) return { columns: [], rows: [] };
  const norm = function (h) { return String(h || '').trim().toLowerCase().replace(/\s+/g, ' '); };
  let headerRow = -1, map = null;
  for (let r = 0; r < Math.min(table.length, 25); r++) {
    const m = table[r].map(function (h) { return PARTNER_IMPORT_ALIASES[norm(h)] || null; });
    if (m.filter(Boolean).length >= 2) { headerRow = r; map = m; break; }
  }
  if (headerRow === -1) throw new Error('No header row found. The sheet needs a row with column names like Name, Email, Phone, Brokerage.');
  const rows = [];
  for (let i = headerRow + 1; i < table.length; i++) {
    const line = table[i];
    if (!line.some(function (c) { return String(c).trim() !== ''; })) continue;
    const r = {};
    map.forEach(function (col, j) { if (col) r[col] = String(line[j] === undefined ? '' : line[j]).trim(); });
    if (!r.Name && (r._first || r._last)) r.Name = [r._first, r._last].filter(Boolean).join(' ');
    delete r._first; delete r._last;
    if (r._callNotes) { r.Notes = [r.Notes, r._callNotes].filter(Boolean).join(' · '); delete r._callNotes; }
    r._established = /partner/i.test(String(r._status || '')) && !/prospect/i.test(String(r._status || ''));
    delete r._status;
    // "Sherry Watson (Crown Jewel Realty Team)" → name + a note
    const paren = String(r.Name || '').match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (paren) { r.Name = paren[1].trim(); r.Notes = [paren[2].trim(), r.Notes].filter(Boolean).join(' · '); }
    // two addresses in one cell → the first one
    if (r.Email && /[;,\s]/.test(String(r.Email).trim())) r.Email = String(r.Email).split(/[;,\s]+/).filter(Boolean)[0];
    rows.push(r);
  }
  return { columns: map.filter(function (c) { return c && c[0] !== '_'; }), rows: rows };
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
    return String(p['Type']).toLowerCase() === type && !String(p['Version'] || '').trim() && !_yes_(p['Do Not Contact'])
      && String(p['Stage']) !== 'Partner' && !p['Partner Since']    // established partners are never in the email test
      && !_yes_(p['Skip Email Test']);                              // nor anyone already emailed by hand
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

/** Per-partner relationship numbers from Referrals + Events, in one pass. */
function _partnerMetricsMap_() {
  const m = {};
  const get = function (id) { return m[id] || (m[id] = { referralsIn: 0, reportsSent: 0, jobsSigned: 0, jobValue: 0, calls: 0, lastTouch: '' }); };
  _readTab_(TAB.REFERRALS).forEach(function (r) {
    if (r['Direction'] !== 'in') return;
    const x = get(r['Partner ID']);
    x.referralsIn++;
    if (r['Report Sent At']) x.reportsSent++;
    if (String(r['Signed Or Lost']).toLowerCase() === 'signed') { x.jobsSigned++; x.jobValue += Number(r['Contract Amount']) || Number(r['Job Value']) || 0; }
  });
  _readTab_(TAB.EVENTS).forEach(function (ev) {
    if (ev['Kind'] !== 'call' && ev['Kind'] !== 'reply' && ev['Kind'] !== 'note') return;
    const x = get(ev['Partner ID']);
    if (ev['Kind'] === 'call') x.calls++;
    if (String(ev['At']) > String(x.lastTouch)) x.lastTouch = String(ev['At']);
  });
  return m;
}

/**
 * @param {{section?:'marketing'|'partners', type?:string, stage?:string, version?:string, response?:string, q?:string, includeDnc?:boolean, rep?:string}} filters
 *   section 'marketing' = not yet a Partner; 'partners' = Stage Partner. rep 'mine' = the signed-in user's or unassigned.
 *   Rows carry `metrics` and `daysSinceContact`.
 */
function listPartners(filters) {
  const session = _requireRole_(ROLES.map(function (r) { return r.key; }));
  filters = filters || {};
  const repFilter = filters.rep === 'mine' ? session.email : _normEmail_(filters.rep || '');
  const q = String(filters.q || '').trim().toLowerCase();
  const metrics = _partnerMetricsMap_();
  const now = Date.now();
  return _readTab_(TAB.PARTNERS).filter(function (p) {
    if (filters.section === 'marketing' && String(p['Stage']) === 'Partner') return false;
    if (filters.section === 'partners' && String(p['Stage']) !== 'Partner') return false;
    if (repFilter) { const r = _normEmail_(p['Rep']); if (r !== repFilter && !(filters.rep === 'mine' && !r)) return false; }
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
  }).map(function (p) {
    const m = metrics[p['ID']] || { referralsIn: 0, reportsSent: 0, jobsSigned: 0, jobValue: 0, calls: 0, lastTouch: '' };
    const last = p['Last Contact'] || m.lastTouch;
    const days = last ? Math.floor((now - new Date(last).getTime()) / 86400000) : null;
    const o = Object.assign({}, p, { metrics: m, daysSinceContact: isNaN(days) ? null : days, cold: days !== null && !isNaN(days) && days >= PARTNER_TOUCH_DAYS });
    Object.defineProperty(o, '_row', { value: p._row, enumerable: false });
    return o;
  });
}

/** Move a prospect into the Partners book by hand (sets the type's win response). */
function markAsPartner(id) {
  _requireRole_(WRITE_ROLES);
  const p = _byId_(TAB.PARTNERS, id);
  if (!p) throw new Error('Partner not found: ' + id);
  _updateRow_(TAB.PARTNERS, p._row, { 'Stage': 'Partner', 'Partner Since': p['Partner Since'] || new Date() });
  return { ok: true };
}

/** Send an established partner back to the marketing pipeline (rare; e.g. marked by mistake). */
function unmarkPartner(id) {
  _requireRole_(WRITE_ROLES);
  const p = _byId_(TAB.PARTNERS, id);
  if (!p) throw new Error('Partner not found: ' + id);
  _updateRow_(TAB.PARTNERS, p._row, { 'Response': p['Response'] && WIN_RESPONSES.indexOf(String(p['Response'])) !== -1 ? 'Replied' : p['Response'], 'Stage': 'Replied', 'Partner Since': '' });
  return { ok: true };
}

function getPartner(id) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const p = _byId_(TAB.PARTNERS, id);
  if (!p) throw new Error('Partner not found: ' + id);
  const emails = _readTab_(TAB.EMAILS).filter(function (e) { return String(e['Partner ID']) === String(id); });
  const events = _readTab_(TAB.EVENTS).filter(function (e) { return String(e['Partner ID']) === String(id); });
  const referrals = _readTab_(TAB.REFERRALS).filter(function (r) { return String(r['Partner ID']) === String(id); });
  const inRefs = referrals.filter(function (r) { return r['Direction'] === 'in'; });
  const metrics = {
    emailsSent: emails.filter(function (e) { return e['Sent At'] && e['Status'] !== 'cancelled'; }).length,
    replies: events.filter(function (e) { return e['Kind'] === 'reply'; }).length,
    calls: events.filter(function (e) { return e['Kind'] === 'call'; }).length,
    talked: events.filter(function (e) { return e['Kind'] === 'call' && String(e['Outcome']).toLowerCase() === 'talked'; }).length,
    texts: events.filter(function (e) { return e['Kind'] === 'text'; }).length,
    referralsIn: inRefs.length,
    referralsOut: referrals.length - inRefs.length,
    reportsSent: inRefs.filter(function (r) { return r['Report Sent At']; }).length,
    jobsSigned: inRefs.filter(function (r) { return String(r['Signed Or Lost']).toLowerCase() === 'signed'; }).length,
    jobValue: inRefs.reduce(function (sum, r) { return sum + (Number(r['Contract Amount']) || Number(r['Job Value']) || 0); }, 0),
    won: WIN_RESPONSES.indexOf(String(p['Response'])) !== -1 || inRefs.length > 0,
  };
  return { partner: p, emails: emails, events: events, referrals: referrals, metrics: metrics, profile: PARTNER_TYPE_PROFILES[String(p['Type'])] || null };
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
    'Rep': payload.rep !== undefined ? _normEmail_(payload.rep) : (me.role === 'sales' ? me.email : ''),
  };
  if (row['Rep'] && !_isStaffEmail_(row['Rep'])) throw new Error('Not on the team: ' + row['Rep']);
  if (!row['Name']) throw new Error('Name is required.');
  _appendRows_(TAB.PARTNERS, [row]);
  return row['ID'];
}

/** Every profile column across all types (header names). */
function _profileColumns_() {
  const out = {};
  Object.keys(PARTNER_TYPE_PROFILES).forEach(function (t) { PARTNER_TYPE_PROFILES[t].fields.forEach(function (f) { out[f.key] = f; }); });
  return out;
}

/**
 * Update the editable fields of a partner (never Version, never Stage).
 * payload keys: name, company, phone, email, area, nextStep, notes, response,
 * plus profile fields by header name under payload.profile = { 'Doors Managed': 120 }.
 */
function savePartner(id, payload) {
  _requireRole_(WRITE_ROLES);
  payload = payload || {};
  const idx = _findRowIndex_(TAB.PARTNERS, function (p) { return String(p['ID']) === String(id); });
  if (idx === -1) throw new Error('Partner not found: ' + id);
  const allowed = { name: 'Name', company: 'Company', phone: 'Phone', email: 'Email', area: 'Area', nextStep: 'Next Step', notes: 'Notes', response: 'Response', rep: 'Rep' };
  const row = {};
  Object.keys(allowed).forEach(function (k) {
    if (payload[k] === undefined) return;
    let v = String(payload[k]).trim();
    if (k === 'phone') v = _digits_(v);
    if (k === 'email') v = _normEmail_(v);
    if (k === 'rep') { v = _normEmail_(v); if (v && !_isStaffEmail_(v)) throw new Error('Not on the team: ' + v); }
    if (k === 'response' && RESPONSES.indexOf(v) === -1) throw new Error('Unknown response: ' + v);
    row[allowed[k]] = v;
  });
  if (payload.callQueue !== undefined) row['Call Queue'] = payload.callQueue ? 'Yes' : '';
  if (payload.profile) {
    const cols = _profileColumns_();
    Object.keys(payload.profile).forEach(function (h) {
      const f = cols[h];
      if (!f) throw new Error('Unknown profile field: ' + h);
      let v = String(payload.profile[h] === null || payload.profile[h] === undefined ? '' : payload.profile[h]).trim();
      if (f.type === 'number' || f.type === 'money') {
        v = v.replace(/[$,\s]/g, '');
        if (v !== '' && isNaN(Number(v))) throw new Error(h + ' must be a number.');
        v = v === '' ? '' : Number(v);
      }
      if (f.type === 'choice' && f.options.indexOf(v) === -1) throw new Error(h + ' must be one of: ' + f.options.filter(Boolean).join(', '));
      row[h] = v;
    });
  }
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
