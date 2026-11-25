/**
 * ArmorTex Outreach — campaigns_server.gs
 * A campaign is one push to one audience: who (type + lists + stages), which
 * letters, when (start, days, cap, follow-up gap), and what happened.
 *
 * The letters a campaign uses are its own Versions rows (Campaign ID), copied
 * from the type's last campaign when the campaign is created. Dealing letters
 * stamps the partner's Campaign ID and Version once; a person is in one email
 * campaign at a time. Today's batch draws from every RUNNING campaign, and a
 * person still presses Send. Rates always come with their counts.
 */

// ============================================================
// Lookups
// ============================================================

function _campaignById_(id) {
  const c = _byId_(TAB.CAMPAIGNS, id);
  if (!c) throw new Error('Campaign not found: ' + id);
  return c;
}

/** The first campaign ever made: where legacy functions without a campaign land. */
function _defaultCampaignId_() {
  const first = _readTab_(TAB.CAMPAIGNS)[0];
  if (first) return String(first['ID']);
  _seedCampaigns_();
  return String(_readTab_(TAB.CAMPAIGNS)[0]['ID']);
}

/**
 * Is this partner in campaign cid? The first campaign also owns anyone who
 * was dealt a letter before campaigns existed (blank Campaign ID); setup()
 * stamps them, this covers rows written by hand in between.
 */
function _campaignMemberTest_(cid) {
  cid = String(cid);
  const isDefault = cid === String((_readTab_(TAB.CAMPAIGNS)[0] || {})['ID']);
  // history counts: anyone this campaign emailed stays in its numbers even after they moved on (2026-11-23)
  const emailedIn = {};
  _readTab_(TAB.EMAILS).forEach(function (e) { if (String(e['Campaign ID']) === cid && e['Status'] !== 'cancelled' && e['Sent At']) emailedIn[e['Partner ID']] = true; });
  return function (p) {
    if (emailedIn[p['ID']]) return true;
    const own = _partnerCampaignIds_(p);
    if (own.length) return own.indexOf(cid) !== -1;
    return isDefault && !!String(p['Version'] || '').trim();
  };
}

/** The campaigns a person is in (Partners.Campaign ID holds a comma list; a person can be in several, Brian 2026-11-24). */
function _partnerCampaignIds_(p) { return _csvList_(p['Campaign ID']); }

/**
 * Everything the audience rules need, read once per call: which campaigns are still open,
 * who was emailed / replied in which campaign, when each person was last emailed.
 */
function _campaignCtx_() {
  const ctx = { open: {}, names: {}, emailedIn: {}, repliedIn: {}, lastSent: {}, reengageDays: parseInt(_setting_(SETTING.REENGAGE_DAYS), 10) };
  if (isNaN(ctx.reengageDays)) ctx.reengageDays = 90;
  _readTab_(TAB.CAMPAIGNS).forEach(function (c) { ctx.open[String(c['ID'])] = String(c['Status']) !== 'done'; ctx.names[String(c['ID'])] = String(c['Name'] || c['ID']); });
  _readTab_(TAB.EMAILS).forEach(function (e) {
    if (e['Status'] === 'cancelled' || !e['Sent At']) return;
    const cid = String(e['Campaign ID'] || ''), pid = String(e['Partner ID']);
    const t = new Date(e['Sent At']).getTime();
    if (e['Step'] === 'first' || e['Step'] === 'followup') { if (!ctx.lastSent[pid] || ctx.lastSent[pid] < t) ctx.lastSent[pid] = t; }
    if (cid) {
      (ctx.emailedIn[cid] = ctx.emailedIn[cid] || {})[pid] = true;
      if (e['Status'] === 'replied') (ctx.repliedIn[cid] = ctx.repliedIn[cid] || {})[pid] = true;
    }
  });
  return ctx;
}

/** Tags: lowercase words, trimmed, deduped; accepts an array or a comma/space string. */
function _normTags_(v) {
  const raw = Array.isArray(v) ? v : String(v || '').split(/[,\n]+/);
  const out = [];
  raw.map(function (t) { return String(t).trim().toLowerCase().replace(/\s+/g, '-'); }).filter(Boolean).forEach(function (t) { if (out.indexOf(t) === -1) out.push(t); });
  return out;
}

/** Ids of campaigns comparing more than one wording; only their members show a letter badge. */
function _multiCampaignIds_() {
  return _readTab_(TAB.CAMPAIGNS).filter(function (c) { return _csvList_(c['Versions']).length > 1; }).map(function (c) { return String(c['ID']); });
}

function _csvList_(v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

/** Cap, days and follow-up gap for a campaign, falling back to Settings. */
function _campaignSending_(c) {
  const s = _settings_();
  const cap = String(c['Daily Cap'] || '').trim() !== '' ? parseInt(c['Daily Cap'], 10) : parseInt(s[SETTING.DAILY_CAP], 10);
  const daysRaw = String(c['Sending Days'] || '').trim() || String(s[SETTING.SENDING_DAYS] || '');
  const follow = String(c['Follow Up Days'] || '').trim() !== '' ? parseInt(c['Follow Up Days'], 10) : parseInt(s[SETTING.FOLLOW_UP_DAYS], 10);
  return {
    cap: Math.max(0, isNaN(cap) ? 0 : cap),
    days: daysRaw.split(',').map(function (d) { return d.trim().slice(0, 3).toLowerCase(); }).filter(Boolean),
    daysLabel: daysRaw,
    followUpDays: isNaN(follow) ? 4 : follow,
    callAfterDays: String(c['Call After Days'] || '').trim() === '' ? 0 : Math.max(0, parseInt(c['Call After Days'], 10) || 0),
    visitAfterDays: String(c['Visit After Days'] || '').trim() === '' ? 0 : Math.max(0, parseInt(c['Visit After Days'], 10) || 0),
    inherited: { cap: String(c['Daily Cap'] || '').trim() === '', days: String(c['Sending Days'] || '').trim() === '', followUpDays: String(c['Follow Up Days'] || '').trim() === '' },
  };
}

/** Does this partner match the campaign's audience filters? (Exclusions are judged separately.) */
function _campaignMatches_(c, p, ctx) {
  if (String(p['Type']).toLowerCase() !== String(c['Partner Type']).toLowerCase()) return false;
  // Lists: curated list ids (L-3), import-file names, or an earlier campaign (CP-1 = its people who never replied);
  // a person needs to be on any one of them
  const lists = _csvList_(c['Lists']);
  if (lists.length) {
    ctx = ctx || _campaignCtx_();
    const mine = _partnerListIds_(p);
    const pid = String(p['ID']);
    const hit = lists.some(function (l) {
      if (/^L-\d+$/.test(l)) return mine.indexOf(l) !== -1;
      if (/^CP-\d+$/.test(l)) return l !== String(c['ID']) && !!(ctx.emailedIn[l] || {})[pid] && !(ctx.repliedIn[l] || {})[pid];
      return l === String(p['Source List'] || '').trim();
    });
    if (!hit) return false;
  }
  const stages = _csvList_(c['Stages']);
  if (stages.length && stages.indexOf(String(p['Stage'] || 'Prospect')) === -1) return false;
  return true;
}

/** Why a matching partner is left out of the email campaign, or '' if they can go in. */
function _campaignExclusion_(c, p, dnc, ctx) {
  ctx = ctx || _campaignCtx_();
  // being in another campaign is fine (Brian 2026-11-24: "people can belong to multiple campaigns");
  // the cooling-off below is what keeps two campaigns from emailing the same person in the same month
  if (String(p['Stage']) === 'Partner' || p['Partner Since']) return 'in the book';
  if (_yes_(p['Skip Email Test'])) return 'emailed by hand';
  if (_yes_(p['Do Not Contact']) || dnc[_normEmail_(p['Email'])]) return 'do-not-contact';
  if (COLD_RESPONSES.indexOf(String(p['Response'] || '')) !== -1) return String(p['Response']) === 'Bounced' ? 'bounced (fix the email first)' : 'said no';
  if (!_normEmail_(p['Email'])) return 'no email';
  // cooling-off: nobody gets a new pitch within N days of the last one
  const last = ctx.lastSent[String(p['ID'])];
  if (last && ctx.reengageDays > 0 && (Date.now() - last) < ctx.reengageDays * 86400000) return 'emailed in the last ' + ctx.reengageDays + ' days';
  return '';
}

// ============================================================
// Ledger + record
// ============================================================

/** Every campaign with its headline numbers, newest first. Any role. */
function listCampaigns() {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const partners = _readTab_(TAB.PARTNERS);
  const emails = _readTab_(TAB.EMAILS);
  const events = _readTab_(TAB.EVENTS);
  return _readTab_(TAB.CAMPAIGNS).map(function (c) {
    return Object.assign(_campaignSummary_(c, partners, emails, events), { inherits: _campaignSending_(c).inherited });
  }).reverse();
}

function _campaignSummary_(c, partners, emails, events) {
  const id = String(c['ID']);
  const members = partners.filter(_campaignMemberTest_(id));
  const memberIds = {};
  members.forEach(function (p) { memberIds[p['ID']] = true; });
  const mine = emails.filter(function (e) { return String(e['Campaign ID']) === id || (!String(e['Campaign ID'] || '').trim() && memberIds[e['Partner ID']]); });
  const sentFirst = mine.filter(function (e) { return e['Step'] === 'first' && e['Sent At'] && e['Status'] !== 'cancelled'; });
  const sentIds = {};
  sentFirst.forEach(function (e) { sentIds[e['Partner ID']] = true; });
  const replied = {};
  events.forEach(function (ev) { if ((ev['Kind'] === 'reply' || (ev['Kind'] === 'text' && ev['Direction'] === 'in')) && sentIds[ev['Partner ID']]) replied[ev['Partner ID']] = true; });
  const wins = members.filter(function (p) { return WIN_RESPONSES.indexOf(String(p['Response'])) !== -1; }).length;
  const sending = _campaignSending_(c);
  const firstSent = sentFirst.map(function (e) { return new Date(e['Sent At']).getTime(); }).sort()[0];
  const lastSent = mine.filter(function (e) { return e['Sent At']; }).map(function (e) { return new Date(e['Sent At']).getTime(); }).sort().pop();
  return {
    id: id, name: String(c['Name'] || ''), status: String(c['Status'] || 'draft'), type: String(c['Partner Type'] || ''),
    typeLabel: (PARTNER_TYPE_PROFILES[String(c['Partner Type'])] || {}).plural || String(c['Partner Type'] || ''),
    typeKey: String(c['Partner Type'] || ''),
    versions: _csvList_(c['Versions']), lists: _csvList_(c['Lists']), stages: _csvList_(c['Stages']),
    listNames: _csvList_(c['Lists']).map(function (l) { const row = /^L-\d+$/.test(l) ? _byId_(TAB.LISTS, l) : null; if (row) return String(row['Name']); const prev = /^CP-\d+$/.test(l) ? _byId_(TAB.CAMPAIGNS, l) : null; return prev ? 'no reply to “' + String(prev['Name']) + '”' : l; }),
    audience: members.length, dealt: members.filter(function (p) { return String(p['Version'] || '').trim(); }).length,
    sent: sentFirst.length, replied: Object.keys(replied).length, replyRate: sentFirst.length ? Object.keys(replied).length / sentFirst.length : 0,
    wins: wins, winNoun: (PARTNER_TYPE_PROFILES[String(c['Partner Type'])] || {}).winVerb || 'won',
    startDate: c['Start Date'] || '', firstSentAt: firstSent ? new Date(firstSent).toISOString() : '', lastSentAt: lastSent ? new Date(lastSent).toISOString() : '',
    cap: sending.cap, days: sending.daysLabel, followUpDays: sending.followUpDays, callAfterDays: sending.callAfterDays, visitAfterDays: sending.visitAfterDays,
    createdAt: c['Created At'] || '', notes: String(c['Notes'] || ''), tags: _normTags_(c['Tags']),
  };
}

/** One campaign: summary, its letters, per-letter stats, audience, plan. Any role. */
function getCampaign(id) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const c = _campaignById_(id);
  const partners = _readTab_(TAB.PARTNERS);
  const emails = _readTab_(TAB.EMAILS);
  const events = _readTab_(TAB.EVENTS);
  const summary = _campaignSummary_(c, partners, emails, events);
  return {
    campaign: summary,
    raw: { 'Start Date': c['Start Date'] || '', 'Sending Days': c['Sending Days'] || '', 'Daily Cap': c['Daily Cap'] === undefined ? '' : c['Daily Cap'], 'Follow Up Days': c['Follow Up Days'] === undefined ? '' : c['Follow Up Days'], 'Call After Days': c['Call After Days'] === undefined ? '' : c['Call After Days'], 'Visit After Days': c['Visit After Days'] === undefined ? '' : c['Visit After Days'] },
    sending: _campaignSending_(c),
    versions: listVersions(id),
    stats: getCampaignStats(id),
    audience: campaignAudience(id),
    plan: _campaignPlan_(c, partners, emails, new Date()),
    lists: listSourceLists(),
    reengageDays: _campaignCtx_().reengageDays,
    curated: listLists(),
    earlier: _readTab_(TAB.CAMPAIGNS).filter(function (x) { return String(x['ID']) !== String(id) && String(x['Partner Type']) === String(c['Partner Type']); }).map(function (x) { return { id: String(x['ID']), name: String(x['Name']), status: String(x['Status']), noReply: _campaignNoReplyCount_(String(x['ID'])) }; }),
    stageOptions: ['Prospect', 'Contacted', 'Replied'],
    letterOptions: EMAIL_VERSIONS,
  };
}

/** Start a campaign. Owner only. Copies the type's letters from its latest campaign as a starting point. */
function createCampaign(payload) {
  const me = _requireRole_(ADMIN_ROLES);
  payload = payload || {};
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Give the campaign a name.');
  const type = String(payload.type || 'realtor').toLowerCase();
  if (!PARTNER_TYPE_PROFILES[type]) throw new Error('Unknown partner type: ' + type);
  // one letter by default; B/C/E are for comparing wordings, which is optional
  const letters = (payload.versions || ['A']).map(String).filter(function (l) { return EMAIL_VERSIONS.indexOf(l) !== -1; });
  if (!letters.length) throw new Error('Pick at least one letter.');
  const id = _nextId_(TAB.CAMPAIGNS);
  const row = {
    'ID': id, 'Name': name, 'Status': 'draft', 'Partner Type': type,
    'Lists': (payload.lists || []).map(String).join(','), 'Stages': (payload.stages || []).map(String).join(','), 'Versions': letters.join(','),
    'Start Date': payload.startDate ? _parseLocalDate_(payload.startDate) : '', 'Sending Days': String(payload.sendingDays || ''), 'Daily Cap': payload.dailyCap === undefined || payload.dailyCap === '' ? '' : parseInt(payload.dailyCap, 10),
    'Follow Up Days': payload.followUpDays === undefined || payload.followUpDays === '' ? '' : parseInt(payload.followUpDays, 10),
    'Created At': new Date(), 'Created By': me.email, 'Notes': String(payload.notes || ''),
    'Call After Days': payload.callAfterDays === undefined ? DEFAULT_CALL_AFTER_DAYS : (String(payload.callAfterDays).trim() === '' ? '' : parseInt(payload.callAfterDays, 10)),
    'Visit After Days': payload.visitAfterDays === undefined || String(payload.visitAfterDays).trim() === '' ? '' : parseInt(payload.visitAfterDays, 10),
    'Tags': _normTags_(payload.tags !== undefined ? payload.tags : [type]).join(','),
  };
  _appendRows_(TAB.CAMPAIGNS, [row]);
  // letters: copy wording from the newest campaign of this type that has any, else blank
  const all = _readTab_(TAB.VERSIONS);
  const donor = _readTab_(TAB.CAMPAIGNS).filter(function (x) { return String(x['ID']) !== id && String(x['Partner Type']).toLowerCase() === type; }).reverse()
    .map(function (x) { return all.filter(function (v) { return String(v['Campaign ID']) === String(x['ID']) && String(v['Body'] || '').trim(); }); })
    .filter(function (rows) { return rows.length; })[0] || [];
  const seedAngle = {}; SEED_VERSIONS.forEach(function (v) { seedAngle[v.Letter] = v.Angle; });
  _appendRows_(TAB.VERSIONS, letters.map(function (l) {
    const src = donor.filter(function (v) { return String(v['Letter']) === l; })[0] || {};
    return { 'Letter': l, 'Channel': 'email', 'Partner Type': type, 'Angle': src['Angle'] || seedAngle[l] || '', 'Subject': src['Subject'] || '', 'Body': src['Body'] || '', 'Follow Up Body': src['Follow Up Body'] || '', 'QR Code URL': '', 'Locked': '', 'Updated At': new Date(), 'Campaign ID': id };
  }));
  return { id: id };
}

/** Edit a campaign's plan and audience filters, or move its status. Owner only. */
function saveCampaign(id, payload) {
  _requireRole_(ADMIN_ROLES);
  payload = payload || {};
  const c = _campaignById_(id);
  const row = {};
  if (payload.name !== undefined) { const n = String(payload.name).trim(); if (!n) throw new Error('Name is required.'); row['Name'] = n; }
  if (payload.lists !== undefined) row['Lists'] = (payload.lists || []).map(String).join(',');
  if (payload.stages !== undefined) row['Stages'] = (payload.stages || []).map(String).join(',');
  if (payload.versions !== undefined) {
    const letters = (payload.versions || []).map(String).filter(function (l) { return EMAIL_VERSIONS.indexOf(l) !== -1; });
    if (!letters.length) throw new Error('Pick at least one letter.');
    // letters already dealt stay in play
    _readTab_(TAB.PARTNERS).forEach(function (p) { if (_partnerCampaignIds_(p).indexOf(String(id)) !== -1 && String(p['Version'] || '').trim() && letters.indexOf(String(p['Version'])) === -1) letters.push(String(p['Version'])); });
    row['Versions'] = EMAIL_VERSIONS.filter(function (l) { return letters.indexOf(l) !== -1; }).join(',');
    // make sure each letter has a wording row
    const have = {};
    _readTab_(TAB.VERSIONS).forEach(function (v) { if (String(v['Campaign ID']) === String(id)) have[String(v['Letter'])] = true; });
    const seedAngle = {}; SEED_VERSIONS.forEach(function (v) { seedAngle[v.Letter] = v.Angle; });
    _appendRows_(TAB.VERSIONS, letters.filter(function (l) { return !have[l]; }).map(function (l) {
      return { 'Letter': l, 'Channel': 'email', 'Partner Type': c['Partner Type'], 'Angle': seedAngle[l] || '', 'Subject': '', 'Body': '', 'Follow Up Body': '', 'QR Code URL': '', 'Locked': '', 'Updated At': new Date(), 'Campaign ID': String(id) };
    }));
  }
  if (payload.startDate !== undefined) row['Start Date'] = payload.startDate ? _parseLocalDate_(payload.startDate) : '';
  if (payload.sendingDays !== undefined) row['Sending Days'] = String(payload.sendingDays || '');
  if (payload.dailyCap !== undefined) {
    if (String(payload.dailyCap).trim() === '') row['Daily Cap'] = '';
    else {
      const n = parseInt(payload.dailyCap, 10);
      if (isNaN(n) || n < 0) throw new Error('Daily cap must be a whole number.');
      let remaining = null;
      try { remaining = MailApp.getRemainingDailyQuota(); } catch (err) { remaining = null; }
      if (remaining !== null && n > remaining) throw new Error('Daily cap ' + n + ' is above what this mailbox can send today (' + remaining + ').');
      row['Daily Cap'] = n;
    }
  }
  if (payload.visitAfterDays !== undefined) {
    if (String(payload.visitAfterDays).trim() === '') row['Visit After Days'] = '';
    else { const n = parseInt(payload.visitAfterDays, 10); if (isNaN(n) || n < 0) throw new Error('Visit step must be a whole number of business days.'); row['Visit After Days'] = n; }
  }
  if (payload.callAfterDays !== undefined) {
    if (String(payload.callAfterDays).trim() === '') row['Call After Days'] = '';
    else { const n = parseInt(payload.callAfterDays, 10); if (isNaN(n) || n < 0) throw new Error('Call plan must be a whole number of business days (0 = call right after the email).'); row['Call After Days'] = n; }
  }
  if (payload.followUpDays !== undefined) {
    if (String(payload.followUpDays).trim() === '') row['Follow Up Days'] = '';
    else { const n = parseInt(payload.followUpDays, 10); if (isNaN(n) || n < 1) throw new Error('Follow-up must be at least 1 business day.'); row['Follow Up Days'] = n; }
  }
  if (payload.notes !== undefined) row['Notes'] = String(payload.notes || '');
  if (payload.tags !== undefined) row['Tags'] = _normTags_(payload.tags).join(',');
  if (payload.status !== undefined) {
    const st = String(payload.status);
    if (CAMPAIGN_STATUSES.indexOf(st) === -1) throw new Error('Unknown status: ' + st);
    if (st === 'running') {
      const problems = [];
      _readTab_(TAB.VERSIONS).filter(function (v) { return String(v['Campaign ID']) === String(id) && _csvList_(row['Versions'] !== undefined ? row['Versions'] : c['Versions']).indexOf(String(v['Letter'])) !== -1; })
        .forEach(function (v) { validateVersion(v).forEach(function (pr) { problems.push('Letter ' + v['Letter'] + ': ' + pr); }); });
      if (problems.length) throw new Error('Not ready to run. ' + problems.join(' '));
    }
    row['Status'] = st;
  }
  _updateRow_(TAB.CAMPAIGNS, c._row, row);
  return { ok: true };
}

/**
 * Duplicate: a new draft with this campaign's wording (unlocked), plan, letters
 * and tags, pointed at the lists you name (or none). No people come along;
 * they are dealt fresh. Owner only. The original stays as the record.
 */
function duplicateCampaign(id, payload) {
  _requireRole_(ADMIN_ROLES);
  payload = payload || {};
  const src = _campaignById_(id);
  const name = String(payload.name || '').trim() || (String(src['Name'] || '') + ' (copy)');
  const created = createCampaign({
    name: name, type: src['Partner Type'], lists: payload.lists !== undefined ? payload.lists : [], stages: _csvList_(src['Stages']),
    versions: _csvList_(src['Versions']), startDate: payload.startDate || '', sendingDays: src['Sending Days'] || '', dailyCap: src['Daily Cap'] === undefined ? '' : src['Daily Cap'],
    followUpDays: src['Follow Up Days'] === undefined ? '' : src['Follow Up Days'], callAfterDays: src['Call After Days'] === undefined ? '' : src['Call After Days'], visitAfterDays: src['Visit After Days'] === undefined ? '' : src['Visit After Days'],
    notes: 'Copied from ' + src['Name'] + ' (' + src['ID'] + ').', tags: _normTags_(src['Tags']),
  });
  // wording: exactly this campaign's, not the type's latest
  const mine = {};
  _readTab_(TAB.VERSIONS).forEach(function (v) { if (String(v['Campaign ID']) === String(id)) mine[String(v['Letter'])] = v; });
  _updateRows_(TAB.VERSIONS, _readTab_(TAB.VERSIONS).filter(function (v) { return String(v['Campaign ID']) === created.id && mine[String(v['Letter'])]; }).map(function (v) {
    const s = mine[String(v['Letter'])];
    return { rowIndex: v._row, row: { 'Angle': s['Angle'] || '', 'Subject': s['Subject'] || '', 'Body': s['Body'] || '', 'Follow Up Body': s['Follow Up Body'] || '', 'Locked': '' } };
  }));
  return created;
}

// ============================================================
// Audience + letters
// ============================================================

/** Who matches, who is in, who is left out and why. Any role. */
function campaignAudience(id) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const c = _campaignById_(id);
  const dnc = {};
  _doNotContactEmails_().forEach(function (e) { dnc[e] = true; });
  const partners = _readTab_(TAB.PARTNERS);
  const members = [];
  const excluded = {}, excludedPeople = {};
  let matching = 0, undealt = 0;
  const isMember = _campaignMemberTest_(id);
  const ctx = _campaignCtx_();
  partners.forEach(function (p) {
    const inIt = isMember(p);
    if (!inIt && !_campaignMatches_(c, p, ctx)) return;
    const why = inIt ? '' : _campaignExclusion_(c, p, dnc, ctx);
    if (why) {
      excluded[why] = (excluded[why] || 0) + 1;
      (excludedPeople[why] = excludedPeople[why] || []).push({ ID: p['ID'], Name: p['Name'], Company: p['Company'], lastSent: ctx.lastSent[String(p['ID'])] ? new Date(ctx.lastSent[String(p['ID'])]).toISOString() : '' });
      return;
    }
    matching++;
    if (inIt) members.push({ ID: p['ID'], Name: p['Name'], Company: p['Company'], Area: p['Area'], Email: p['Email'], Stage: p['Stage'], Rep: p['Rep'], Version: p['Version'], 'Source List': p['Source List'] });
    else undealt++;
  });
  const counts = {};
  members.forEach(function (m) { const v = String(m.Version || '') || 'none'; counts[v] = (counts[v] || 0) + 1; });
  return { matching: matching, members: members, undealt: undealt, excluded: excluded, excludedPeople: excludedPeople, counts: counts };
}


/**
 * Deal letters: everyone who matches the filters and is not yet in a campaign
 * joins this one and gets a letter (people who already had a letter keep it).
 * Owner only. Shuffled within each brokerage, dealt in turn across the letters.
 */
function dealLetters(id, opts) {
  _requireRole_(ADMIN_ROLES);
  opts = opts || {};
  const c = _campaignById_(id);
  const letters = (opts.versions && opts.versions.length ? opts.versions.map(String) : _csvList_(c['Versions'])).filter(function (l) { return EMAIL_VERSIONS.indexOf(l) !== -1; });
  if (!letters.length) throw new Error('Pick at least one letter.');
  const rng = opts.rng || Math.random;
  const dnc = {};
  _doNotContactEmails_().forEach(function (e) { dnc[e] = true; });
  const isMember = _campaignMemberTest_(id);
  const ctx = _campaignCtx_();
  const todo = _readTab_(TAB.PARTNERS).filter(function (p) {
    if (isMember(p)) return !String(p['Version'] || '').trim();   // already in, just needs a letter
    return _campaignMatches_(c, p, ctx) && !_campaignExclusion_(c, p, dnc, ctx);
  });
  const groups = {};
  todo.forEach(function (p) { const key = String(p['Company'] || '').trim().toLowerCase() || ('solo:' + p['ID']); (groups[key] = groups[key] || []).push(p); });
  const counts = {};
  letters.forEach(function (l) { counts[l] = 0; });
  let cursor = 0;
  const updates = [];
  _shuffle_(Object.keys(groups), rng).forEach(function (key) {
    _shuffle_(groups[key], rng).forEach(function (p) {
      const keep = String(p['Version'] || '').trim();
      const v = keep && letters.indexOf(keep) !== -1 ? keep : letters[cursor++ % letters.length];
      counts[v] = (counts[v] || 0) + 1;
      const ids = _partnerCampaignIds_(p); if (ids.indexOf(String(id)) === -1) ids.push(String(id));
      updates.push({ rowIndex: p._row, row: { 'Version': v, 'Campaign ID': ids.join(',') } });
    });
  });
  _updateRows_(TAB.PARTNERS, updates);
  return { dealt: updates.length, counts: counts };
}

/**
 * Drop a wording from a campaign (owner). Refused once any email went out with that letter.
 * Members holding the letter lose it and are dealt again among the wordings that remain,
 * so a four-letter campaign from before the simplification can become a one-email campaign.
 */
function removeWording(id, letter) {
  _requireRole_(ADMIN_ROLES);
  const c = _campaignById_(id);
  const L = String(letter || '').trim();
  const letters = _csvList_(c['Versions']);
  if (letters.indexOf(L) === -1) throw new Error('This campaign has no wording ' + L + '.');
  if (letters.length === 1) throw new Error('A campaign needs at least one wording.');
  const used = _readTab_(TAB.EMAILS).some(function (e) { return String(e['Campaign ID']) === String(id) && String(e['Version']) === L; });
  if (used) throw new Error('Emails already went out with wording ' + L + '; it has to stay so the results read right.');
  const keep = letters.filter(function (l) { return l !== L; });
  _updateRow_(TAB.CAMPAIGNS, c._row, { 'Versions': keep.join(',') });
  const holders = _readTab_(TAB.PARTNERS).filter(function (p) { return _partnerCampaignIds_(p).indexOf(String(id)) !== -1 && String(p['Version']) === L; });
  _updateRows_(TAB.PARTNERS, holders.map(function (p) { return { rowIndex: p._row, row: { 'Version': '' } }; }));
  const vIdx = _findRowIndex_(TAB.VERSIONS, function (v) { return String(v['Campaign ID']) === String(id) && String(v['Letter']) === L; });
  if (vIdx !== -1) _updateRow_(TAB.VERSIONS, vIdx, { 'Locked': '' });
  const r = holders.length ? dealLetters(id, { versions: keep }) : { dealt: 0, counts: {} };
  return { versions: keep, redealt: r.dealt };
}

/** Take someone out of a campaign (only if nothing was sent to them in it). Owner only. */
function removeFromCampaign(id, partnerId) {
  _requireRole_(ADMIN_ROLES);
  const p = _byId_(TAB.PARTNERS, partnerId);
  const ids = p ? _partnerCampaignIds_(p) : [];
  if (!p || ids.indexOf(String(id)) === -1) throw new Error('Not in this campaign.');
  const sent = _readTab_(TAB.EMAILS).some(function (e) { return String(e['Partner ID']) === String(partnerId) && String(e['Campaign ID']) === String(id) && e['Status'] !== 'cancelled' && e['Sent At']; });
  if (sent) throw new Error('Already emailed in this campaign; cannot be removed.');
  _cancelQueuedEmails_(partnerId, id);
  const rest = ids.filter(function (x) { return x !== String(id); });
  _updateRow_(TAB.PARTNERS, p._row, { 'Campaign ID': rest.join(','), 'Version': rest.length ? p['Version'] : '' });
  return { ok: true };
}

// ============================================================
// Schedule + results
// ============================================================

/** The plan drawn out: which sending days remain and how many go each day. Pure. */
function _campaignPlan_(c, partners, emails, now) {
  const sending = _campaignSending_(c);
  const id = String(c['ID']);
  const isMember = _campaignMemberTest_(id);
  const memberIds = {};
  partners.forEach(function (p) { if (isMember(p)) memberIds[p['ID']] = true; });
  const emailed = {};
  let queuedFollowUps = 0;
  emails.forEach(function (e) {
    if (e['Status'] === 'cancelled') return;
    if (String(e['Campaign ID']) === id || (!String(e['Campaign ID'] || '').trim() && memberIds[e['Partner ID']])) {
      if (e['Step'] === 'first') emailed[e['Partner ID']] = true;
      if (e['Step'] === 'followup' && e['Status'] === 'queued') queuedFollowUps++;
    }
  });
  // who is still to get a first email, in the order Today's batch deals them (round-robin across wordings, sheet order within)
  const dnc = {};
  _doNotContactEmails_().forEach(function (e) { dnc[e] = true; });
  const candidates = partners.filter(function (p) {
    if (!memberIds[p['ID']] || !String(p['Version'] || '').trim() || emailed[p['ID']]) return false;
    if (String(p['Stage']) === 'Partner' || p['Partner Since'] || _yes_(p['Skip Email Test'])) return false;
    return !_yes_(p['Do Not Contact']) && !dnc[_normEmail_(p['Email'])] && !!_normEmail_(p['Email']);
  });
  const buckets = {}, order = [];
  candidates.forEach(function (p) { (buckets[p['Version']] = buckets[p['Version']] || []).push(p['ID']); });
  const vkeys = Object.keys(buckets);
  for (let i = 0; vkeys.some(function (v) { return buckets[v].length; }); i++) { const v = vkeys[i % vkeys.length]; if (buckets[v].length) order.push(buckets[v].shift()); }
  const firstsLeft = order.length;
  const people = {};
  const note = function (pid) { const p = byPid[pid]; if (p && !people[pid]) people[pid] = { id: pid, name: String(p['Name'] || ''), company: String(p['Company'] || ''), area: String(p['Area'] || '') }; };
  const byPid = {};
  partners.forEach(function (p) { byPid[p['ID']] = p; });
  const days = [];
  if (!sending.cap || !sending.days.length) return { days: days, people: people, firstsLeft: firstsLeft, followUpsQueued: queuedFollowUps, cap: sending.cap, sendingDays: sending.daysLabel, finish: '' };
  // today's room is what is left after what already went out today
  const todayKey = _dateKey_(now);
  let sentToday = 0;
  emails.forEach(function (e) { if (e['Sent At'] && e['Status'] !== 'cancelled' && _dateKey_(new Date(e['Sent At'])) === todayKey && (String(e['Campaign ID']) === id || memberIds[e['Partner ID']])) sentToday++; });
  let d = new Date(now.getTime());
  const start = c['Start Date'] ? new Date(c['Start Date']) : null;
  if (start && start.getTime() > d.getTime()) d = new Date(start.getTime());
  d.setHours(9, 0, 0, 0);
  // pending items carry {at, pid}: follow-ups already queued for people emailed earlier start the list
  let queue = order.slice(), pendingFollow = [], pendingCalls = [];
  emails.forEach(function (e) {
    if (e['Status'] !== 'queued' || e['Step'] !== 'followup' || !e['Scheduled For']) return;
    if (String(e['Campaign ID']) === id || (!String(e['Campaign ID'] || '').trim() && memberIds[e['Partner ID']])) pendingFollow.push({ at: new Date(e['Scheduled For']).getTime(), pid: String(e['Partner ID']) });
  });
  let guard = 0;
  while ((queue.length || pendingFollow.length || pendingCalls.length) && guard++ < 150) {
    const key = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const t = d.getTime();
    let firsts = [], fu = [];
    if (sending.days.indexOf(_weekday_(d).toLowerCase()) !== -1) {
      let room = Math.max(0, sending.cap - (key === todayKey ? sentToday : 0));
      const due = pendingFollow.filter(function (f) { return f.at <= t; });
      fu = due.slice(0, room); room -= fu.length;
      pendingFollow = pendingFollow.filter(function (f) { return f.at > t; }).concat(due.slice(fu.length));
      firsts = queue.splice(0, Math.min(queue.length, room));
      firsts.forEach(function (pid) { pendingFollow.push({ at: _addBusinessDays_(d, sending.followUpDays).getTime(), pid: pid }); if (sending.callAfterDays) pendingCalls.push({ at: _addBusinessDays_(d, sending.callAfterDays).getTime(), pid: pid }); });
    }
    // calls happen on any weekday, not only sending days
    const wd = _weekday_(d).toLowerCase();
    let calls = [];
    if (wd !== 'sat' && wd !== 'sun') { calls = pendingCalls.filter(function (f) { return f.at <= t; }); pendingCalls = pendingCalls.filter(function (f) { return f.at > t; }); }
    if (firsts.length || fu.length || calls.length) {
      const fuIds = fu.map(function (f) { return f.pid; }), callIds = calls.map(function (f) { return f.pid; });
      firsts.concat(fuIds).concat(callIds).forEach(note);
      days.push({ date: key, weekday: _weekday_(d), firsts: firsts.length, followUps: fuIds.length, calls: callIds.length, who: { firsts: firsts, followUps: fuIds, calls: callIds } });
    }
    d = new Date(d.getTime() + 86400000);
  }
  return { days: days, people: people, firstsLeft: firstsLeft, followUpsQueued: queuedFollowUps, cap: sending.cap, sendingDays: sending.daysLabel, callAfterDays: sending.callAfterDays, finish: days.length ? days[days.length - 1].date : '' };
}

/** One line per person in the campaign: letter, sent, follow-up, reply, response, calls. Any role. */
function campaignResults(id) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const c = _campaignById_(id);
  const members = _readTab_(TAB.PARTNERS).filter(_campaignMemberTest_(id));
  const ids = {};
  members.forEach(function (p) { ids[p['ID']] = true; });
  const first = {}, follow = {}, replied = {}, calls = {}, lastCall = {}, bounced = {};
  _readTab_(TAB.EMAILS).forEach(function (e) {
    if (!ids[e['Partner ID']] || e['Status'] === 'cancelled') return;
    if (e['Step'] === 'first' && e['Sent At']) first[e['Partner ID']] = e['Sent At'];
    if (e['Step'] === 'followup') follow[e['Partner ID']] = e['Sent At'] ? { at: e['Sent At'], status: 'sent' } : { at: e['Scheduled For'], status: e['Status'] };
    if (e['Status'] === 'bounced') bounced[e['Partner ID']] = true;
  });
  _readTab_(TAB.EVENTS).forEach(function (ev) {
    const pid = ev['Partner ID'];
    if (!ids[pid]) return;
    if ((ev['Kind'] === 'reply' || (ev['Kind'] === 'text' && ev['Direction'] === 'in')) && (!replied[pid] || new Date(ev['At']) < new Date(replied[pid]))) replied[pid] = ev['At'];
    if (ev['Kind'] === 'call' || ev['Kind'] === 'voicemail') { calls[pid] = (calls[pid] || 0) + 1; if (!lastCall[pid] || new Date(ev['At']) > new Date(lastCall[pid].at)) lastCall[pid] = { at: ev['At'], outcome: ev['Outcome'] }; }
  });
  const rows = members.map(function (p) {
    return {
      ID: p['ID'], Name: p['Name'], Company: p['Company'], Area: p['Area'], Email: p['Email'], Version: p['Version'], Rep: p['Rep'],
      sentAt: first[p['ID']] || '', followUp: follow[p['ID']] || null, repliedAt: replied[p['ID']] || '',
      response: bounced[p['ID']] && !p['Response'] ? 'Bounced' : String(p['Response'] || ''),
      calls: calls[p['ID']] || 0, lastCall: lastCall[p['ID']] || null, doNotContact: _yes_(p['Do Not Contact']),
    };
  }).sort(function (a, b) { return (b.sentAt ? new Date(b.sentAt).getTime() : 0) - (a.sentAt ? new Date(a.sentAt).getTime() : 0) || String(a.Name).localeCompare(String(b.Name)); });
  return { campaign: String(c['Name'] || ''), rows: rows };
}

/**
 * The five-address test as its own small campaign, so test emails never mix
 * with real numbers. Owner only. Creates the test partners, a campaign on
 * list "test" running today, and deals A/B/C.
 */
function createTestCampaign(emailsText) {
  _requireRole_(ADMIN_ROLES);
  const addresses = String(emailsText || '').split(/[\n,;]+/).map(function (e) { return e.trim(); }).filter(Boolean);
  if (!addresses.length) throw new Error('Add at least one address.');
  const csv = 'Name,Email,Company\n' + addresses.map(function (e, i) { return 'Test ' + (i + 1) + ',' + e + ',TEST'; }).join('\n');
  const imported = importPartners(csv, { type: 'realtor', sourceList: 'test', handSentToCalls: false });
  let test = _readTab_(TAB.CAMPAIGNS).filter(function (c) { return _csvList_(c['Lists']).join() === 'test'; })[0];
  let id = test ? String(test['ID']) : '';
  if (!id) {
    id = createCampaign({ name: 'Five-address test', type: 'realtor', lists: ['test'], versions: ['A', 'B', 'C'], startDate: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') }).id;
    // borrow the wording from the first campaign so the test goes out with real letters
    const defaultId = _defaultCampaignId_();
    const src = {};
    _readTab_(TAB.VERSIONS).forEach(function (v) { if (String(v['Campaign ID']) === defaultId) src[String(v['Letter'])] = v; });
    _updateRows_(TAB.VERSIONS, _readTab_(TAB.VERSIONS).filter(function (v) { return String(v['Campaign ID']) === id && src[String(v['Letter'])]; }).map(function (v) {
      const s = src[String(v['Letter'])];
      return { rowIndex: v._row, row: { 'Angle': s['Angle'], 'Subject': s['Subject'], 'Body': s['Body'], 'Follow Up Body': s['Follow Up Body'] } };
    }));
  }
  const dealt = dealLetters(id);
  let running = true, why = '';
  try { saveCampaign(id, { status: 'running' }); } catch (err) { running = false; why = err.message; }
  return { campaignId: id, added: imported.added, existed: imported.skipped.duplicate, dealt: dealt.dealt, running: running, problem: why };
}

/** How many people a campaign emailed who never replied in it (the pool for the next part of a series). */
function _campaignNoReplyCount_(cid) {
  const emailed = {}, replied = {};
  _readTab_(TAB.EMAILS).forEach(function (e) {
    if (String(e['Campaign ID']) !== String(cid) || e['Status'] === 'cancelled' || !e['Sent At']) return;
    emailed[e['Partner ID']] = true;
    if (e['Status'] === 'replied') replied[e['Partner ID']] = true;
  });
  return Object.keys(emailed).filter(function (pid) { return !replied[pid]; }).length;
}
