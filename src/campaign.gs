/**
 * ArmorTex Outreach — campaign.gs
 * Versions, the daily batch, stats, and the rules the app enforces.
 * (Actual sending and the reply-check trigger live in emails.gs — v1 next.)
 */

// ============================================================
// Versions
// ============================================================

function listVersions() {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  return _readTab_(TAB.VERSIONS);
}

/** Edit a version. Refused once it is locked (sending has started). */
function saveVersion(letter, payload) {
  _requireRole_(ADMIN_ROLES);
  const idx = _findRowIndex_(TAB.VERSIONS, function (v) { return String(v['Letter']) === String(letter); });
  const existing = idx === -1 ? null : _readTab_(TAB.VERSIONS).filter(function (v) { return v._row === idx; })[0];
  if (existing && _yes_(existing['Locked'])) throw new Error('Version ' + letter + ' is locked because sending has started.');
  const row = {
    'Letter': String(letter).trim(),
    'Channel': String(payload.channel || (existing && existing['Channel']) || 'email'),
    'Partner Type': String(payload.partnerType || (existing && existing['Partner Type']) || 'realtor'),
    'Angle': String(payload.angle || ''),
    'Subject': String(payload.subject || ''),
    'Body': String(payload.body || ''),
    'Follow Up Body': String(payload.followUpBody || ''),
    'Updated At': new Date(),
  };
  if (idx === -1) { row['Locked'] = ''; _appendRows_(TAB.VERSIONS, [row]); }
  else _updateRow_(TAB.VERSIONS, idx, row);
  return { ok: true, problems: validateVersion(row) };
}

/**
 * Rules every EMAIL version must pass before it can be sent:
 *   - subject and body present
 *   - body contains the business street address (setting) and the opt-out line (setting)
 *   - first email is plain text: no links, no images, no HTML
 *   - body ends by asking for a reply (a question mark in the last 200 chars)
 * Returns an array of problem strings; empty = ok.
 */
function validateVersion(v) {
  const problems = [];
  if (String(v['Channel'] || 'email') !== 'email') return problems;
  const subject = String(v['Subject'] || '').trim();
  const body = String(v['Body'] || '');
  const lower = body.toLowerCase();
  if (!subject) problems.push('No subject.');
  if (!body.trim()) problems.push('No body.');
  const addr = String(_setting_(SETTING.BUSINESS_ADDRESS) || '').trim();
  if (!addr) problems.push('Business address setting is empty (Settings).');
  else if (lower.indexOf(addr.toLowerCase()) === -1) problems.push('Body does not contain the business address.');
  const optOut = String(_setting_(SETTING.OPT_OUT_LINE) || '').trim();
  if (!optOut) problems.push('Opt-out line setting is empty (Settings).');
  else if (lower.indexOf(optOut.toLowerCase()) === -1) problems.push('Body does not contain the opt-out line.');
  if (/https?:\/\/|www\./i.test(body)) problems.push('Body contains a link (first email must have none).');
  if (/<[a-z][\s\S]*>/i.test(body)) problems.push('Body contains HTML.');
  if (!/\?/.test(body.slice(-200))) problems.push('Body should end by asking for a reply.');
  return problems;
}

function _lockVersion_(letter) {
  const idx = _findRowIndex_(TAB.VERSIONS, function (v) { return String(v['Letter']) === String(letter); });
  if (idx !== -1) _updateRow_(TAB.VERSIONS, idx, { 'Locked': 'Yes' });
}

// ============================================================
// Daily batch (Automation 3)
// ============================================================

/**
 * Who gets emailed today. Pure selection — nothing is written.
 *   - only on sending days, unless opts.force
 *   - up to daily_cap minus what has already been sent today
 *   - due follow-ups first (they are already queued in Emails), then new
 *     first emails spread evenly across versions
 *   - never anyone on do-not-contact, never anyone already emailed
 *
 * @param {{now?: Date, force?: boolean}} opts
 * @return {{sendingDay:boolean, paused:boolean, cap:number, sentToday:number,
 *           room:number, followUps:Object[], firsts:Object[], problems:string[]}}
 */
function buildTodayBatch(opts) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  opts = opts || {};
  const now = opts.now || new Date();
  const s = _settings_();
  const cap = Math.max(0, parseInt(s[SETTING.DAILY_CAP], 10) || 0);
  const days = String(s[SETTING.SENDING_DAYS] || '').split(',').map(function (d) { return d.trim().slice(0, 3).toLowerCase(); }).filter(Boolean);
  const sendingDay = days.indexOf(_weekday_(now).toLowerCase()) !== -1;
  const paused = _yes_(s[SETTING.PAUSE_SENDING]);
  const todayKey = _dateKey_(now);

  const emails = _readTab_(TAB.EMAILS);
  const sentToday = emails.filter(function (e) { return e['Status'] !== 'cancelled' && e['Sent At'] && _dateKey_(new Date(e['Sent At'])) === todayKey; }).length;
  const room = Math.max(0, cap - sentToday);

  const dnc = {};
  _doNotContactEmails_().forEach(function (e) { dnc[e] = true; });
  const partners = _readTab_(TAB.PARTNERS);
  const byId = {};
  partners.forEach(function (p) { byId[p['ID']] = p; });

  // Follow-ups already queued and due.
  const followUps = emails.filter(function (e) {
    if (e['Status'] !== 'queued' || e['Step'] !== 'followup') return false;
    if (e['Scheduled For'] && _dateKey_(new Date(e['Scheduled For'])) > todayKey) return false;
    const p = byId[e['Partner ID']];
    return p && !dnc[_normEmail_(p['Email'])] && !_yes_(p['Do Not Contact']);
  }).map(function (e) { return Object.assign({ partner: byId[e['Partner ID']] }, e); });

  // First emails: partners with a version, no email ever, not DNC.
  const emailed = {};
  emails.forEach(function (e) { if (e['Status'] !== 'cancelled') emailed[e['Partner ID']] = true; });
  const candidates = partners.filter(function (p) {
    return String(p['Version'] || '').trim() && !emailed[p['ID']] && !_yes_(p['Do Not Contact']) && !dnc[_normEmail_(p['Email'])] && _normEmail_(p['Email']);
  });
  // Round-robin across versions so each day's batch is balanced.
  const buckets = {};
  EMAIL_VERSIONS.forEach(function (v) { buckets[v] = []; });
  candidates.forEach(function (p) { (buckets[p['Version']] = buckets[p['Version']] || []).push(p); });
  const versions = Object.keys(buckets).filter(function (v) { return buckets[v].length; });
  const firsts = [];
  const firstRoom = Math.max(0, room - followUps.length);
  let i = 0;
  while (firsts.length < firstRoom && versions.some(function (v) { return buckets[v].length; })) {
    const v = versions[i % versions.length];
    if (buckets[v].length) firsts.push(buckets[v].shift());
    i++;
  }

  const problems = [];
  if (paused) problems.push('Sending is paused (Settings).');
  if (!sendingDay && !opts.force) problems.push('Today (' + _weekday_(now) + ') is not a sending day (' + s[SETTING.SENDING_DAYS] + ').');
  const versionRows = _readTab_(TAB.VERSIONS);
  const needed = {};
  firsts.forEach(function (p) { needed[p['Version']] = true; });
  Object.keys(needed).forEach(function (letter) {
    const v = versionRows.filter(function (r) { return String(r['Letter']) === letter; })[0];
    if (!v) { problems.push('Version ' + letter + ' does not exist.'); return; }
    validateVersion(v).forEach(function (pr) { problems.push('Version ' + letter + ': ' + pr); });
  });

  return {
    date: todayKey, weekday: _weekday_(now), sendingDay: sendingDay, paused: paused,
    cap: cap, sentToday: sentToday, room: room,
    followUps: followUps.slice(0, room), firsts: firsts, problems: problems,
  };
}

/** Cancel queued (unsent) emails for a partner — used by opt-out and reply. */
function _cancelQueuedEmails_(partnerId) {
  const updates = _readTab_(TAB.EMAILS)
    .filter(function (e) { return String(e['Partner ID']) === String(partnerId) && e['Status'] === 'queued'; })
    .map(function (e) { return { rowIndex: e._row, row: { 'Status': 'cancelled' } }; });
  _updateRows_(TAB.EMAILS, updates);
  return updates.length;
}

// ============================================================
// Stats (Automation 9) — always recounted from Emails + Events
// ============================================================

/**
 * Per-version table for the Campaign screen. Counts sit beside every rate.
 * @return {{rows:Object[], note:string}}
 */
function getCampaignStats() {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const partners = _readTab_(TAB.PARTNERS);
  const emails = _readTab_(TAB.EMAILS);
  const events = _readTab_(TAB.EVENTS);
  const referrals = _readTab_(TAB.REFERRALS);
  const versionOf = {};
  partners.forEach(function (p) { versionOf[p['ID']] = String(p['Version'] || ''); });

  const rows = {};
  function row(v) {
    if (!rows[v]) rows[v] = { version: v, assigned: 0, sent: 0, followUps: 0, bounced: 0, replied: 0, talked: 0, addresses: 0, optedOut: 0, referrals: 0, reportsSent: 0, estimates: 0, signed: 0, paid: 0 };
    return rows[v];
  }
  partners.forEach(function (p) { const v = versionOf[p['ID']]; if (v) row(v).assigned++; });
  const repliedPartners = {};
  const talkedPartners = {};
  emails.forEach(function (e) {
    const v = String(e['Version'] || versionOf[e['Partner ID']] || '');
    if (!v) return;
    if (e['Sent At'] && e['Status'] !== 'cancelled') { if (e['Step'] === 'followup') row(v).followUps++; else row(v).sent++; }
    if (e['Status'] === 'bounced') row(v).bounced++;
  });
  events.forEach(function (ev) {
    const v = versionOf[ev['Partner ID']];
    if (!v) return;
    if (ev['Kind'] === 'reply' && !repliedPartners[ev['Partner ID']]) { repliedPartners[ev['Partner ID']] = true; row(v).replied++; }
    if (ev['Kind'] === 'opt-out') row(v).optedOut++;
    if (ev['Kind'] === 'call' && String(ev['Outcome']).toLowerCase() === 'talked' && !talkedPartners[ev['Partner ID']]) { talkedPartners[ev['Partner ID']] = true; row(v).talked++; }
  });
  partners.forEach(function (p) { if (p['Response'] === 'Sent an address' && versionOf[p['ID']]) row(versionOf[p['ID']]).addresses++; });
  referrals.forEach(function (r) {
    const v = versionOf[r['Partner ID']];
    if (!v || r['Direction'] !== 'in') return;
    row(v).referrals++;
    if (r['Report Sent At']) row(v).reportsSent++;
    if (r['Estimate Started At']) row(v).estimates++;
    if (String(r['Signed Or Lost']).toLowerCase() === 'signed') row(v).signed++;
    if (r['Paid At']) row(v).paid++;
  });

  const out = EMAIL_VERSIONS.concat(Object.keys(rows).filter(function (v) { return EMAIL_VERSIONS.indexOf(v) === -1; }))
    .filter(function (v) { return rows[v]; })
    .map(function (v) {
      const r = rows[v];
      r.replyRate = r.sent ? r.replied / r.sent : 0;
      r.addressRate = r.sent ? r.addresses / r.sent : 0;
      return r;
    });
  return { rows: out, note: 'About 125 realtors per version is too few to trust a small gap. Look for big differences, not small ones.' };
}

/** Recompute cached Stage / Response on every partner from Emails + Events. */
function recountPartnerStages() {
  _requireRole_(WRITE_ROLES);
  const partners = _readTab_(TAB.PARTNERS);
  const emails = _readTab_(TAB.EMAILS);
  const events = _readTab_(TAB.EVENTS);
  const referrals = _readTab_(TAB.REFERRALS);
  const sent = {}, replied = {}, bounced = {}, optedOut = {}, partnerOf = {}, lastContact = {};
  emails.forEach(function (e) {
    if (e['Sent At'] && e['Status'] !== 'cancelled') { sent[e['Partner ID']] = true; _maxDate_(lastContact, e['Partner ID'], e['Sent At']); }
    if (e['Status'] === 'bounced') bounced[e['Partner ID']] = true;
  });
  events.forEach(function (ev) {
    if (ev['Kind'] === 'reply') { replied[ev['Partner ID']] = true; _maxDate_(lastContact, ev['Partner ID'], ev['At']); }
    if (ev['Kind'] === 'opt-out' && !_yes_(ev['Needs Review'])) optedOut[ev['Partner ID']] = true;
    if (ev['Kind'] === 'call') _maxDate_(lastContact, ev['Partner ID'], ev['At']);
  });
  referrals.forEach(function (r) { if (r['Direction'] === 'in') partnerOf[r['Partner ID']] = true; });
  const updates = [];
  partners.forEach(function (p) {
    const id = p['ID'];
    let stage = 'Prospect';
    if (sent[id]) stage = 'Contacted';
    if (replied[id]) stage = 'Replied';
    if (partnerOf[id]) stage = 'Partner';
    let response = String(p['Response'] || '');
    if (optedOut[id] || _yes_(p['Do Not Contact'])) response = 'Opted out';
    else if (bounced[id]) response = 'Bounced';
    else if (replied[id] && !response) response = 'Replied';
    const row = { 'Stage': stage, 'Response': response };
    if (lastContact[id]) row['Last Contact'] = lastContact[id];
    if (row['Stage'] !== p['Stage'] || row['Response'] !== p['Response'] || (row['Last Contact'] && row['Last Contact'].toISOString() !== p['Last Contact'])) {
      updates.push({ rowIndex: p._row, row: row });
    }
  });
  _updateRows_(TAB.PARTNERS, updates);
  return { updated: updates.length };
}

function _maxDate_(map, key, v) {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return;
  if (!map[key] || map[key] < d) map[key] = d;
}

// ============================================================
// Settings page
// ============================================================

/** How many more recipients this mailbox may send today (Google's quota). */
function getRemainingQuota() {
  _requireRole_(ADMIN_ROLES);
  try { return MailApp.getRemainingDailyQuota(); } catch (err) { return null; }
}

function getSettings() {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  return _settings_();
}

function saveSettings(map) {
  _requireRole_(ADMIN_ROLES);
  const known = Object.keys(SETTING).map(function (k) { return SETTING[k]; });
  Object.keys(map || {}).forEach(function (k) {
    if (known.indexOf(k) === -1) throw new Error('Unknown setting: ' + k);
    let v = String(map[k]);
    if (k === SETTING.DAILY_CAP) {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0) throw new Error('Daily cap must be a whole number.');
      // Never above what Google allows this mailbox today (consumer 100, Workspace 1,500).
      let remaining = null;
      try { remaining = MailApp.getRemainingDailyQuota(); } catch (err) { remaining = null; }
      if (remaining !== null && n > remaining) throw new Error('Daily cap ' + n + ' is above what this mailbox can send today (' + remaining + '). Keep it under the Gmail limit.');
      v = String(n);
    }
    _setSetting_(k, v);
  });
  return { ok: true };
}
