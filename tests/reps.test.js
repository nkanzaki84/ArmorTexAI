const { test } = require('node:test');
const assert = require('node:assert/strict');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const { loadApp } = require('./fakes/apps-script');

const OWNER = 'brian@armortexroofs.com', TANNER = 'tanner@armortexroofs.com';
const TUE = new Date('2026-12-01T15:00:00Z');
function app() {
  const a = loadApp({ user: OWNER });
  a.setup();
  a.saveUser({ email: TANNER, name: 'Tanner Fought', role: 'sales' });
  a.saveSettings({ business_address: 'X', opt_out_line: 'Reply no' });
  ['A', 'B', 'C'].forEach(l => a.saveVersion(l, { subject: 's', body: 'hi?\nX\nReply no' }));
  return a;
}
const LEADS = 'Name,Phone Number,Brokerage,Email,Area,Notes,Call Notes\n' +
  'Terri Searcy,903-363-3601,TREE,terri@x.com,Gladewater,Sent,Called and LVM\n' +
  'Carla Conley,903-547-1845,TREE,carla@x.com,Gladewater,sent 11/3,\n' +
  'Magda Oviedo,903-985-2049,Real Broker,magda@x.com,Kilgore,Bilingual | sent,\n' +
  'Fresh Face,903-000-0001,KW,fresh@x.com,Tyler,,\n' +
  'Also Fresh,903-000-0002,KW,also@x.com,Tyler,,';

test('hand-emailed rows go to the call list, not the email test; rep set on import', () => {
  const a = app();
  const r = a.importPartners(LEADS, { sourceList: 'tyler', rep: TANNER });
  assert.equal(r.added, 5); assert.equal(r.queuedForCalls, 3); assert.equal(r.rep, TANNER);
  const ps = a.$rows('Partners');
  const carla = ps.find(p => p.Name === 'Carla Conley');
  assert.equal(carla.Stage, 'Contacted'); assert.equal(carla['Skip Email Test'], 'Yes'); assert.equal(carla['Call Queue'], 'Yes'); assert.equal(carla.Rep, TANNER);
  assert.equal(new Date(carla['Last Contact']).toISOString().slice(0, 10), '2026-11-03');
  assert.equal(ps.find(p => p.Name === 'Fresh Face').Stage, 'Prospect');
  // versions only for the fresh ones; batch only the fresh ones
  const v = a.assignVersions({ versions: ['A', 'B', 'C'] });
  assert.equal(v.assigned, 2);
  deq(a.buildTodayBatch({ now: TUE }).firsts.map(p => p.Name).sort(), ['Also Fresh', 'Fresh Face']);
  // recount keeps Contacted for the hand-emailed
  a.recountPartnerStages();
  assert.equal(a.$rows('Partners').find(p => p.Name === 'Carla Conley').Stage, 'Contacted');
  // Tanner's Today call list has the three, oldest-contacted first after replied ones; a logged call clears one
  a.$as(TANNER);
  let w = a.getTodayWork();
  assert.equal(w.scope, 'mine');
  deq(w.calls.map(p => p.Name).sort(), ['Carla Conley', 'Magda Oviedo', 'Terri Searcy']);
  assert.ok(w.calls.every(p => p.why === 'queued'));
  a.logPartnerEvent(carla.ID, 'call', 'talked', 'in');
  w = a.getTodayWork();
  deq(w.calls.map(p => p.Name).sort(), ['Magda Oviedo', 'Terri Searcy']);
  // owner sees everyone by default and can narrow to a rep
  a.$as(OWNER);
  assert.equal(a.getTodayWork().scope, 'all');
  assert.equal(a.getTodayWork({ rep: TANNER }).calls.length, 2);
  assert.equal(a.getTodayWork({ rep: OWNER }).calls.length, 0, 'unassigned only; nothing is Brian\'s');
});

test('rep: mine filter, unassigned counts as mine, retrofit on an imported list, manual call queue', () => {
  const a = app();
  a.importPartners(LEADS, { sourceList: 'tyler', handSentToCalls: false });   // imported the old way: nobody queued, no rep
  assert.ok(a.$rows('Partners').every(p => p.Rep === '' && p['Call Queue'] === ''));
  a.assignVersions({ versions: ['A', 'B', 'C'] });
  assert.equal(a.$rows('Partners').filter(p => p.Version).length, 5, 'all five got versions before the fix');
  const fix = a.applyHandSentRule('tyler');
  assert.equal(fix.updated, 3);
  assert.equal(a.buildTodayBatch({ now: TUE }).firsts.length, 2, 'hand-emailed drop out of the batch even with a version');
  const rep = a.assignRepToList('tyler', TANNER);
  assert.equal(rep.updated, 5);
  assert.throws(() => a.assignRepToList('tyler', 'nobody@x.com'), /Not on the team/);
  // mine filter for Tanner: his 5; for Brian: unassigned only
  a.$as(TANNER);
  assert.equal(a.listPartners({ section: 'marketing', rep: 'mine' }).length, 5);
  const id = a.addPartner({ name: 'Walk In', email: 'walk@x.com' });
  assert.equal(a.getPartner(id).partner.Rep, TANNER, 'sales adds default to themselves');
  a.$as(OWNER);
  assert.equal(a.listPartners({ section: 'marketing', rep: 'mine' }).length, 0);
  a.savePartner(id, { rep: '' });
  assert.equal(a.listPartners({ section: 'marketing', rep: 'mine' }).length, 1);
  assert.throws(() => a.savePartner(id, { rep: 'stranger@x.com' }), /Not on the team/);
  // manual queue toggle
  a.setCallQueue(id, true);
  assert.ok(a.getTodayWork().calls.some(p => p.ID === id));
  a.setCallQueue(id, false);
  assert.ok(!a.getTodayWork().calls.some(p => p.ID === id));
  deq(a.listSourceLists().map(l => l.sourceList), ['tyler', 'manual']);
  deq(a.listTeamContacts().map(u => u.email), [OWNER, TANNER]);
});

test('established partners import under a rep and show in the book as theirs', () => {
  const a = app();
  a.importPartners('Name,Company,Phone,Email,Area\nTammy Kessler,TREE,903-261-5684,tj@x.com,Gladewater', { sourceList: 'established', established: true, rep: TANNER });
  const book = a.listPartners({ section: 'partners' });
  assert.equal(book[0].Rep, TANNER);
  a.$as(TANNER);
  assert.equal(a.listPartners({ section: 'partners', rep: 'mine' }).length, 1);
});
