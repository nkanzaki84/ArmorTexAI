/**
 * ArmorTex Outreach — campaign.gs
 * Versions, the daily batch, stats, and the rules the app enforces.
 * (Actual sending and the reply-check trigger live in emails.gs — v1 next.)
 */

// ============================================================
// Versions
// ============================================================

/** The letters of one campaign (the first campaign when none is named). */
function listVersions(campaignId) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const id = String(campaignId || _defaultCampaignId_());
  return _readTab_(TAB.VERSIONS).filter(function (v) { return String(v['Campaign ID']) === id; });
}

/** A campaign's wording for one letter, or null. */
function _versionFor_(campaignId, letter) {
  const id = String(campaignId || '');
  return _readTab_(TAB.VERSIONS).filter(function (v) { return String(v['Campaign ID']) === id && String(v['Letter']) === String(letter); })[0] || null;
}

/** Edit a version. Refused once it is locked (sending has started). */
function saveVersion(letter, payload, campaignId) {
  _requireRole_(ADMIN_ROLES);
  const cid = String(campaignId || _defaultCampaignId_());
  const idx = _findRowIndex_(TAB.VERSIONS, function (v) { return String(v['Letter']) === String(letter) && String(v['Campaign ID']) === cid; });
  const existing = idx === -1 ? null : _readTab_(TAB.VERSIONS).filter(function (v) { return v._row === idx; })[0];
  if (existing && _yes_(existing['Locked'])) throw new Error('Version ' + letter + ' is locked because sending has started.');
  const row = {
    'Letter': String(letter).trim(),
    'Campaign ID': cid,
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
  const unknown = _unknownPlaceholders_(subject + '\n' + body + '\n' + String(v['Follow Up Body'] || ''));
  if (unknown.length) problems.push('Unknown fill-in word' + (unknown.length === 1 ? '' : 's') + ': ' + unknown.map(function (u) { return '{{' + u + '}}'; }).join(', ') + '. The app knows {{first}}, {{name}}, {{company}} and {{area}} (also {{first name}}, {{brokerage}}, {{city}}).');
  return problems;
}

function _lockVersion_(letter, campaignId) {
  const cid = String(campaignId || _defaultCampaignId_());
  const idx = _findRowIndex_(TAB.VERSIONS, function (v) { return String(v['Letter']) === String(letter) && String(v['Campaign ID']) === cid; });
  if (idx !== -1) _updateRow_(TAB.VERSIONS, idx, { 'Locked': 'Yes' });
}

// ============================================================
// Daily batch (Automation 3)
// ============================================================

/**
 * Who gets emailed today, across every RUNNING campaign. Pure selection,
 * nothing is written. Per campaign:
 *   - only on its sending days (Settings' days when the campaign has none), unless opts.force
 *   - up to its daily cap minus what that campaign already sent today
 *   - due follow-ups first (already queued in Emails), then first emails
 *     spread evenly across its letters
 *   - never anyone on do-not-contact, never anyone already emailed
 *
 * @param {{now?: Date, force?: boolean}} opts
 * @return {{sendingDay:boolean, paused:boolean, cap:number, sentToday:number, room:number,
 *           followUps:Object[], firsts:Object[], problems:string[], campaigns:Object[]}}
 */
function buildTodayBatch(opts) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  opts = opts || {};
  const now = opts.now || new Date();
  const s = _settings_();
  const paused = _yes_(s[SETTING.PAUSE_SENDING]);
  const todayKey = _dateKey_(now);
  const emails = _readTab_(TAB.EMAILS);
  const partners = _readTab_(TAB.PARTNERS);
  const byId = {};
  partners.forEach(function (p) { byId[p['ID']] = p; });
  const dnc = {};
  _doNotContactEmails_().forEach(function (e) { dnc[e] = true; });
  const versionRows = _readTab_(TAB.VERSIONS);

  const campaigns = _readTab_(TAB.CAMPAIGNS).filter(function (c) { return String(c['Status']) === 'running' && (!opts.campaignId || String(c['ID']) === String(opts.campaignId)); });
  const out = { date: todayKey, weekday: _weekday_(now), sendingDay: false, paused: paused, cap: 0, sentToday: 0, room: 0, followUps: [], firsts: [], problems: [], campaigns: [] };
  if (paused) out.problems.push('Sending is paused (Settings).');
  if (!campaigns.length) out.problems.push(opts.campaignId ? 'This campaign is not running. Press Start sending or Resume first.' : 'No campaign is running. Start one under Campaigns.');

  campaigns.forEach(function (c) {
    const cid = String(c['ID']);
    const sending = _campaignSending_(c);
    const sendingDay = sending.days.indexOf(_weekday_(now).toLowerCase()) !== -1;
    const started = !c['Start Date'] || _dateKey_(new Date(c['Start Date'])) <= todayKey;
    const isMember = _campaignMemberTest_(cid);
    const memberIds = {};
    partners.forEach(function (p) { if (isMember(p)) memberIds[p['ID']] = true; });
    const mine = emails.filter(function (e) { return String(e['Campaign ID']) === cid || (!String(e['Campaign ID'] || '').trim() && memberIds[e['Partner ID']]); });
    const sentToday = mine.filter(function (e) { return e['Status'] !== 'cancelled' && e['Sent At'] && _dateKey_(new Date(e['Sent At'])) === todayKey; }).length;
    const emailed = {};   // in THIS campaign; someone re-engaged after an earlier one starts fresh here
    mine.forEach(function (e) { if (e['Status'] !== 'cancelled') emailed[e['Partner ID']] = true; });
    const room = Math.max(0, sending.cap - sentToday);

    const followUps = mine.filter(function (e) {
      if (e['Status'] !== 'queued' || e['Step'] !== 'followup') return false;
      if (e['Scheduled For'] && _dateKey_(new Date(e['Scheduled For'])) > todayKey) return false;
      const p = byId[e['Partner ID']];
      return p && !dnc[_normEmail_(p['Email'])] && !_yes_(p['Do Not Contact']);
    }).map(function (e) {
      const o = Object.assign({ partner: byId[e['Partner ID']], campaignId: cid }, e);
      Object.defineProperty(o, '_row', { value: e._row, enumerable: false });   // Object.assign drops it
      return o;
    });

    const letters = _csvList_(c['Versions']);
    const candidates = partners.filter(function (p) {
      if (!memberIds[p['ID']]) return false;
      if (String(p['Stage']) === 'Partner' || p['Partner Since'] || _yes_(p['Skip Email Test'])) return false;   // the book and hand-emailed people are never in the email test
      return String(p['Version'] || '').trim() && !emailed[p['ID']] && !_yes_(p['Do Not Contact']) && !dnc[_normEmail_(p['Email'])] && _normEmail_(p['Email']);
    });
    const buckets = {};
    (letters.length ? letters : EMAIL_VERSIONS).forEach(function (v) { buckets[v] = []; });
    candidates.forEach(function (p) { (buckets[p['Version']] = buckets[p['Version']] || []).push(p); });
    const versions = Object.keys(buckets).filter(function (v) { return buckets[v].length; });
    const firsts = [];
    const firstRoom = Math.max(0, room - followUps.length);
    let i = 0;
    while (firsts.length < firstRoom && versions.some(function (v) { return buckets[v].length; })) {
      const v = versions[i % versions.length];
      if (buckets[v].length) { const p = buckets[v].shift(); const o = Object.assign({ campaignId: cid }, p); Object.defineProperty(o, '_row', { value: p._row, enumerable: false }); firsts.push(o); }
      i++;
    }

    const problems = [];
    if (!started) problems.push(c['Name'] + ' starts ' + _dateKey_(new Date(c['Start Date'])) + '.');
    if (!sendingDay && !opts.force) problems.push('Today (' + _weekday_(now) + ') is not a sending day for ' + c['Name'] + ' (' + sending.daysLabel + ').');
    const needed = {};
    firsts.forEach(function (p) { needed[p['Version']] = true; });
    Object.keys(needed).forEach(function (letter) {
      const v = versionRows.filter(function (r) { return String(r['Campaign ID']) === cid && String(r['Letter']) === letter; })[0];
      if (!v) { problems.push(c['Name'] + ': letter ' + letter + ' has no wording.'); return; }
      validateVersion(v).forEach(function (pr) { problems.push(c['Name'] + ', letter ' + letter + ': ' + pr); });
    });

    // The list is always previewable; the problems say why it cannot go out yet.
    const takenFollow = followUps.slice(0, room);
    out.campaigns.push({ id: cid, name: String(c['Name'] || ''), sendingDay: sendingDay, started: started, cap: sending.cap, sentToday: sentToday, room: room, followUps: takenFollow.length, firsts: firsts.length, problems: problems });
    out.cap += sending.cap; out.sentToday += sentToday; out.room += room;
    if (sendingDay && started) out.sendingDay = true;
    takenFollow.forEach(function (e) { out.followUps.push(e); });
    firsts.forEach(function (p) { out.firsts.push(p); });
    // a campaign with nothing to send today does not block the others
    if (takenFollow.length || firsts.length) problems.forEach(function (pr) { out.problems.push(pr); });
  });
  return out;
}

/** Cancel queued (unsent) emails for a partner — used by opt-out and reply. */
function _cancelQueuedEmails_(partnerId, campaignId) {
  const updates = _readTab_(TAB.EMAILS)
    .filter(function (e) { return String(e['Partner ID']) === String(partnerId) && e['Status'] === 'queued' && (!campaignId || String(e['Campaign ID']) === String(campaignId)); })
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
function getCampaignStats(campaignId) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const cid = String(campaignId || _defaultCampaignId_());
  const partners = _readTab_(TAB.PARTNERS).filter(_campaignMemberTest_(cid));
  const memberIds = {};
  partners.forEach(function (p) { memberIds[p['ID']] = true; });
  const emails = _readTab_(TAB.EMAILS).filter(function (e) { return String(e['Campaign ID']) === cid || (!String(e['Campaign ID'] || '').trim() && memberIds[e['Partner ID']]); });
  const events = _readTab_(TAB.EVENTS);
  const referrals = _readTab_(TAB.REFERRALS);
  const versionOf = {};
  partners.forEach(function (p) { versionOf[p['ID']] = String(p['Version'] || ''); });

  const rows = {};
  function row(v) {
    if (!rows[v]) rows[v] = { version: v, assigned: 0, sent: 0, followUps: 0, bounced: 0, replied: 0, talked: 0, addresses: 0, notInterested: 0, optedOut: 0, referrals: 0, reportsSent: 0, estimates: 0, signed: 0, paid: 0 };
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
  const sentTo = {};
  emails.forEach(function (e) { if (e['Step'] === 'first' && e['Sent At'] && e['Status'] !== 'cancelled') sentTo[e['Partner ID']] = true; });
  events.forEach(function (ev) {
    const v = versionOf[ev['Partner ID']];
    if (!v) return;
    if ((ev['Kind'] === 'reply' || (ev['Kind'] === 'text' && ev['Direction'] === 'in')) && sentTo[ev['Partner ID']] && !repliedPartners[ev['Partner ID']]) { repliedPartners[ev['Partner ID']] = true; row(v).replied++; }
    if (ev['Kind'] === 'opt-out') row(v).optedOut++;
    if (ev['Kind'] === 'call' && String(ev['Outcome']).toLowerCase() === 'talked' && !talkedPartners[ev['Partner ID']]) { talkedPartners[ev['Partner ID']] = true; row(v).talked++; }
  });
  partners.forEach(function (p) { if (WIN_RESPONSES.indexOf(String(p['Response'])) !== -1 && versionOf[p['ID']]) row(versionOf[p['ID']]).addresses++; if (String(p['Response']) === 'Not interested' && versionOf[p['ID']]) row(versionOf[p['ID']]).notInterested++; });
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
    if ((ev['Kind'] === 'call' && ev['Outcome'] !== 'missed') || ev['Kind'] === 'voicemail' || ev['Kind'] === 'text') _maxDate_(lastContact, ev['Partner ID'], ev['At']);
  });
  referrals.forEach(function (r) { if (r['Direction'] === 'in') partnerOf[r['Partner ID']] = true; });
  const updates = [];
  partners.forEach(function (p) {
    const id = p['ID'];
    let stage = 'Prospect';
    if (sent[id] || (_yes_(p['Skip Email Test']) && p['Last Contact'])) stage = 'Contacted';
    if (replied[id]) stage = 'Replied';
    if (partnerOf[id] || WIN_RESPONSES.indexOf(String(p['Response'])) !== -1 || p['Partner Since']) stage = 'Partner';
    let response = String(p['Response'] || '');
    if (optedOut[id] || _yes_(p['Do Not Contact'])) response = 'Opted out';
    else if (bounced[id]) response = 'Bounced';
    else if (replied[id] && !response) response = 'Replied';
    const row = { 'Stage': stage, 'Response': response };
    if (lastContact[id]) row['Last Contact'] = lastContact[id];
    if (stage === 'Partner' && !p['Partner Since']) row['Partner Since'] = new Date();
    if (row['Stage'] !== p['Stage'] || row['Response'] !== p['Response'] || row['Partner Since'] || (row['Last Contact'] && row['Last Contact'].toISOString() !== p['Last Contact'])) {
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

// ============================================================
// Owner tool: see an email exactly as a person would get it, and send it
// to yourself (first email, then the follow-up threaded under it).
// Nothing is logged, nothing locks, no stats move. (Brian 2026-11-25)
// ============================================================

const TEST_SAMPLE_PARTNER = { 'ID': 'sample', 'Name': 'Loretta Nelson', 'Company': 'Keller Williams Tyler', 'Area': 'Tyler', 'Email': '' };

/** The filled-in text for one wording, as a given person (or the sample) would receive it. Any role. */
function previewCampaignEmail(campaignId, letter, partnerId) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const v = _versionFor_(campaignId, letter || 'A');
  if (!v) throw new Error('No wording ' + (letter || 'A') + ' on this campaign.');
  const p = partnerId && partnerId !== 'sample' ? _byId_(TAB.PARTNERS, partnerId) : null;
  const who = p || TEST_SAMPLE_PARTNER;
  return {
    as: { id: String(who['ID']), name: String(who['Name'] || ''), company: String(who['Company'] || ''), area: String(who['Area'] || '') },
    subject: _fill_(v['Subject'], who),
    body: _fill_(v['Body'], who),
    followUp: _fill_(v['Follow Up Body'], who),
    problems: validateVersion(v),
    unknown: _unknownPlaceholders_(String(v['Subject']) + '\n' + String(v['Body']) + '\n' + String(v['Follow Up Body'] || '')),
  };
}

/** A few real members of the campaign to preview as, plus the sample. Any role. */
function previewPeople(campaignId) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const isMember = _campaignMemberTest_(campaignId);
  const out = [{ id: 'sample', name: TEST_SAMPLE_PARTNER['Name'] + ' (made up)', company: TEST_SAMPLE_PARTNER['Company'] }];
  _readTab_(TAB.PARTNERS).filter(isMember).slice(0, 25).forEach(function (p) { out.push({ id: String(p['ID']), name: String(p['Name'] || ''), company: String(p['Company'] || '') }); });
  return out;
}

/**
 * Send the wording to the signed-in owner's own mailbox: the first email with a [TEST] subject,
 * then the follow-up as a reply in that thread, so threading and line breaks can be checked in Gmail.
 */
function sendTestEmail(campaignId, letter, partnerId) {
  const me = _requireRole_(ADMIN_ROLES);
  const pv = previewCampaignEmail(campaignId, letter, partnerId);
  const to = _senderEmail_() || me.email;
  if (!to) throw new Error('No mailbox to send the test to.');
  const settings = _settings_();
  const senderName = String(settings[SETTING.SENDER_NAME] || '').trim();
  const subject = '[TEST] ' + pv.subject;
  const msg = GmailApp.createDraft(to, subject, pv.body, senderName ? { name: senderName } : {}).send();
  let followUpSent = false;
  if (String(pv.followUp || '').trim()) {
    const threadId = msg.getThread().getId();
    _sendInThread_(threadId, msg.getId(), to, 'Re: ' + subject, pv.followUp);
    followUpSent = true;
  }
  return { ok: true, to: to, subject: subject, followUpSent: followUpSent, as: pv.as };
}
