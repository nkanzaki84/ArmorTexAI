// ============================================================
// Sample roof report (the warm tier's one tool, 2026-11-23)
// A stock PDF kept in Drive, sent from the partner record with one
// press as a reply in the realtor's own thread. Plain text + the file.
// Settings: sample_report_file (Drive link or id), subject, body template.
// ============================================================

/** The Drive file behind the setting, or null when nothing is set. Throws when the link is bad. */
function _sampleReportFile_() {
  const raw = String(_setting_(SETTING.SAMPLE_REPORT_FILE) || '').trim();
  if (!raw) return null;
  // a folder link: use the one PDF inside it
  const fm = raw.match(/\/folders\/([-\w]+)/);
  if (fm) {
    let folder;
    try { folder = DriveApp.getFolderById(fm[1]); } catch (err) { throw new Error('Cannot open that Drive folder. (' + err.message + ')'); }
    const pdfs = [];
    const it = folder.getFilesByType('application/pdf');
    while (it.hasNext()) pdfs.push(it.next());
    if (!pdfs.length) throw new Error('That folder has no PDF in it. Upload the report there, or paste the PDF\'s own link (right-click the file → Share → Copy link).');
    if (pdfs.length > 1) throw new Error('That folder has ' + pdfs.length + ' PDFs (' + pdfs.map(function (f) { return f.getName(); }).join(', ') + '). Paste the link of the one to send: right-click it → Share → Copy link.');
    return pdfs[0];
  }
  // a file link (…/d/<id>/… or ?id=<id>) or a bare file id
  const m = raw.match(/\/d\/([-\w]+)/) || raw.match(/[?&]id=([-\w]+)/) || (/^[-\w]+$/.test(raw) ? [null, raw] : null);
  if (!m) throw new Error('That does not look like a Drive link. In Drive, right-click the PDF → Share → Copy link, and paste that.');
  try { return DriveApp.getFileById(m[1]); } catch (err) { throw new Error('Cannot open the sample report in Drive. Is it in ' + OWNER_EMAIL + '\'s Drive or shared with it? (' + err.message + ')'); }
}

/** Settings → "Check file": proves the link opens and shows what would go out. */
function checkSampleReport(link) {
  _requireRole_(ADMIN_ROLES);
  if (link !== undefined) _setSetting_(SETTING.SAMPLE_REPORT_FILE, String(link || '').trim());
  const f = _sampleReportFile_();
  if (!f) return { ok: false, message: 'No file set yet. Paste the Drive link of the PDF.' };
  const size = f.getSize ? f.getSize() : 0;
  return { ok: true, name: f.getName(), mime: f.getMimeType(), size: size, url: f.getUrl ? f.getUrl() : '', pdf: /pdf/i.test(String(f.getMimeType())) };
}

function _sampleMerge_(tpl, p, rep) {
  const name = String(p['Name'] || '').trim();
  return String(tpl || '').replace(/\{\{(\w+)\}\}/g, function (_, k) {
    if (k === 'first') return name.split(/\s+/)[0] || 'there';
    if (k === 'name') return name;
    if (k === 'company') return String(p['Company'] || '');
    if (k === 'area') return String(p['Area'] || '');
    if (k === 'rep') return rep;
    if (k === 'address') return String(_setting_(SETTING.BUSINESS_ADDRESS) || '');
    return '';
  });
}

/** Which thread the sample should ride in: the latest email we sent this person that has a Gmail thread. */
function _sampleThreadFor_(partnerId) {
  const rows = _readTab_(TAB.EMAILS).filter(function (e) { return String(e['Partner ID']) === String(partnerId) && e['Gmail Thread ID'] && e['Sent At']; });
  // the conversation they replied to comes first; an earlier sample's own thread only as a fallback
  rows.sort(function (a, b) { return ((a['Step'] === 'sample report') - (b['Step'] === 'sample report')) || (new Date(b['Sent At']).getTime() - new Date(a['Sent At']).getTime()); });
  return rows[0] || null;
}

/** What the record shows before sending: to, subject, merged body, thread, file. */
function previewSampleReport(partnerId) {
  const session = _requireRole_(WRITE_ROLES);
  const p = _byId_(TAB.PARTNERS, partnerId);
  if (!p) throw new Error('Partner not found: ' + partnerId);
  const settings = _settings_();
  const rep = session.name || String(settings[SETTING.SENDER_NAME] || '').trim() || 'ArmorTex Roofs';
  const thread = _sampleThreadFor_(partnerId);
  let file = null;
  try { const f = _sampleReportFile_(); if (f) file = { name: f.getName(), mime: f.getMimeType() }; } catch (err) { file = { error: err.message }; }
  return {
    to: String(p['Email'] || ''),
    subject: thread ? 'Re: ' + String(thread['Subject'] || '').replace(/^Re:\s*/i, '') : _sampleMerge_(settings[SETTING.SAMPLE_REPORT_SUBJECT], p, rep),
    body: _sampleMerge_(settings[SETTING.SAMPLE_REPORT_BODY], p, rep),
    inThread: !!thread,
    threadSubject: thread ? String(thread['Subject'] || '') : '',
    file: file,
    blocked: _yes_(p['Do Not Contact']) ? 'do-not-contact' : !String(p['Email'] || '').trim() ? 'no email' : '',
  };
}

/**
 * Send the sample report to one person, now. A person presses it.
 * Replies inside the latest thread when there is one (so the realtor sees one
 * conversation), else a fresh email. Logs an Emails row (Step 'sample report')
 * and bumps Last Contact. Do-not-contact is checked at the moment of sending.
 */
function sendSampleReport(partnerId, payload, now) {
  const session = _requireRole_(WRITE_ROLES);
  payload = payload || {};
  now = now || new Date();
  const p = _byId_(TAB.PARTNERS, partnerId);
  if (!p) throw new Error('Partner not found: ' + partnerId);
  const to = _normEmail_(p['Email']);
  if (!to) throw new Error('This person has no email address.');
  if (_yes_(p['Do Not Contact']) || _doNotContactEmails_().indexOf(to) !== -1) throw new Error('This person is marked do-not-contact. Nothing was sent.');
  const file = _sampleReportFile_();
  if (!file) throw new Error('No sample report file is set. Owner: Settings → Sample roof report.');
  let quota = Infinity;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (err) { quota = Infinity; }
  if (quota < 1) throw new Error('Gmail has no sending room left today. Try tomorrow.');

  const settings = _settings_();
  const rep = session.name || String(settings[SETTING.SENDER_NAME] || '').trim() || 'ArmorTex Roofs';
  const body = String(payload.body !== undefined ? payload.body : _sampleMerge_(settings[SETTING.SAMPLE_REPORT_BODY], p, rep)).trim();
  if (!body) throw new Error('Write a note to go with the report.');
  const thread = _sampleThreadFor_(partnerId);
  const blob = file.getBlob();
  const senderName = String(settings[SETTING.SENDER_NAME] || '').trim();
  let subject, sent;
  if (thread) {
    subject = String(payload.subject || ('Re: ' + String(thread['Subject'] || '').replace(/^Re:\s*/i, ''))).trim();
    sent = _sendInThread_(thread['Gmail Thread ID'], thread['Gmail Message ID'], to, subject, body, [blob]);
  } else {
    subject = String(payload.subject || _sampleMerge_(settings[SETTING.SAMPLE_REPORT_SUBJECT], p, rep)).trim();
    const opts = { attachments: [blob] };
    if (senderName) opts.name = senderName;
    const msg = GmailApp.sendEmail(to, subject, body, opts);
    sent = { id: msg.getId(), threadId: msg.getThread().getId() };
  }
  _appendRows_(TAB.EMAILS, [{
    'Partner ID': String(p['ID']), 'Version': String(p['Version'] || ''), 'Step': 'sample report',
    'Scheduled For': new Date(now.getTime()), 'Sent At': new Date(now.getTime()),
    'Gmail Thread ID': sent.threadId, 'Gmail Message ID': sent.id, 'Status': 'sent', 'Subject': subject,
    'Sent By': session.email, 'Campaign ID': '',
  }]);
  _updateRow_(TAB.PARTNERS, p._row, { 'Last Contact': new Date(now.getTime()) });
  return { ok: true, inThread: !!thread, subject: subject, file: file.getName() };
}
