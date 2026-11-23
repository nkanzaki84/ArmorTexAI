const { test } = require('node:test');
const assert = require('node:assert/strict');
// Values built inside the fake VM have foreign prototypes; compare as plain JSON.
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com';

function csvOf(n, opts) {
  opts = opts || {};
  const lines = ['First Name,Last Name,Brokerage,Email,Phone,City'];
  for (let i = 1; i <= n; i++) {
    const co = opts.companies ? opts.companies[i % opts.companies.length] : 'Brokerage ' + (i % 7);
    lines.push(`Agent${i},Smith,"${co}",agent${i}@example.com,(903) 555-${String(1000 + i).slice(-4)},Longview`);
  }
  return lines.join('\n');
}

// deterministic rng
function seeded(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

test('import maps common headers, joins first/last, normalizes phone and email', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  const r = app.importPartners('First Name,Last Name,Brokerage,E-mail,Cell,City\nLoretta,Nelson,Keller Williams,Loretta@KW.com,(719) 598-2885,Hideaway', { sourceList: 'realtors-nov' });
  assert.equal(r.added, 1);
  const p = app.$rows('Partners')[0];
  assert.equal(p.ID, 'P-1');
  assert.equal(p.Name, 'Loretta Nelson');
  assert.equal(p.Email, 'loretta@kw.com');
  assert.equal(p.Phone, '7195982885');
  assert.equal(p.Company, 'Keller Williams');
  assert.equal(p.Area, 'Hideaway');
  assert.equal(p.Stage, 'Prospect');
  assert.equal(p.Version, '');
  assert.equal(p['Source List'], 'realtors-nov');
});

test('import skips no-email, duplicates (in file and existing) and do-not-contact', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  app.saveSettings({ do_not_contact: 'blocked@example.com\nOther@Example.com' });
  const first = app.importPartners('Name,Email\nA,a@example.com\nB,b@example.com\nNoMail,\nDup,a@example.com\nBlocked,blocked@example.com');
  deq({ added: first.added, skipped: first.skipped, columns: first.columns }, { added: 2, skipped: { noEmail: 1, duplicate: 1, doNotContact: 1, phoneOnly: 0, established: 0 }, columns: ['Name', 'Email'] });
  // mark B do-not-contact, then re-import the same file
  const b = app.$rows('Partners').find(p => p.Name === 'B');
  app.setPartnerDoNotContact(b.ID, true, 'asked');
  const second = app.importPartners('Name,Email\nA,a@example.com\nB,b@example.com\nC,c@example.com\nO,other@example.com');
  assert.equal(second.added, 1);
  assert.equal(second.skipped.duplicate, 1);     // A
  assert.equal(second.skipped.doNotContact, 2);  // B (flag) + other (setting)
  assert.equal(app.$rows('Partners').length, 3);
});

test('version assignment is even, balanced within brokerages, and never changes', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  app.importPartners(csvOf(500, { companies: ['KW', 'RE/MAX', 'Coldwell', 'eXp', 'Century 21'] }));
  const r = app.assignVersions({ rng: seeded(42) });
  assert.equal(r.assigned, 500);
  deq(r.counts, { A: 125, B: 125, C: 125, E: 125 });
  const rows = app.$rows('Partners');
  // every brokerage spread across versions
  const byCo = {};
  rows.forEach(p => { (byCo[p.Company] = byCo[p.Company] || {})[p.Version] = (byCo[p.Company][p.Version] || 0) + 1; });
  Object.keys(byCo).forEach(co => {
    const counts = Object.values(byCo[co]);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, co + ' uneven: ' + JSON.stringify(byCo[co]));
  });
  // re-running assigns nothing and changes nothing
  const before = rows.map(p => p.ID + ':' + p.Version).join(',');
  const again = app.assignVersions({ rng: seeded(7) });
  assert.equal(again.assigned, 0);
  assert.equal(app.$rows('Partners').map(p => p.ID + ':' + p.Version).join(','), before);
  // new partners added later get versions without touching old ones
  app.importPartners('Name,Email,Brokerage\nNew1,n1@example.com,KW\nNew2,n2@example.com,KW');
  const third = app.assignVersions({ rng: seeded(1) });
  assert.equal(third.assigned, 2);
  assert.equal(app.$rows('Partners').slice(0, 500).map(p => p.ID + ':' + p.Version).join(','), before);
});

test('assignVersions can be limited to the versions that are ready (A, B, C)', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  app.importPartners(csvOf(30));
  const r = app.assignVersions({ versions: ['A', 'B', 'C'], rng: seeded(3) });
  deq(r.counts, { A: 10, B: 10, C: 10 });
  assert.ok(app.$rows('Partners').every(p => p.Version !== 'E'));
});

test('partner record: save, log call, do-not-contact cancels queued emails', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  const id = app.addPartner({ name: 'Pat Realtor', email: 'pat@example.com', phone: '903-555-0101', company: 'KW' });
  app.savePartner(id, { nextStep: 'Call Tue', response: 'Replied' });
  app.logPartnerEvent(id, 'call', 'talked', 'Wants a sample report');
  // queue an email by hand, then opt out
  app._appendRows_('Emails', [{ ID: 'E-1', 'Partner ID': id, Version: 'A', Step: 'followup', 'Scheduled For': new Date(), Status: 'queued' }]);
  app.setPartnerDoNotContact(id, true, 'replied no thanks');
  const rec = app.getPartner(id);
  assert.equal(rec.partner['Next Step'], 'Call Tue');
  assert.equal(rec.partner['Do Not Contact'], 'Yes');
  assert.equal(rec.partner.Response, 'Opted out');
  assert.ok(rec.partner['Last Contact']);
  assert.equal(rec.emails[0].Status, 'cancelled');
  deq(rec.events.map(e => e.Kind), ['call', 'opt-out']);
  assert.throws(() => app.savePartner(id, { response: 'Maybe' }), /Unknown response/);
  assert.throws(() => app.addPartner({ name: 'Dup', email: 'PAT@example.com' }), /already exists/);
});

test('established partners import straight into the book and never enter the email test', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  const r = app.importPartners('Name,Company,Phone,Email,Area,Notes\nTammy Kessler,Texas Real Estate Executives,903-261-5684,tjkessler01@gmail.com,Gladewater,\nKarl Crawford,Keller Williams,903-520-5152,k.crawford@kw.com,Tyler,vendor list', { sourceList: 'established-realtors', established: true });
  assert.equal(r.added, 2);
  const book = app.listPartners({ section: 'partners' });
  assert.equal(book.length, 2);
  assert.ok(book.every(p => p.Stage === 'Partner' && p['Partner Since'] && p.Version === ''));
  assert.equal(app.listPartners({ section: 'prospects' }).length, 0);
  // prospects imported normally, then versions: only the prospects get one
  app.importPartners('Name,Email\nNew Realtor,new@example.com');
  const a = app.assignVersions({ versions: ['A', 'B', 'C'] });
  assert.equal(a.assigned, 1);
  assert.ok(app.listPartners({ section: 'partners' }).every(p => p.Version === ''));
  // even with a version forced on, the batch skips the book
  app._updateRows_('Partners', app.listPartners({ section: 'partners' }).map(p => ({ rowIndex: p._row, row: { Version: 'A' } })));
  app.saveSettings({ business_address: 'X', opt_out_line: 'Reply no' });
  app.saveVersion('A', { subject: 's', body: 'hi?\nX\nReply no' });
  const b = app.buildTodayBatch({ now: new Date('2026-12-01T15:00:00Z') });
  deq(b.firsts.map(p => p.Name), ['New Realtor']);
  // recount keeps them in the book (Partner Since), no emails or wins needed
  app.recountPartnerStages();
  assert.equal(app.listPartners({ section: 'partners' }).length, 2);
});

test('import keeps phone-only rows, takes the first of two emails, moves "(Team)" and call notes into Notes', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  const r = app.importPartners('Name,Phone Number,Brokerage,Email,Area,Notes,Call Notes\n' +
    'Sherry Watson (Crown Jewel Realty Team),903-649-0397,Miller Home Group,sherryw.mhg@gmail.com,Gladewater,Sent,Has a roofer but will add us\n' +
    'Lisa Williams,903-555-0101,KW,lisawilliams.realtor0@gmail.com; lwillimas0363@gmail.com,Tyler,,\n' +
    'No Email Guy,903-555-0102,KW,,Tyler,,Called and LVM\n' +
    'No Email Guy Again,903-555-0102,KW,,Tyler,,\n' +
    'Nobody,,,,Tyler,,');
  deq(r.skipped, { noEmail: 1, duplicate: 1, doNotContact: 0, phoneOnly: 1, established: 0 });
  assert.equal(r.added, 3);
  const ps = app.$rows('Partners');
  assert.equal(ps[0].Name, 'Sherry Watson');
  assert.equal(ps[0].Notes, 'Crown Jewel Realty Team · Sent · Has a roofer but will add us');
  assert.equal(ps[1].Email, 'lisawilliams.realtor0@gmail.com');
  assert.equal(ps[2].Email, ''); assert.equal(ps[2].Phone, '9035550102'); assert.equal(ps[2].Notes, 'Called and LVM');
  // phone-only prospects get a version but never a batch slot (no address to send to)
  app.assignVersions({ versions: ['A', 'B', 'C'] });
  app.saveSettings({ business_address: 'X', opt_out_line: 'Reply no' });
  ['A', 'B', 'C'].forEach(l => app.saveVersion(l, { subject: 's', body: 'hi?\nX\nReply no' }));
  const b = app.buildTodayBatch({ now: new Date('2026-12-01T15:00:00Z') });
  assert.ok(!b.firsts.some(p => p.Name === 'No Email Guy'));
});

test('import finds the header row under a title block, skips a leading empty column, and reads Status = Active Partner', () => {
  const app = loadApp({ user: OWNER });
  app.setup();
  const csv = ',Realtor Contact Directory,,,,\n,8,8,0,8\n,Total Contacts,Active Partners,Prospects,Brokerages\n' +
    ',Realtor Name,Brokerage,Phone,Email,Market Area,Status,Notes\n' +
    ',Tammy Kessler,Texas Real Estate Executives,903-261-5684,tjkessler01@gmail.com,Gladewater,Active Partner,\n' +
    ',Someone New,KW,903-555-0100,new@x.com,Tyler,Prospect,sent 11/3\n';
  const r = app.importPartners(csv, { sourceList: 'eight', rep: 'brian@armortexroofs.com' });
  assert.equal(r.added, 2);
  assert.equal(r.skipped.established, 1);
  assert.equal(r.queuedForCalls, 1);
  const ps = app.$rows('Partners');
  assert.equal(ps[0].Name, 'Tammy Kessler'); assert.equal(ps[0].Stage, 'Partner'); assert.ok(ps[0]['Partner Since']); assert.equal(ps[0].Area, 'Gladewater');
  assert.equal(ps[1].Name, 'Someone New'); assert.equal(ps[1].Stage, 'Contacted'); assert.equal(ps[1]['Call Queue'], 'Yes');
  assert.throws(() => app.importPartners('just,some,numbers\n1,2,3'), /No header row found/);
});
