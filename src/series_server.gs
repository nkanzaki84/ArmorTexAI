// ============================================================
// Series campaigns (built 2026-11-25, Brian: "schedule newsletters or
// multiple emails to the same people … laid out on the calendar").
// A campaign of Kind = series goes to the warm and partner tiers only and
// is made of numbered steps, each its own email on its own calendar date.
// Steps live in the Versions tab (Letter = step number, Send On = date).
// Today sends whatever steps are due; a person still presses Send.
// Rules kept: street address + opt-out line on every step, no HTML,
// do-not-contact checked at the moment of sending. Links are allowed:
// these people know us. No follow-ups, no wording letters, no cooling-off.
// ============================================================

function _isSeries_(c) { return String(c['Kind'] || 'outreach') === 'series'; }

/** Tiers a series goes to (stored in the Stages column); always a subset of SERIES_TIERS. */
function _seriesTiers_(c) {
  const t = _csvList_(c['Stages']).filter(function (x) { return SERIES_TIERS.indexOf(x) !== -1; });
  return t.length ? t : SERIES_TIERS.slice();
}

/** A step must have a date, a subject, a body with the address and opt-out line, no HTML, and known fill-in words. */
function validateStep(v) {
  const problems = [];
  if (!v['Send On']) problems.push('No date.');
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
  if (/<[a-z][\s\S]*>/i.test(body)) problems.push('Body contains HTML.');
  const unknown = _unknownPlaceholders_(subject + '\n' + body);
  if (unknown.length) problems.push('Unknown fill-in word' + (unknown.length === 1 ? '' : 's') + ': ' + unknown.map(function (u) { return '{{' + u + '}}'; }).join(', ') + '.');
  return problems;
}

function _stepRows_(campaignId) {
  return _readTab_(TAB.VERSIONS).filter(function (v) { return String(v['Campaign ID']) === String(campaignId); })
    .sort(function (a, b) { return (parseInt(a['Letter'], 10) || 0) - (parseInt(b['Letter'], 10) || 0); });
}

/** The steps of a series with dates, counts and problems. Any role. */
function listSteps(campaignId) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const c = _campaignById_(campaignId);
  const isMember = _campaignMemberTest_(campaignId);
  const members = _readTab_(TAB.PARTNERS).filter(isMember).length;
  const sentBy = {};
  _readTab_(TAB.EMAILS).forEach(function (e) { if (String(e['Campaign ID']) === String(campaignId) && e['Sent At'] && e['Status'] !== 'cancelled') sentBy[String(e['Version'])] = (sentBy[String(e['Version'])] || 0) + 1; });
  return _stepRows_(campaignId).map(function (v) {
    const n = String(v['Letter']);
    return { n: n, sendOn: v['Send On'] ? _dateKey_(new Date(v['Send On'])) : '', subject: String(v['Subject'] || ''), body: String(v['Body'] || ''), locked: _yes_(v['Locked']), sent: sentBy[n] || 0, members: members, problems: validateStep(v) };
  });
}

function addStep(campaignId, payload) {
  _requireRole_(ADMIN_ROLES);
  const c = _campaignById_(campaignId);
  if (!_isSeries_(c)) throw new Error('Only a series has steps.');
  payload = payload || {};
  const rows = _stepRows_(campaignId);
  const n = String(rows.length ? Math.max.apply(null, rows.map(function (v) { return parseInt(v['Letter'], 10) || 0; })) + 1 : 1);
  _appendRows_(TAB.VERSIONS, [{ 'Letter': n, 'Channel': 'email', 'Partner Type': c['Partner Type'], 'Angle': 'Step ' + n, 'Subject': String(payload.subject || ''), 'Body': String(payload.body || ''), 'Follow Up Body': '', 'QR Code URL': '', 'Locked': '', 'Updated At': new Date(), 'Campaign ID': String(campaignId), 'Send On': payload.sendOn ? _parseLocalDate_(payload.sendOn) : '' }]);
  return { n: n };
}

function saveStep(campaignId, n, payload) {
  _requireRole_(ADMIN_ROLES);
  payload = payload || {};
  const idx = _findRowIndex_(TAB.VERSIONS, function (v) { return String(v['Campaign ID']) === String(campaignId) && String(v['Letter']) === String(n); });
  if (idx === -1) throw new Error('No step ' + n + '.');
  const row = _readTab_(TAB.VERSIONS)[idx - 2] || null;
  const cur = _stepRows_(campaignId).filter(function (v) { return String(v['Letter']) === String(n); })[0];
  if (cur && _yes_(cur['Locked'])) throw new Error('Step ' + n + ' already went out; it cannot be changed.');
  const upd = { 'Updated At': new Date() };
  if (payload.subject !== undefined) upd['Subject'] = String(payload.subject || '');
  if (payload.body !== undefined) upd['Body'] = String(payload.body || '');
  if (payload.sendOn !== undefined) upd['Send On'] = payload.sendOn ? _parseLocalDate_(payload.sendOn) : '';
  _updateRow_(TAB.VERSIONS, idx, upd);
  const v = _stepRows_(campaignId).filter(function (x) { return String(x['Letter']) === String(n); })[0];
  return { problems: validateStep(v) };
}

function removeStep(campaignId, n) {
  _requireRole_(ADMIN_ROLES);
  const cur = _stepRows_(campaignId).filter(function (v) { return String(v['Letter']) === String(n); })[0];
  if (!cur) throw new Error('No step ' + n + '.');
  if (_yes_(cur['Locked'])) throw new Error('Step ' + n + ' already went out; it stays for the record.');
  const idx = _findRowIndex_(TAB.VERSIONS, function (v) { return String(v['Campaign ID']) === String(campaignId) && String(v['Letter']) === String(n); });
  _getTab_(TAB.VERSIONS).deleteRow(idx);
  return { ok: true };
}

/**
 * What a series owes today: every step dated today or earlier, to every member
 * who has not had it yet (and is still reachable). Items carry the step row.
 */
function _seriesDue_(c, partners, emails, now, dnc) {
  const cid = String(c['ID']);
  const todayKey = _dateKey_(now);
  const isMember = _campaignMemberTest_(cid);
  const had = {};
  emails.forEach(function (e) { if (String(e['Campaign ID']) === cid && e['Status'] !== 'cancelled' && e['Sent At']) had[String(e['Partner ID']) + '|' + String(e['Version'])] = true; });
  const items = [];
  _stepRows_(cid).forEach(function (v) {
    if (!v['Send On'] || _dateKey_(new Date(v['Send On'])) > todayKey) return;
    partners.forEach(function (p) {
      if (!isMember(p) || had[String(p['ID']) + '|' + String(v['Letter'])]) return;
      if (_yes_(p['Do Not Contact']) || dnc[_normEmail_(p['Email'])] || !_normEmail_(p['Email'])) return;
      if (SERIES_TIERS.indexOf(_tierOf_(p)) === -1) return;   // gone cold since joining: not a series person any more
      const o = Object.assign({ campaignId: cid, step: String(v['Letter']), stepRow: v }, p);
      Object.defineProperty(o, '_row', { value: p._row, enumerable: false });
      items.push(o);
    });
  });
  return items;
}
