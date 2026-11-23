// ============================================================
// AI reply reading (built 2026-11-23, Brian: "if they say yes or 'would be
// cool to see', send the sample automatically"). Gemini, one call per reply.
// The key lives in Script Properties (GEMINI_API_KEY), never in the Sheet.
// Modes (Settings → AI reply reading, `ai_sample_mode`):
//   off      nothing is read
//   suggest  a "yes" puts a one-tap card on Today; a person presses Send
//   auto     a "yes" sends the sample report at once, logged on the record
// Never more than one sample per person; never to do-not-contact.
// ============================================================

function _geminiKey_() { return String(PropertiesService.getScriptProperties().getProperty(PROP_GEMINI_API_KEY) || '').trim(); }

/** Models the key can use for generateContent, newest-looking first. */
function _geminiModels_(key) {
  const res = UrlFetchApp.fetch(GEMINI_API + '/models?pageSize=100', { method: 'get', headers: { 'x-goog-api-key': key }, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Gemini did not accept the key (HTTP ' + code + '). ' + _geminiErrText_(res.getContentText()));
  const body = JSON.parse(res.getContentText() || '{}');
  return (body.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1; })
    .map(function (m) { return { id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || m.name }; })
    .sort(function (a, b) { return b.id.localeCompare(a.id); });
}

function _geminiErrText_(text) {
  try { const j = JSON.parse(text); return (j.error && j.error.message) ? String(j.error.message) : ''; } catch (err) { return String(text || '').slice(0, 200); }
}

/** Pick a sensible default from the list: the newest plain "flash" model. */
function _geminiPickDefault_(models) {
  const flash = models.filter(function (m) { return /flash/i.test(m.id) && !/lite|preview|exp|tts|image|audio|live|thinking/i.test(m.id); });
  return (flash[0] || models[0] || { id: GEMINI_DEFAULT_MODEL }).id;
}

/** Settings → paste key: proves it by listing models, stores it, picks a model if none is set. */
function saveGeminiKey(key) {
  _requireRole_(ADMIN_ROLES);
  key = String(key || '').trim();
  if (!key) throw new Error('Paste the Gemini API key first.');
  const models = _geminiModels_(key);
  PropertiesService.getScriptProperties().setProperty(PROP_GEMINI_API_KEY, key);
  if (!_setting_(SETTING.AI_GEMINI_MODEL)) _setSetting_(SETTING.AI_GEMINI_MODEL, _geminiPickDefault_(models));
  return aiStatus();
}

function clearGeminiKey() {
  _requireRole_(ADMIN_ROLES);
  PropertiesService.getScriptProperties().deleteProperty(PROP_GEMINI_API_KEY);
  _setSetting_(SETTING.AI_SAMPLE_MODE, 'off');
  return aiStatus();
}

function aiStatus() {
  _requireRole_(ADMIN_ROLES);
  const key = _geminiKey_();
  const out = { connected: !!key, mode: _aiMode_(), model: _setting_(SETTING.AI_GEMINI_MODEL) || '', models: [], sampleReady: !!String(_setting_(SETTING.SAMPLE_REPORT_FILE) || '').trim(), error: '' };
  if (key) { try { out.models = _geminiModels_(key); } catch (err) { out.error = err.message; } }
  return out;
}

function saveAiSettings(payload) {
  _requireRole_(ADMIN_ROLES);
  payload = payload || {};
  if (payload.mode !== undefined) {
    const mode = String(payload.mode || 'off');
    if (AI_SAMPLE_MODES.indexOf(mode) === -1) throw new Error('Mode must be off, suggest or auto.');
    if (mode !== 'off' && !_geminiKey_()) throw new Error('Save a Gemini key first.');
    _setSetting_(SETTING.AI_SAMPLE_MODE, mode);
  }
  if (payload.model !== undefined) _setSetting_(SETTING.AI_GEMINI_MODEL, String(payload.model || '').trim());
  return aiStatus();
}

function _aiMode_() {
  const m = String(_setting_(SETTING.AI_SAMPLE_MODE) || 'off');
  return AI_SAMPLE_MODES.indexOf(m) === -1 ? 'off' : m;
}

const AI_SAMPLE_SYSTEM = [
  'You read short email replies for a residential roofing company in East Texas.',
  'Context: the company emailed a real estate agent (or home inspector, insurance agent, or property manager) offering a free sample roof report',
  'on their listings, and the email ended by asking whether they would like to see a sample.',
  'Decide whether the reply says YES to seeing the sample report.',
  'verdict "yes": they want the sample, however casually ("sure", "yeah send it", "would be cool to see", "ok", "please do", "sounds good").',
  'verdict "no": they decline, are not interested, ask not to be contacted, or say the timing is wrong.',
  'verdict "unclear": anything else: a question, an out-of-office, a request to call, a different topic, or you cannot tell.',
  'If they say yes but also ask for something else (a call, a different property), still answer "yes" and mention the extra ask in the reason.',
  'Answer only with JSON: {"verdict": "yes"|"no"|"unclear", "reason": "<one short sentence>"}.',
].join(' ');

/**
 * One call: did this reply say yes to the sample report?
 * Never throws: a failure comes back as {verdict:'unclear', reason:'error: …'} so the reply check carries on.
 */
function _aiClassifyReply_(replyText) {
  const key = _geminiKey_();
  if (!key) return { verdict: 'unclear', reason: 'error: no Gemini key' };
  const model = _setting_(SETTING.AI_GEMINI_MODEL) || GEMINI_DEFAULT_MODEL;
  const text = String(replyText || '').trim().slice(0, 4000);
  if (!text) return { verdict: 'unclear', reason: 'empty reply' };
  const body = {
    systemInstruction: { parts: [{ text: AI_SAMPLE_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: 'Reply from the agent:\n\n' + text }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { verdict: { type: 'STRING', enum: ['yes', 'no', 'unclear'] }, reason: { type: 'STRING' } }, required: ['verdict', 'reason'] },
    },
  };
  try {
    const res = UrlFetchApp.fetch(GEMINI_API + '/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) return { verdict: 'unclear', reason: 'error: Gemini HTTP ' + code + ' ' + _geminiErrText_(res.getContentText()).slice(0, 120) };
    const j = JSON.parse(res.getContentText() || '{}');
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const raw = parts.map(function (p) { return p.text || ''; }).join('').trim();
    const m = raw.match(/\{[\s\S]*\}/);
    const out = JSON.parse(m ? m[0] : raw);
    const verdict = ['yes', 'no', 'unclear'].indexOf(String(out.verdict || '').toLowerCase()) !== -1 ? String(out.verdict).toLowerCase() : 'unclear';
    return { verdict: verdict, reason: String(out.reason || '').slice(0, 300) };
  } catch (err) {
    return { verdict: 'unclear', reason: 'error: ' + String(err.message || err).slice(0, 160) };
  }
}

/** Settings → "Try it": classify any text so Brian can see what it does. */
function aiTestClassify(text) {
  _requireRole_(ADMIN_ROLES);
  if (!_geminiKey_()) throw new Error('Save a Gemini key first.');
  return _aiClassifyReply_(text);
}

/**
 * Called at the end of checkReplies with the reply events just written.
 * Reads each one, stores the verdict on the event, and on "yes" either sends
 * the sample (auto) or leaves a card on Today (suggest). Owner's trigger runs this.
 */
function _aiHandleReplies_(replyEvents, now) {
  const mode = _aiMode_();
  const out = { read: 0, yes: 0, sent: 0, suggested: 0, errors: 0 };
  if (mode === 'off' || !replyEvents.length) return out;
  if (!String(_setting_(SETTING.SAMPLE_REPORT_FILE) || '').trim()) return out;   // nothing to send: do not spend calls
  now = now || new Date();
  const partners = {};
  _readTab_(TAB.PARTNERS).forEach(function (p) { partners[p['ID']] = p; });
  const sampled = {};
  _readTab_(TAB.EMAILS).forEach(function (e) { if (e['Step'] === 'sample report') sampled[e['Partner ID']] = true; });
  replyEvents.forEach(function (ev) {
    if (ev['Kind'] !== 'reply') return;
    const p = partners[ev['Partner ID']];
    if (!p || _yes_(p['Do Not Contact']) || !String(p['Email'] || '').trim()) return;
    const idx = _findRowIndex_(TAB.EVENTS, function (r) { return String(r['ID']) === String(ev['ID']); });
    if (idx === -1) return;
    const r = _aiClassifyReply_(ev['Snippet']);
    out.read++;
    if (/^error:/.test(r.reason)) out.errors++;
    const row = { 'AI Verdict': r.verdict, 'AI Reason': r.reason, 'AI Action': '' };
    if (r.verdict === 'yes') {
      out.yes++;
      if (sampled[p['ID']]) row['AI Action'] = 'already sent';
      else if (mode === 'auto') {
        try { sendSampleReport(p['ID'], {}, now); row['AI Action'] = 'sent'; sampled[p['ID']] = true; out.sent++; }
        catch (err) { row['AI Action'] = 'error: ' + String(err.message || err).slice(0, 160); out.errors++; }
      } else { row['AI Action'] = 'suggested'; out.suggested++; }
    }
    _updateRow_(TAB.EVENTS, idx, row);
  });
  return out;
}

/** Today's card: a person presses Send on a suggested sample. */
function sendSuggestedSample(eventId) {
  _requireRole_(WRITE_ROLES);
  const ev = _byId_(TAB.EVENTS, eventId);
  if (!ev) throw new Error('Event not found: ' + eventId);
  const r = sendSampleReport(ev['Partner ID'], {}, new Date());
  _updateRow_(TAB.EVENTS, ev._row, { 'AI Action': 'sent' });
  return r;
}

function dismissSampleSuggestion(eventId) {
  const me = _requireRole_(WRITE_ROLES);
  const ev = _byId_(TAB.EVENTS, eventId);
  if (!ev) throw new Error('Event not found: ' + eventId);
  _updateRow_(TAB.EVENTS, ev._row, { 'AI Action': 'dismissed by ' + me.email });
  return { ok: true };
}
