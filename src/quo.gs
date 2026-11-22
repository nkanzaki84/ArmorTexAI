/**
 * ArmorTex Outreach — quo.gs
 * The phone system. Tanner calls and texts realtors from Quo (ex-OpenPhone);
 * Quo posts each call, recording, transcript, summary, voicemail and text to
 * this web app, and we write it on the partner's record as an Event.
 *
 * Shape of the integration (decided 2026-11-22, see docs/IDEAS.md):
 *   - The API key is pasted on Settings → Quo and lives in Script Properties.
 *   - We register ONE webhook with Quo, pointed at this app's /exec URL with
 *     ?src=quo&token=<random>. Apps Script can't read request headers, so the
 *     token in the URL is the gate; the delivery is a nudge, and the call or
 *     message is re-fetched from Quo's API with our key before it is stored.
 *     A forged post therefore cannot put anything in the Sheet.
 *   - Matching is by phone number (last 10 digits) against Partners, then
 *     Homes. An unknown number becomes an Event with Needs Review = Yes.
 *   - Everything that a browser may call starts with _requireRole_(ADMIN_ROLES).
 *     Functions that end in _ are internal and not reachable from the browser.
 *
 * Quo's API (read 2026-11-22): https://api.quo.com, `Authorization: <key>`
 * (no Bearer), 10 requests/second. Webhook endpoints need the header
 * `Quo-Api-Version: 2026-03-30`; the v1 resource endpoints do not.
 * Transcripts and summaries only exist on Quo's Business and Scale plans.
 */

// ============================================================
// 1. Settings page: key, numbers, webhook
// ============================================================

/** Everything the Settings → Quo card shows. Owner only. */
function quoStatus() {
  _requireRole_(ADMIN_ROLES);
  const key = _quoKey_();
  const props = PropertiesService.getScriptProperties();
  let lastHook = null;
  try { lastHook = JSON.parse(props.getProperty(PROP_QUO_LAST_HOOK) || 'null'); } catch (err) { lastHook = null; }
  return {
    keySet: !!key,
    keyTail: key ? key.slice(-4) : '',
    numbers: _quoJsonSetting_(SETTING.QUO_NUMBERS, []),
    watch: _quoJsonSetting_(SETTING.QUO_WATCH, []),
    hookUrl: String(_setting_(SETTING.QUO_HOOK_URL) || ''),
    webhookId: String(_setting_(SETTING.QUO_WEBHOOK_ID) || ''),
    webhookUrl: String(_setting_(SETTING.QUO_WEBHOOK_URL) || '').replace(/token=[^&]+/, 'token=…'),
    events: QUO_HOOK_EVENTS,
    lastHook: lastHook,
    lastError: String(props.getProperty(PROP_QUO_LAST_ERROR) || ''),
    callLinks: String(_setting_(SETTING.QUO_CALL_LINKS) || '') === 'Yes',
    appUrl: ScriptApp.getService().getUrl(),
  };
}

/** Save the API key, then prove it works by listing the workspace's numbers. */
function saveQuoApiKey(key) {
  _requireRole_(ADMIN_ROLES);
  key = String(key || '').trim();
  if (!key) throw new Error('Paste the API key first.');
  if (/\s/.test(key)) throw new Error('That does not look like an API key (it has spaces).');
  const props = PropertiesService.getScriptProperties();
  const previous = props.getProperty(PROP_QUO_API_KEY);
  props.setProperty(PROP_QUO_API_KEY, key);
  try {
    quoRefreshNumbers();
  } catch (err) {
    if (previous) props.setProperty(PROP_QUO_API_KEY, previous); else props.deleteProperty(PROP_QUO_API_KEY);
    throw new Error('Quo rejected that key: ' + err.message);
  }
  return quoStatus();
}

/** Forget the key (and the webhook, which is useless without it). */
function clearQuoApiKey() {
  _requireRole_(ADMIN_ROLES);
  try { quoRemoveWebhook(); } catch (err) { /* best effort */ }
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_QUO_API_KEY);
  props.deleteProperty(PROP_QUO_WEBHOOK_KEY);
  return quoStatus();
}

/** Re-read the workspace's numbers and users from Quo. */
function quoRefreshNumbers() {
  _requireRole_(ADMIN_ROLES);
  const users = {};
  (_quoOk_(_quoFetch_('get', '/v1/users'), 'list users').data || []).forEach(function (u) {
    users[u.id] = { email: String(u.email || '').toLowerCase(), name: [u.firstName, u.lastName].filter(Boolean).join(' ') };
  });
  const numbers = (_quoOk_(_quoFetch_('get', '/v1/phone-numbers'), 'list phone numbers').data || []).map(function (n) {
    return {
      id: n.id, number: n.number || n.formattedNumber || '', name: n.name || '',
      users: (n.users || []).map(function (u) { const known = users[u.id] || {}; return known.email || u.email || u.id; }),
    };
  });
  _setSetting_(SETTING.QUO_NUMBERS, JSON.stringify(numbers));
  _setSetting_(SETTING.QUO_USERS, JSON.stringify(users));
  // first time: watch everything
  if (!_quoJsonSetting_(SETTING.QUO_WATCH, []).length) _setSetting_(SETTING.QUO_WATCH, JSON.stringify(numbers.map(function (n) { return n.id; })));
  return quoStatus();
}

/** Which Quo numbers we log. Changing it re-registers the webhook if there is one. */
function saveQuoWatch(ids) {
  _requireRole_(ADMIN_ROLES);
  const known = _quoJsonSetting_(SETTING.QUO_NUMBERS, []).map(function (n) { return n.id; });
  const keep = (ids || []).map(String).filter(function (id) { return known.indexOf(id) !== -1; });
  if (!keep.length) throw new Error('Pick at least one number.');
  _setSetting_(SETTING.QUO_WATCH, JSON.stringify(keep));
  if (_setting_(SETTING.QUO_WEBHOOK_ID)) quoRegisterWebhook(_setting_(SETTING.QUO_HOOK_URL));
  return quoStatus();
}

/**
 * Tell Quo where to post. hookUrl is this web app's /exec URL (a deployment
 * with access "Anyone"). Replaces any webhook we registered before.
 */
function quoRegisterWebhook(hookUrl) {
  _requireRole_(ADMIN_ROLES);
  hookUrl = String(hookUrl || '').trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(hookUrl)) throw new Error('The hook URL must be this web app\'s /exec address (https://script.google.com/…/exec). The /dev address does not accept posts from outside.');
  // The /dev door and the /exec door have different deployment ids; a /dev id with "/exec" on the end is not a real address.
  const devUrl = String(_appDevUrl_(ScriptApp.getService().getUrl()) || '');
  const devId = (devUrl.match(/\/s\/([^\/]+)\/dev/) || [])[1];
  if (devId && hookUrl.indexOf('/s/' + devId + '/') !== -1) throw new Error('That is the /dev deployment\'s id with /exec on the end, which Google answers with a sign-in page. Copy the Web app URL from Apps Script → Deploy → Manage deployments instead.');
  const watch = _quoJsonSetting_(SETTING.QUO_WATCH, []);
  if (!watch.length) throw new Error('Pick which number(s) to log first.');
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty(PROP_QUO_HOOK_TOKEN);
  if (!token) { token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty(PROP_QUO_HOOK_TOKEN, token); }
  const url = hookUrl + '?src=quo&token=' + token;
  // out with the old
  const oldId = String(_setting_(SETTING.QUO_WEBHOOK_ID) || '');
  if (oldId) { try { _quoFetch_('delete', '/webhooks/' + encodeURIComponent(oldId), null, true); } catch (err) { /* gone already */ } }
  const created = _quoOk_(_quoFetch_('post', '/webhooks', { url: url, events: QUO_HOOK_EVENTS, resourceIds: watch, label: 'ArmorTex Outreach' }, true), 'create webhook').data || {};
  if (!created.id) throw new Error('Quo did not return a webhook id.');
  _setSetting_(SETTING.QUO_HOOK_URL, hookUrl);
  _setSetting_(SETTING.QUO_WEBHOOK_ID, String(created.id));
  _setSetting_(SETTING.QUO_WEBHOOK_URL, url);
  if (created.key) props.setProperty(PROP_QUO_WEBHOOK_KEY, String(created.key));
  props.deleteProperty(PROP_QUO_LAST_ERROR);
  return quoStatus();
}

/** Delete our webhook at Quo and forget it. */
function quoRemoveWebhook() {
  _requireRole_(ADMIN_ROLES);
  const id = String(_setting_(SETTING.QUO_WEBHOOK_ID) || '');
  if (id && _quoKey_()) { try { _quoFetch_('delete', '/webhooks/' + encodeURIComponent(id), null, true); } catch (err) { /* best effort */ } }
  _setSetting_(SETTING.QUO_WEBHOOK_ID, '');
  _setSetting_(SETTING.QUO_WEBHOOK_URL, '');
  return quoStatus();
}

/**
 * Ask Quo to post a sample event at us, then report what Quo saw. The sample
 * uses made-up ids, so our receiver records it but stores nothing.
 */
function quoSendTestEvent(eventType) {
  _requireRole_(ADMIN_ROLES);
  const id = String(_setting_(SETTING.QUO_WEBHOOK_ID) || '');
  if (!id) throw new Error('Register the webhook first.');
  eventType = QUO_HOOK_EVENTS.indexOf(String(eventType)) !== -1 ? String(eventType) : 'call.completed';
  PropertiesService.getScriptProperties().deleteProperty(PROP_QUO_LAST_HOOK);
  _quoOk_(_quoFetch_('post', '/webhooks/' + encodeURIComponent(id) + '/events/test', { eventType: eventType }, true), 'send test event');
  Utilities.sleep(4000);
  return quoDeliveries();
}

/** Quo's own log of its last deliveries to us: did they succeed from Quo's side? */
function quoDeliveries() {
  _requireRole_(ADMIN_ROLES);
  const id = String(_setting_(SETTING.QUO_WEBHOOK_ID) || '');
  if (!id) return { deliveries: [], status: quoStatus() };
  const r = _quoFetch_('get', '/webhooks/' + encodeURIComponent(id) + '/events?limit=10', null, true);
  const list = (r.code >= 200 && r.code < 300 && r.json && r.json.data) ? r.json.data : [];
  // the newest few in detail: what our URL answered on each attempt (the 302 question)
  const deliveries = list.slice(0, 5).map(function (d) {
    const out = { id: d.id, eventType: d.eventType, status: d.status, createdAt: d.createdAt, nextAttemptAt: d.nextAttemptAt || null, attempts: [] };
    const det = _quoFetch_('get', '/webhooks/' + encodeURIComponent(id) + '/events/' + encodeURIComponent(d.id), null, true);
    const attempts = (det.code >= 200 && det.code < 300 && det.json && det.json.data && det.json.data.attempts) || [];
    out.attempts = attempts.map(function (a) {
      return { at: a.timestamp, status: a.status, code: a.responseStatusCode, ms: a.responseDurationMs, body: String(a.responseBody || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240) };
    });
    return out;
  });
  return { deliveries: deliveries, status: quoStatus() };
}

// ============================================================
// 2. Receiving: doPost → _quoReceive_ → _quoHandleEvent_
// ============================================================

/**
 * Called by doPost. Checks the token, parses the body, handles the event,
 * and remembers what happened for the Settings card. Never throws for a bad
 * post; returns a small JSON object either way.
 */
function _quoReceive_(params, raw, now) {
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty(PROP_QUO_HOOK_TOKEN) || '';
  const given = String((params && params.token) || '');
  if (!expected || !_quoSameString_(given, expected)) { _quoNoteError_('post with a bad token'); return { ok: false, error: 'bad token' }; }
  let envelope = null;
  try { envelope = JSON.parse(String(raw || '')); } catch (err) { envelope = null; }
  if (!envelope || typeof envelope !== 'object' || !envelope.type) { _quoNoteError_('post that was not JSON'); return { ok: false, error: 'not json' }; }
  let result;
  try { result = _quoHandleEvent_(envelope, now || new Date()); }
  catch (err) { result = { action: 'error', reason: err.message }; _quoNoteError_(envelope.type + ': ' + err.message); }
  props.setProperty(PROP_QUO_LAST_HOOK, JSON.stringify({ at: (now || new Date()).toISOString(), type: envelope.type, eventId: envelope.id || '', result: result }));
  return { ok: true, result: result };
}

/**
 * One Quo event → one Events row (new or updated). Pure of HTTP except for
 * the verification fetch, so tests can drive it with a fake UrlFetchApp.
 * Returns { action: 'added'|'updated'|'ignored'|'review', ... }.
 */
function _quoHandleEvent_(envelope, now) {
  const type = String(envelope.type || '');
  const data = envelope.data || {};
  const res = data.resource || {};
  const ctx = data.context || {};
  const users = _quoJsonSetting_(SETTING.QUO_USERS, {});
  const by = (users[ctx.userId] && users[ctx.userId].email) || 'quo';
  const other = _quoOtherParty_(type, res, ctx);          // E.164 or ''

  if (/^call\./.test(type)) {
    const callId = String(res.callId || res.id || '');
    if (!callId) return { action: 'ignored', reason: 'no call id' };
    const verified = _quoVerify_('/v1/calls/' + encodeURIComponent(callId));
    if (!verified.ok) return { action: 'ignored', reason: 'Quo could not confirm call ' + callId + ' (' + verified.code + ')' };
    const call = verified.data || {};
    const phone = _quoDigits_(other || _quoExternalParticipant_(call.participants, ctx));
    const existing = _quoFindEvent_(callId);
    const patch = {};
    if (type === 'call.completed') {
      Object.assign(patch, _quoCallRow_(call, res, phone, by, now));
    } else if (type === 'call.recording.completed') {
      const rec = (res.recordings || []).filter(function (r) { return r && r.url; })[0];
      if (rec) patch['Recording URL'] = rec.url;
      if (!existing) Object.assign(patch, _quoCallRow_(call, res, phone, by, now), rec ? { 'Recording URL': rec.url } : {});
    } else if (type === 'call.transcript.completed') {
      if (res.processingStatus && res.processingStatus !== 'completed') return { action: 'ignored', reason: 'transcript ' + res.processingStatus };
      patch['Transcript'] = _quoDialogueText_(res.dialogue, users);
      if (!existing) Object.assign(patch, _quoCallRow_(call, res, phone, by, now), { 'Transcript': patch['Transcript'] });
    } else if (type === 'call.summary.completed') {
      if (res.processingStatus && res.processingStatus !== 'completed') return { action: 'ignored', reason: 'summary ' + res.processingStatus };
      const lines = (res.summary || []).concat((res.nextSteps || []).map(function (s) { return 'Next: ' + s; }));
      patch['Snippet'] = lines.join(' ').slice(0, 2000);
      if (!existing) Object.assign(patch, _quoCallRow_(call, res, phone, by, now), { 'Snippet': patch['Snippet'] });
    } else if (type === 'call.voicemail.completed') {
      patch['Outcome'] = 'voicemail';
      if (res.recordingUrl) patch['Recording URL'] = res.recordingUrl;
      if (res.transcript) patch['Transcript'] = String(res.transcript).slice(0, 20000);
      if (!existing) Object.assign(patch, _quoCallRow_(call, res, phone, by, now), patch);
    } else {
      return { action: 'ignored', reason: 'unhandled ' + type };
    }
    return _quoUpsertEvent_(existing, patch, callId, phone, now, type);
  }

  if (/^message\./.test(type)) {
    const msgId = String(res.id || '');
    if (!msgId) return { action: 'ignored', reason: 'no message id' };
    if (type !== 'message.received' && type !== 'message.delivered') return { action: 'ignored', reason: 'unhandled ' + type };
    const verified = _quoVerify_('/v1/messages/' + encodeURIComponent(msgId));
    if (!verified.ok) return { action: 'ignored', reason: 'Quo could not confirm message ' + msgId + ' (' + verified.code + ')' };
    const msg = verified.data || {};
    const direction = (res.direction || msg.direction) === 'incoming' ? 'in' : 'out';
    const phone = _quoDigits_(other || (direction === 'in' ? msg.from : (msg.to || [])[0]));
    const existing = _quoFindEvent_(msgId);
    const row = {
      'Kind': 'text', 'Outcome': direction === 'in' ? 'received' : 'sent', 'Direction': direction,
      'At': _quoDate_(res.createdAt || msg.createdAt, now),
      'Snippet': String(res.text !== undefined ? res.text : (msg.text || '')).slice(0, 2000),
      'Phone': phone, 'By': direction === 'in' ? 'quo' : by, 'Source': 'quo', 'Source ID': msgId,
    };
    return _quoUpsertEvent_(existing, row, msgId, phone, now, type);
  }

  return { action: 'ignored', reason: 'unhandled ' + type };
}

/** The Events row for a call, from Quo's call record (API) plus the event's resource. */
function _quoCallRow_(call, res, phone, by, now) {
  const direction = (call.direction || res.direction) === 'incoming' ? 'in' : 'out';
  const status = String(res.status || call.status || '');
  const duration = Number(res.duration !== undefined && res.duration !== null ? res.duration : call.duration) || 0;
  let outcome;
  if (status === 'answered' || status === 'completed' || status === 'in-progress') outcome = 'talked';
  else if (direction === 'in') outcome = 'missed';
  else outcome = 'no_answer';
  if (res.hasVoicemail && outcome !== 'talked') outcome = 'voicemail';
  return {
    'Kind': 'call', 'Outcome': outcome, 'Direction': direction, 'Duration': duration,
    'At': _quoDate_(res.completedAt || call.completedAt || res.createdAt || call.createdAt, now),
    'Phone': phone, 'By': direction === 'in' ? 'quo' : by, 'Source': 'quo', 'Source ID': String(res.callId || res.id || call.id || ''),
  };
}

/** Write or update the Events row, attach it to a partner/home by phone, bump Last Contact. */
function _quoUpsertEvent_(existing, patch, sourceId, phone, now, type) {
  const match = phone ? _quoMatchByPhone_(phone) : null;
  if (existing) {
    const upd = {};
    Object.keys(patch).forEach(function (k) { if (patch[k] !== undefined && patch[k] !== '' && patch[k] !== null) upd[k] = patch[k]; });
    // never un-assign a partner a person attached by hand
    if (match && !existing['Partner ID'] && !existing['Home ID']) { upd[match.column] = match.id; upd['Needs Review'] = ''; }
    delete upd['At'];   // the first write set the time
    _updateRow_(TAB.EVENTS, existing._row, upd);
    if (match && match.column === 'Partner ID') _quoBumpLastContact_(match.id, existing['At'], upd['Outcome'] || existing['Outcome'], upd['Direction'] || existing['Direction']);
    return { action: 'updated', eventId: existing['ID'], partnerId: match && match.column === 'Partner ID' ? match.id : '', type: type };
  }
  const id = _nextId_(TAB.EVENTS);
  const row = Object.assign({ 'ID': id, 'Partner ID': '', 'Home ID': '', 'Email ID': '', 'Needs Review': '' }, patch);
  if (match) row[match.column] = match.id;
  else { row['Needs Review'] = 'Yes'; row['Snippet'] = ['Unknown number ' + _quoPretty_(phone), row['Snippet']].filter(Boolean).join(' · '); }
  _appendRows_(TAB.EVENTS, [row]);
  if (match && match.column === 'Partner ID') _quoBumpLastContact_(match.id, row['At'], row['Outcome'], row['Direction']);
  return { action: match ? 'added' : 'review', eventId: id, partnerId: match && match.column === 'Partner ID' ? match.id : '', homeId: match && match.column === 'Home ID' ? match.id : '', type: type };
}

/** A call we made or a conversation either way counts as contact; a missed incoming call does not. */
function _quoBumpLastContact_(partnerId, at, outcome, direction) {
  if (outcome === 'missed' || (direction === 'in' && outcome === 'no_answer')) return;
  const idx = _findRowIndex_(TAB.PARTNERS, function (p) { return String(p['ID']) === String(partnerId); });
  if (idx === -1) return;
  const p = _readTab_(TAB.PARTNERS).filter(function (r) { return r._row === idx; })[0];
  const t = new Date(at);
  if (p && p['Last Contact'] && new Date(p['Last Contact']).getTime() >= t.getTime()) return;
  _updateRow_(TAB.PARTNERS, idx, { 'Last Contact': t });
}

/** Turn "call through the Quo app" on or off. */
function saveQuoCallLinks(on) {
  _requireRole_(ADMIN_ROLES);
  _setSetting_(SETTING.QUO_CALL_LINKS, on ? 'Yes' : '');
  return quoStatus();
}

/**
 * What the pages need to build Call / Text links: whether to open the Quo app,
 * and which Quo number to call from (the first watched number). Safe for every
 * role; nothing secret in it.
 */
function _quoLinkConfig_() {
  try {
    const on = String(_setting_(SETTING.QUO_CALL_LINKS) || '') === 'Yes';
    const watch = _quoJsonSetting_(SETTING.QUO_WATCH, []);
    const numbers = _quoJsonSetting_(SETTING.QUO_NUMBERS, []);
    const first = numbers.filter(function (n) { return watch.indexOf(n.id) !== -1; })[0] || numbers[0] || null;
    return { viaApp: on && !!first, from: first ? String(first.number || '') : '' };
  } catch (err) { return { viaApp: false, from: '' }; }
}

// ============================================================
// 3. Helpers
// ============================================================

function _quoKey_() { return String(PropertiesService.getScriptProperties().getProperty(PROP_QUO_API_KEY) || '').trim(); }

function _quoJsonSetting_(name, fallback) {
  try { const v = JSON.parse(String(_setting_(name) || '')); return v === null || v === undefined ? fallback : v; } catch (err) { return fallback; }
}

function _quoNoteError_(msg) {
  try { PropertiesService.getScriptProperties().setProperty(PROP_QUO_LAST_ERROR, new Date().toISOString() + ' ' + String(msg).slice(0, 300)); } catch (err) { /* ignore */ }
}

/** One HTTP call to Quo. versioned = the dated webhook API (needs the version header). */
function _quoFetch_(method, path, body, versioned) {
  const key = _quoKey_();
  if (!key) throw new Error('Quo API key is not set. Settings → Quo.');
  const headers = { 'Authorization': key };
  if (versioned) headers['Quo-Api-Version'] = QUO_API_VERSION;
  const params = { method: method, headers: headers, muteHttpExceptions: true };
  if (body) { params.contentType = 'application/json'; params.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(QUO_API + path, params);
  const text = res.getContentText() || '';
  let json = null;
  try { json = JSON.parse(text); } catch (err) { json = null; }
  return { code: res.getResponseCode(), json: json, text: text };
}

function _quoOk_(r, what) {
  if (r.code >= 200 && r.code < 300) return r.json || {};
  const msg = (r.json && (r.json.message || (r.json.error && r.json.error.message))) || r.text.slice(0, 200) || 'no details';
  throw new Error('Quo ' + what + ' failed (' + r.code + '): ' + msg);
}

/** Re-fetch the resource Quo says changed. Without a key nothing is ever stored. */
function _quoVerify_(path) {
  if (!_quoKey_()) return { ok: false, code: 'no key' };
  const r = _quoFetch_('get', path);
  if (r.code < 200 || r.code >= 300) return { ok: false, code: r.code };
  return { ok: true, data: (r.json && r.json.data) || r.json || {} };
}

/** The external party's number from an event (E.164), or ''. */
function _quoOtherParty_(type, res, ctx) {
  if (/^message\./.test(type)) {
    if (res.direction === 'incoming') return String(ctx.senderIdentifier || '');
    return String((ctx.recipientIdentifiers || [])[0] || '');
  }
  if (res.from && res.to) return String(res.direction === 'incoming' ? res.from : res.to);
  const ext = ctx.participants && ctx.participants.external;
  return String((ext && ext[0]) || '');
}

/** From Quo's call record: participants minus our own numbers. */
function _quoExternalParticipant_(participants, ctx) {
  const ours = ((ctx.participants && ctx.participants.workspace) || []).concat(_quoJsonSetting_(SETTING.QUO_NUMBERS, []).map(function (n) { return n.number; }));
  const list = (participants || []).map(String).filter(function (p) { return ours.indexOf(p) === -1; });
  return list[0] || '';
}

function _quoDigits_(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

function _quoPretty_(digits) {
  const d = String(digits || '');
  return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : (d || 'withheld');
}

/** Partners first (by phone digits), then Homes. Returns {column, id} or null. */
function _quoMatchByPhone_(digits) {
  if (!digits || digits.length < 7) return null;
  const p = _readTab_(TAB.PARTNERS).filter(function (r) { return _quoDigits_(r['Phone']) === digits; })[0];
  if (p) return { column: 'Partner ID', id: p['ID'] };
  const h = _readTab_(TAB.HOMES).filter(function (r) { return _quoDigits_(r['Phone']) === digits; })[0];
  if (h) return { column: 'Home ID', id: h['ID'] };
  return null;
}

function _quoFindEvent_(sourceId) {
  if (!sourceId) return null;
  return _readTab_(TAB.EVENTS).filter(function (e) { return String(e['Source']) === 'quo' && String(e['Source ID']) === String(sourceId); })[0] || null;
}

function _quoDate_(iso, fallback) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? d : (fallback || new Date());
}

function _quoDialogueText_(dialogue, users) {
  return (dialogue || []).map(function (line) {
    const who = line.userId ? ((users[line.userId] && (users[line.userId].name || users[line.userId].email)) || 'us') : (line.identifier || 'them');
    return who + ': ' + String(line.content || '');
  }).join('\n').slice(0, 20000);
}

function _quoSameString_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
