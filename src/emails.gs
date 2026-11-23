/**
 * ArmorTex Outreach — emails.gs
 * Sending the daily batch, queueing the one follow-up, and the reply check.
 *
 * The script runs as the account that deployed it (Brian), so GmailApp sends
 * from that mailbox and the reply check reads that inbox.
 *
 *   sendTodayBatch(opts)   a person presses Send; never on a timer (v1)
 *   checkReplies()         time-driven trigger every REPLY_CHECK_MINUTES
 *   installTriggers()      run once from the editor as the deploying account
 *   getTodayWork()         new replies + who to call, for the Today screen
 */

// ============================================================
// Templating
// ============================================================

/** Replace {{first}}, {{name}}, {{company}}, {{area}} in a version's text. */
function _fill_(text, partner) {
  const name = String(partner['Name'] || '').trim();
  const first = name.split(/\s+/)[0] || 'there';
  return String(text || '')
    .replace(/\{\{\s*first\s*\}\}/gi, first)
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*company\s*\}\}/gi, String(partner['Company'] || ''))
    .replace(/\{\{\s*area\s*\}\}/gi, String(partner['Area'] || ''));
}

function _senderEmail_() {
  // Inside a trigger getActiveUser can be blank; the effective user is the deployer.
  try { return _normEmail_(Session.getEffectiveUser().getEmail()) || _userEmail_(); } catch (err) { return _userEmail_(); }
}

// ============================================================
// Send (Automation 4) + queue the follow-up (Automation 8)
// ============================================================

/**
 * Send today's batch as built by buildTodayBatch(). Checks, in order:
 * paused → version problems → sending day (admins may force for a test) →
 * Gmail quota → do-not-contact at the moment of sending.
 *
 * @param {{force?: boolean, now?: Date}} opts  force = ignore "not a sending day" (admin only)
 * @return {{sent:number, followUps:number, skipped:{dnc:number, quota:number}, errors:string[], problems:string[]}}
 */
function sendTodayBatch(opts) {
  const me = _requireRole_(WRITE_ROLES);
  opts = opts || {};
  const now = opts.now || new Date();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Another send is already running. Wait a minute and refresh.');
  try {
    const force = !!opts.force && !!me.isAdmin;   // only an owner may send outside sending days (test batch)
    const batch = buildTodayBatch({ now: now, force: force, campaignId: opts.campaignId });
    const blocking = batch.problems.slice();
    if (blocking.length) return { sent: 0, followUps: 0, skipped: { dnc: 0, quota: 0 }, errors: [], problems: blocking };

    const settings = _settings_();
    const versions = {};   // keyed campaign|letter
    _readTab_(TAB.VERSIONS).forEach(function (v) { versions[String(v['Campaign ID']) + '|' + String(v['Letter'])] = v; });
    const campaigns = {};
    _readTab_(TAB.CAMPAIGNS).forEach(function (c) { campaigns[String(c['ID'])] = c; });
    const followDaysFor = function (cid) { const c = campaigns[cid]; return c ? _campaignSending_(c).followUpDays : (parseInt(settings[SETTING.FOLLOW_UP_DAYS], 10) || 4); };
    const dnc = {};
    _doNotContactEmails_().forEach(function (e) { dnc[e] = true; });

    let quota = Infinity;
    try { quota = MailApp.getRemainingDailyQuota(); } catch (err) { quota = Infinity; }

    const report = { sent: 0, followUps: 0, skipped: { dnc: 0, quota: 0 }, errors: [], problems: [] };
    const newEmails = [];
    const emailUpdates = [];
    const partnerUpdates = [];
    const touchedVersions = {};
    const senderName = String(settings[SETTING.SENDER_NAME] || '').trim();

    // 1. Due follow-ups (already queued rows), replying in the same thread.
    batch.followUps.forEach(function (e) {
      const p = e.partner;
      if (dnc[_normEmail_(p['Email'])]) { report.skipped.dnc++; emailUpdates.push({ rowIndex: e._row, row: { 'Status': 'cancelled' } }); return; }
      if (quota <= 0) { report.skipped.quota++; return; }
      const cid = String(e.campaignId || e['Campaign ID'] || p['Campaign ID'] || '');
      const v = versions[cid + '|' + String(e['Version'])];
      const first = _readTab_(TAB.EMAILS).filter(function (x) { return String(x['Partner ID']) === String(p['ID']) && x['Step'] === 'first' && x['Gmail Thread ID']; })[0];
      if (!v || !first) { report.errors.push(p['Name'] + ': no first email thread to follow up in'); emailUpdates.push({ rowIndex: e._row, row: { 'Status': 'cancelled' } }); return; }
      try {
        const body = _fill_(v['Follow Up Body'], p) + '\n\n' + _fill_(settings[SETTING.SENDER_SIGNATURE], p) + '\n' + settings[SETTING.BUSINESS_ADDRESS] + '\n' + settings[SETTING.OPT_OUT_LINE];
        const sentMsg = _sendInThread_(first['Gmail Thread ID'], first['Gmail Message ID'], p['Email'], 'Re: ' + String(first['Subject'] || v['Subject']), body);
        emailUpdates.push({ rowIndex: e._row, row: { 'Sent At': new Date(now.getTime()), 'Gmail Thread ID': sentMsg.threadId, 'Gmail Message ID': sentMsg.id, 'Status': 'sent', 'Subject': 'Re: ' + String(first['Subject'] || v['Subject']), 'Sent By': me.email } });
        partnerUpdates.push({ rowIndex: p._row, row: { 'Last Contact': new Date(now.getTime()) } });
        report.followUps++; quota--;
        _pause_();
      } catch (err) { report.errors.push(p['Name'] + ' (follow-up): ' + err.message); }
    });

    // 2. First emails.
    const ids = _nextId_(TAB.EMAILS, batch.firsts.length * 2);
    let idIdx = 0;
    batch.firsts.forEach(function (p) {
      const to = _normEmail_(p['Email']);
      if (dnc[to]) { report.skipped.dnc++; return; }
      if (quota <= 0) { report.skipped.quota++; return; }
      const cid = String(p['Campaign ID'] || '');
      const v = versions[cid + '|' + String(p['Version'])];
      if (!v) { report.errors.push(p['Name'] + ': version ' + p['Version'] + ' missing'); return; }
      const subject = _fill_(v['Subject'], p);
      const body = _fill_(v['Body'], p);
      try {
        const msg = GmailApp.createDraft(to, subject, body, senderName ? { name: senderName } : {}).send();
        const threadId = msg.getThread().getId();
        const sentAt = new Date(now.getTime());
        newEmails.push({
          'ID': ids[idIdx++], 'Partner ID': p['ID'], 'Version': p['Version'], 'Step': 'first',
          'Scheduled For': sentAt, 'Sent At': sentAt, 'Gmail Thread ID': threadId, 'Gmail Message ID': msg.getId(),
          'Status': 'sent', 'Subject': subject, 'Sent By': me.email, 'Campaign ID': cid,
        });
        // Queue the one follow-up now; the reply check cancels it on any reply.
        if (String(v['Follow Up Body'] || '').trim()) {
          newEmails.push({
            'ID': ids[idIdx++], 'Partner ID': p['ID'], 'Version': p['Version'], 'Step': 'followup',
            'Scheduled For': _addBusinessDays_(sentAt, followDaysFor(cid)), 'Sent At': '', 'Gmail Thread ID': '', 'Gmail Message ID': '',
            'Status': 'queued', 'Subject': '', 'Sent By': '', 'Campaign ID': cid,
          });
        }
        partnerUpdates.push({ rowIndex: p._row, row: { 'Stage': 'Contacted', 'Last Contact': sentAt } });
        touchedVersions[cid + '|' + p['Version']] = true;
        report.sent++; quota--;
        _pause_();
      } catch (err) { report.errors.push(p['Name'] + ': ' + err.message); }
    });

    // 3. Write everything in as few calls as possible.
    _appendRows_(TAB.EMAILS, newEmails);
    _updateRows_(TAB.EMAILS, emailUpdates);
    _updateRows_(TAB.PARTNERS, partnerUpdates);
    Object.keys(touchedVersions).forEach(function (k) { const parts = k.split('|'); _lockVersion_(parts[1], parts[0]); });
    return report;
  } finally {
    lock.releaseLock();
  }
}

/**
 * "Send now" on a campaign page: this campaign's batch, today, regardless of
 * its sending days. Owner only; a person is still the one pressing it.
 */
function sendCampaignNow(campaignId) {
  _requireRole_(ADMIN_ROLES);
  const c = _campaignById_(campaignId);
  if (String(c['Status']) !== 'running') throw new Error('Press Start sending (or Resume) first; a paused or draft campaign cannot send.');
  return sendTodayBatch({ force: true, campaignId: String(campaignId) });
}

function _pause_() {
  const ms = SEND_PAUSE_MS[0] + Math.floor(Math.random() * (SEND_PAUSE_MS[1] - SEND_PAUSE_MS[0]));
  Utilities.sleep(ms);
}

/**
 * Send a plain-text reply inside an existing Gmail thread, so the realtor
 * sees one conversation. Uses the Gmail advanced service because GmailApp
 * cannot set In-Reply-To / threadId on a new message to a third party.
 */
function _sendInThread_(threadId, firstMessageId, to, subject, body) {
  let rfcId = '';
  try { const first = GmailApp.getMessageById(firstMessageId); if (first) rfcId = String(first.getHeader('Message-ID') || ''); } catch (err) { rfcId = ''; }
  const lines = [
    'To: ' + to,
    'Subject: ' + subject.replace(/[\r\n]+/g, ' '),
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (rfcId) { lines.push('In-Reply-To: ' + rfcId); lines.push('References: ' + rfcId); }
  const raw = lines.join('\r\n') + '\r\n\r\n' + body;
  const res = Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(raw), threadId: threadId }, 'me');
  return { id: res.id, threadId: res.threadId || threadId };
}

// ============================================================
// Reply check (Automations 5, 6, 7) — time-driven trigger
// ============================================================

/**
 * Look for new messages from anyone but us in the threads we started.
 * On a reply: reply event, email → replied, cancel the queued follow-up,
 * partner → Replied. Opt-out wording → do-not-contact + flagged for review.
 * Looks-like-an-address → event outcome "address?" for a person to confirm.
 * Bounces → email bounced, partner Bounced, follow-up cancelled.
 * Idempotent: every Gmail message id is recorded on its event.
 */
function checkReplies() {
  const me = _senderEmail_();
  const props = PropertiesService.getScriptProperties();
  const nowSec = Math.floor(Date.now() / 1000);
  const lastSec = parseInt(props.getProperty(PROP_LAST_REPLY_CHECK), 10) || (nowSec - REPLY_LOOKBACK_DAYS * 86400);
  const afterSec = Math.max(nowSec - REPLY_LOOKBACK_DAYS * 86400, lastSec - 2 * 86400); // overlap two days; dedupe handles repeats

  const emails = _readTab_(TAB.EMAILS);
  const byThread = {};
  emails.forEach(function (e) { if (e['Gmail Thread ID']) (byThread[e['Gmail Thread ID']] = byThread[e['Gmail Thread ID']] || []).push(e); });
  if (!Object.keys(byThread).length) { props.setProperty(PROP_LAST_REPLY_CHECK, String(nowSec)); return { checked: 0, replies: 0, bounces: 0, optOuts: 0, addresses: 0 }; }

  const seen = {};
  _readTab_(TAB.EVENTS).forEach(function (ev) { if (ev['Gmail Message ID']) seen[ev['Gmail Message ID']] = true; });
  const partners = {};
  _readTab_(TAB.PARTNERS).forEach(function (p) { partners[p['ID']] = p; });

  const report = { checked: 0, replies: 0, bounces: 0, optOuts: 0, addresses: 0 };
  const newEvents = [];
  const emailUpdates = [];
  const partnerUpdates = {};
  const dncPartners = {};

  const threads = GmailApp.search('after:' + afterSec + ' -from:' + me, 0, 500);
  threads.forEach(function (thread) {
    const tid = thread.getId();
    const ours = byThread[tid];
    if (!ours) return;
    report.checked++;
    const partnerId = ours[0]['Partner ID'];
    const p = partners[partnerId];
    if (!p) return;
    thread.getMessages().forEach(function (m) {
      const mid = m.getId();
      if (seen[mid]) return;
      const from = String(m.getFrom() || '').toLowerCase();
      if (from.indexOf(me) !== -1) return;                    // our own message
      if (m.getDate().getTime() / 1000 < afterSec) return;    // old
      seen[mid] = true;
      const subject = String(m.getSubject() || '');
      const body = _stripQuoted_(m.getPlainBody());
      const isBounce = BOUNCE_FROM_RE.test(from) || BOUNCE_SUBJECT_RE.test(subject);
      const sentRow = ours.filter(function (e) { return e['Status'] === 'sent' || e['Status'] === 'replied' || e['Status'] === 'bounced'; }).sort(function (a, b) { return String(b['Sent At']).localeCompare(String(a['Sent At'])); })[0] || ours[0];

      if (isBounce) {
        report.bounces++;
        newEvents.push({ 'Partner ID': partnerId, 'Home ID': '', 'Email ID': sentRow['ID'], 'Kind': 'bounce', 'Outcome': '', 'At': m.getDate(), 'Snippet': subject.slice(0, 160), 'By': 'trigger', 'Needs Review': '', 'Gmail Message ID': mid });
        emailUpdates.push({ rowIndex: sentRow._row, row: { 'Status': 'bounced' } });
        partnerUpdates[partnerId] = Object.assign(partnerUpdates[partnerId] || {}, { 'Response': 'Bounced' });
        return;
      }

      report.replies++;
      const optOut = OPT_OUT_RE.test(body);
      const address = !optOut && ADDRESS_RE.test(body);
      newEvents.push({ 'Partner ID': partnerId, 'Home ID': '', 'Email ID': sentRow['ID'], 'Kind': 'reply', 'Outcome': address ? 'address?' : '', 'At': m.getDate(), 'Snippet': body.slice(0, 300), 'By': 'trigger', 'Needs Review': address ? 'Yes' : '', 'Gmail Message ID': mid });
      if (address) report.addresses++;
      emailUpdates.push({ rowIndex: sentRow._row, row: { 'Status': 'replied' } });
      const pu = partnerUpdates[partnerId] || {};
      pu['Stage'] = pu['Stage'] === 'Partner' || p['Stage'] === 'Partner' ? 'Partner' : 'Replied';
      pu['Last Contact'] = m.getDate();
      if (!p['Response'] || p['Response'] === 'Replied' || p['Response'] === 'Bounced') pu['Response'] = 'Replied';
      if (optOut) {
        report.optOuts++;
        dncPartners[partnerId] = true;
        pu['Do Not Contact'] = 'Yes';
        pu['Response'] = 'Opted out';
        newEvents.push({ 'Partner ID': partnerId, 'Home ID': '', 'Email ID': sentRow['ID'], 'Kind': 'opt-out', 'Outcome': 'reply wording', 'At': m.getDate(), 'Snippet': body.slice(0, 160), 'By': 'trigger', 'Needs Review': 'Yes', 'Gmail Message ID': mid });
      }
      partnerUpdates[partnerId] = pu;
    });
  });

  // Any reply or bounce cancels the queued follow-up.
  const cancelFor = {};
  newEvents.forEach(function (ev) { cancelFor[ev['Partner ID']] = true; });
  emails.forEach(function (e) {
    if (cancelFor[e['Partner ID']] && e['Status'] === 'queued') emailUpdates.push({ rowIndex: e._row, row: { 'Status': 'cancelled' } });
  });

  if (newEvents.length) {
    const ids = _nextId_(TAB.EVENTS, newEvents.length);
    newEvents.forEach(function (ev, i) { ev['ID'] = ids[i]; });
    _appendRows_(TAB.EVENTS, newEvents);
  }
  _updateRows_(TAB.EMAILS, emailUpdates);
  _updateRows_(TAB.PARTNERS, Object.keys(partnerUpdates).map(function (id) { return { rowIndex: partners[id]._row, row: partnerUpdates[id] }; }));
  props.setProperty(PROP_LAST_REPLY_CHECK, String(nowSec));
  return report;
}

/** Drop quoted history ("On … wrote:", "> …") and signatures from a reply. */
function _stripQuoted_(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^On .{5,120}wrote:\s*$/.test(l.trim())) break;
    if (/^-{2,}\s*(Original Message|Forwarded message)/i.test(l.trim())) break;
    if (/^From:\s.+/.test(l) && i > 0) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

// ============================================================
// Triggers
// ============================================================

/** Install (or re-install) the reply-check trigger. Run as the deploying account. */
function installTriggers() {
  _requireRole_(ADMIN_ROLES);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'checkReplies') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkReplies').timeBased().everyMinutes(REPLY_CHECK_MINUTES).create();
  return getTriggerStatus();
}

function getTriggerStatus() {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  const installed = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'checkReplies'; });
  const last = parseInt(PropertiesService.getScriptProperties().getProperty(PROP_LAST_REPLY_CHECK), 10);
  return { installed: installed, everyMinutes: REPLY_CHECK_MINUTES, lastCheck: last ? new Date(last * 1000).toISOString() : '' };
}

/** Run the reply check by hand from the UI (owner), returns the report. */
function runReplyCheckNow() {
  _requireRole_(ADMIN_ROLES);
  return checkReplies();
}

// ============================================================
// Today screen: replies + call list
// ============================================================

/**
 * @param {{rep?: string}} opts  rep 'mine' (default for sales users) = the signed-in rep's partners + unassigned; 'all' = everyone
 * @return {{replies:Object[], calls:Object[], needsReview:Object[], scope:string}}
 *   replies: reply events from the last 7 days, newest first, with partner
 *   calls: partners who replied and have no call logged since, plus the Call Queue (e.g. emailed by hand) with no call since
 *          Last Contact; highest listing value first
 */
function getTodayWork(opts) {
  const session = _requireRole_(ROLES.map(function (r) { return r.key; }));
  opts = opts || {};
  const scope = opts.rep || (session.role === 'sales' ? 'mine' : 'all');
  const mine = function (p) { if (scope === 'all') return true; const r = _normEmail_(p['Rep']); return !r || r === (scope === 'mine' ? session.email : _normEmail_(scope)); };
  const partners = {};
  _readTab_(TAB.PARTNERS).forEach(function (p) { if (mine(p)) partners[p['ID']] = p; });
  const events = _readTab_(TAB.EVENTS);
  const weekAgo = Date.now() - 7 * 86400000;
  const lastReply = {}, lastCall = {}, lastMissed = {};
  events.forEach(function (ev) {
    const t = new Date(ev['At']).getTime();
    const pid = ev['Partner ID'];
    // a reply by email or a text they sent us both want a call back
    if ((ev['Kind'] === 'reply' || (ev['Kind'] === 'text' && ev['Direction'] === 'in')) && (!lastReply[pid] || lastReply[pid] < t)) lastReply[pid] = t;
    if (ev['Kind'] === 'call' && ev['Outcome'] === 'missed') { if (!lastMissed[pid] || lastMissed[pid] < t) lastMissed[pid] = t; return; }   // they called, we missed it: not a call we made
    if ((ev['Kind'] === 'call' || ev['Kind'] === 'voicemail') && (!lastCall[pid] || lastCall[pid] < t)) lastCall[pid] = t;
  });
  const listingValue = {};
  _readTab_(TAB.REFERRALS).forEach(function (r) { const v = Number(r['Listing Value']) || 0; if (v > (listingValue[r['Partner ID']] || 0)) listingValue[r['Partner ID']] = v; });

  const replies = events.filter(function (ev) { return (ev['Kind'] === 'reply' || (ev['Kind'] === 'text' && ev['Direction'] === 'in')) && new Date(ev['At']).getTime() >= weekAgo && partners[ev['Partner ID']]; })
    .sort(function (a, b) { return new Date(b['At']) - new Date(a['At']); })
    .map(function (ev) { return { event: ev, partner: partners[ev['Partner ID']] }; });

  const callIds = {};
  Object.keys(lastReply).forEach(function (id) {
    const p = partners[id];
    if (p && !_yes_(p['Do Not Contact']) && p['Response'] !== 'Not interested' && !(lastCall[id] && lastCall[id] >= lastReply[id])) callIds[id] = 'replied';
  });
  Object.keys(lastMissed).forEach(function (id) {
    const p = partners[id];
    if (p && !_yes_(p['Do Not Contact']) && p['Response'] !== 'Not interested' && !(lastCall[id] && lastCall[id] >= lastMissed[id]) && !callIds[id]) callIds[id] = 'missed';
  });
  Object.keys(partners).forEach(function (id) {
    const p = partners[id];
    if (!_yes_(p['Call Queue']) || _yes_(p['Do Not Contact']) || p['Response'] === 'Not interested') return;
    const since = p['Last Contact'] ? new Date(p['Last Contact']).getTime() : 0;
    if (lastCall[id] && lastCall[id] >= since) return;
    if (!callIds[id]) callIds[id] = 'queued';
  });
  const calls = Object.keys(callIds).map(function (id) { return Object.assign({ listingValue: listingValue[id] || 0, why: callIds[id] }, partners[id]); })
    .sort(function (a, b) { const rank = function (w) { return w === 'replied' ? 0 : w === 'missed' ? 1 : 2; }; return rank(a.why) - rank(b.why) || (b.listingValue - a.listingValue) || ((lastReply[b['ID']] || lastMissed[b['ID']] || 0) - (lastReply[a['ID']] || lastMissed[a['ID']] || 0)); });

  // the human queue: automation guesses on a known partner, plus calls/texts from numbers nobody knows (owner and "everyone" scope only)
  const needsReview = events.filter(function (ev) { return _yes_(ev['Needs Review']) && (partners[ev['Partner ID']] || (!ev['Partner ID'] && !ev['Home ID'] && scope === 'all')); })
    .map(function (ev) { return { event: ev, partner: partners[ev['Partner ID']] || null }; });
  return { replies: replies, calls: calls, needsReview: needsReview, scope: scope };
}

/** A person confirms or dismisses an automation's guess. */
function resolveReview(eventId, decision) {
  const me = _requireRole_(WRITE_ROLES);
  const ev = _byId_(TAB.EVENTS, eventId);
  if (!ev) throw new Error('Event not found: ' + eventId);
  const pIdx = _findRowIndex_(TAB.PARTNERS, function (p) { return String(p['ID']) === String(ev['Partner ID']); });
  if (decision === 'address' && pIdx !== -1) _updateRow_(TAB.PARTNERS, pIdx, { 'Response': 'Sent an address' });
  if (decision === 'not-opt-out' && pIdx !== -1) _updateRow_(TAB.PARTNERS, pIdx, { 'Do Not Contact': '', 'Response': 'Replied' });
  _updateRow_(TAB.EVENTS, ev._row, { 'Needs Review': '', 'By': me.email });
  return { ok: true };
}
