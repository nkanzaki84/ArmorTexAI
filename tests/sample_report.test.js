// The sample roof report: a stock PDF in Drive, sent from the record as a
// reply in the realtor's thread (or a fresh email), logged, DNC-checked.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';
const TANNER = 'tanner@armortexroofs.com';

function appWithFile(ctx) {
  const app = loadApp(ctx);
  app.setup();
  app.saveUser({ email: TANNER, name: 'Tanner', role: 'sales' });
  app.saveSettings({ business_address: '3310 South Broadway Ave, Ste 225A, Tyler, TX 75701' });
  const g = app;
  const file = g.DriveApp.getRootFolder().createFile(g.Utilities.newBlob('%PDF-1.4 sample', 'application/pdf', 'ArmorTex sample roof report.pdf'));
  return { app, file };
}

test('sample report: owner sets the file, record previews it, send replies in the thread with the PDF', () => {
  const { app, file } = appWithFile({ user: OWNER });
  assert.equal(app.checkSampleReport('').ok, false);
  const chk = app.checkSampleReport('https://drive.google.com/file/d/' + file.getId() + '/view');
  assert.equal(chk.ok, true);
  assert.equal(chk.name, 'ArmorTex sample roof report.pdf');
  assert.equal(app.getSettings().sample_report_file, 'https://drive.google.com/file/d/' + file.getId() + '/view');
  // a folder link works when the folder holds exactly one PDF
  const g = app;
  const fld = g.DriveApp.getRootFolder().createFolder('Reports');
  assert.throws(() => app.checkSampleReport('https://drive.google.com/drive/folders/' + fld.getId()), /no PDF/);
  fld.createFile(g.Utilities.newBlob('%PDF-1.4 a', 'application/pdf', 'only.pdf'));
  assert.equal(app.checkSampleReport('https://drive.google.com/drive/folders/' + fld.getId()).name, 'only.pdf');
  fld.createFile(g.Utilities.newBlob('%PDF-1.4 b', 'application/pdf', 'second.pdf'));
  assert.throws(() => app.checkSampleReport('https://drive.google.com/drive/folders/' + fld.getId()), /2 PDFs/);
  assert.throws(() => app.checkSampleReport('https://example.com/x'), /does not look like a Drive link/);
  app.checkSampleReport('https://drive.google.com/file/d/' + file.getId() + '/view');

  const id = app.addPartner({ type: 'realtor', name: 'Loretta Nelson', email: 'loretta@example.com', company: 'KW' });
  // no thread yet → a fresh email with the default subject
  let pv = app.previewSampleReport(id);
  assert.equal(pv.inThread, false);
  assert.equal(pv.subject, 'Sample roof report from ArmorTex');
  assert.match(pv.body, /^Hi Loretta,/);
  assert.match(pv.body, /Brian\nArmorTex Roofs\n3310 South Broadway/);
  assert.equal(pv.file.name, 'ArmorTex sample roof report.pdf');
  let r = app.sendSampleReport(id, {}, new Date('2026-12-02T16:00:00Z'));
  assert.equal(r.inThread, false);
  let mails = app.GmailApp.$sent;
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'loretta@example.com');
  assert.equal(mails[0].opts.attachments[0].getName(), 'ArmorTex sample roof report.pdf');
  let rows = app.$rows('Emails').filter(e => e['Partner ID'] === id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Step, 'sample report');
  assert.equal(rows[0].Status, 'sent');
  assert.equal(rows[0]['Campaign ID'], '', 'not part of any campaign\'s numbers');
  assert.ok(app.getPartner(id).partner['Last Contact']);

  // with a thread (the campaign email she replied to) → a reply inside it, multipart with the PDF
  const t = app.GmailApp.createDraft('loretta@example.com', 'Free roof report on your listings', 'hi', {}).send();
  app._appendRows_('Emails', [{ ID: 'E-50', 'Partner ID': id, Version: 'A', Step: 'first', 'Sent At': new Date('2026-12-01T15:00:00Z'), 'Gmail Thread ID': t.getThread().getId(), 'Gmail Message ID': t.getId(), Status: 'replied', Subject: 'Free roof report on your listings', 'Campaign ID': 'CP-1' }]);
  pv = app.previewSampleReport(id);
  assert.equal(pv.inThread, true);
  assert.equal(pv.subject, 'Re: Free roof report on your listings');
  r = app.sendSampleReport(id, { body: 'Here it is, Loretta.' }, new Date('2026-12-03T16:00:00Z'));
  assert.equal(r.inThread, true);
  mails = app.GmailApp.$sent;
  const last = mails[mails.length - 1];
  assert.equal(last.threadId, t.getThread().getId());
  assert.equal(last.subject, 'Re: Free roof report on your listings');
  assert.match(last.raw, /multipart\/mixed/);
  assert.match(last.raw, /Here it is, Loretta\./);
  assert.match(last.raw, /filename="ArmorTex sample roof report.pdf"/);
  assert.match(last.raw, /In-Reply-To: </);
});

test('sample report: refused without a file, for do-not-contact, for no email; sales can send, viewonly cannot', () => {
  const { app, file } = appWithFile({ user: OWNER });
  const id = app.addPartner({ type: 'realtor', name: 'Ann', email: 'ann@example.com' });
  assert.throws(() => app.sendSampleReport(id), /No sample report file/);
  app.saveSettings({ sample_report_file: file.getId() });
  const noMail = app.addPartner({ type: 'realtor', name: 'Nobody', email: '' });
  assert.throws(() => app.sendSampleReport(noMail), /no email/);
  app.setPartnerDoNotContact(id, true);
  assert.throws(() => app.sendSampleReport(id), /do-not-contact/);
  assert.equal(app.previewSampleReport(id).blocked, 'do-not-contact');
  app.setPartnerDoNotContact(id, false);
  app.saveSettings({ sample_report_file: 'x' });
  assert.throws(() => app.sendSampleReport(id), /Cannot open the sample report/);
  app.saveSettings({ sample_report_file: file.getId() });
  app.saveUser({ email: 'c@armortexroofs.com', name: 'C', role: 'viewonly' });
  app.$as('c@armortexroofs.com');
  assert.throws(() => app.sendSampleReport(id), /cannot do that/);
  app.$as(TANNER);
  const r = app.sendSampleReport(id, {}, new Date());
  assert.equal(r.ok, true);
  const m = app.GmailApp.$sent[app.GmailApp.$sent.length - 1];
  assert.match(m.body, /\nTanner\nArmorTex Roofs/);
});
