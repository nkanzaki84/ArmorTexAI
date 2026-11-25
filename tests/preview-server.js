#!/usr/bin/env node
/**
 * Local preview of the web app with NO Google account: renders the Apps
 * Script templates and routes google.script.run calls into the fake runtime.
 *
 *   node tests/preview-server.js            # http://127.0.0.1:8787/?page=today
 *   node tests/preview-server.js --empty    # no sample data
 *   PORT=9000 node tests/preview-server.js
 *
 * Switch user with ?as=tanner@armortexroofs.com (sticks until changed).
 * Data lives in memory and resets when the server restarts.
 */
const http = require('node:http');
const { URL } = require('node:url');
const { loadApp } = require('./fakes/apps-script');

const PORT = Number(process.env.PORT || 8787);
const OWNER = 'brian@armortexroofs.com';
const ctx = { user: OWNER, appUrl: 'http://127.0.0.1:' + PORT + '/exec', quota: 1500 };
const app = loadApp(ctx);
app.setup();

if (process.argv.indexOf('--empty') === -1) seed(app);

function seed(app) {
  const ADDRESS = '3310 South Broadway Ave, Ste 225A, Tyler, TX 75701';
  const OPT = "Reply 'no thanks' and I won't email again.";
  app.saveSettings({ business_address: ADDRESS, opt_out_line: OPT, call_script_url: 'https://docs.google.com/document/d/example', dev_url: 'http://127.0.0.1:' + PORT + '/dev' });
  app.saveUser({ email: 'tanner@armortexroofs.com', name: 'Tanner Fought', role: 'sales' });
  app.saveUser({ email: 'caitlin@armortexroofs.com', name: 'Caitlin', role: 'viewonly' });
  const bodies = {
    A: `Hi {{first}},\n\nI'm Brian with ArmorTex Roofs in Gladewater. When a listing has an older roof, buyers and insurers push back and the deal slows down.\n\nWe do a free photo roof report on any listing within 48 hours, so you know what you're dealing with before the inspector does.\n\nWant me to send over a sample report?\n\nBrian Kanzaki\nArmorTex Roofs\n${ADDRESS}\n${OPT}`,
    B: `Hi {{first}},\n\nI'm Brian with ArmorTex Roofs. Insurers around Gregg County are balking at roofs over 15 years, and it's stalling closings.\n\nWe do a free photo roof report on any listing within 48 hours so you can get ahead of it.\n\nWant me to send over a sample report?\n\nBrian Kanzaki\nArmorTex Roofs\n${ADDRESS}\n${OPT}`,
    C: `Hi {{first}},\n\nI'm Brian with ArmorTex Roofs. Our roof report is a short photo write-up with a grade and a plain recommendation. Realtors use it to settle roof questions before they cost a deal.\n\nIt's free on any listing, within 48 hours. Want me to send over a sample report?\n\nBrian Kanzaki\nArmorTex Roofs\n${ADDRESS}\n${OPT}`,
  };
  ['A', 'B', 'C'].forEach(l => app.saveVersion(l, { angle: { A: 'speed', B: 'insurance', C: 'proof' }[l], subject: 'Free roof report on your listings, 48 hours', body: bodies[l], followUpBody: 'Hi {{first}}, just checking in. Still happy to send a sample roof report if useful?' }));
  const names = ['Loretta Nelson', 'Marcus Reed', 'Dana Whitfield', 'Gerald Ortiz', 'Pam Ortiz', 'Tom Baker', 'Alicia Grant', 'Ray Delgado', 'Kim Tran', 'Scott Pierce', 'Nora Blake', 'Hank Morrow', 'Judy Lane', 'Omar Haddad', 'Faye Collins', 'Luis Mora', 'Erin Walsh', 'Doug Perry', 'Tess Monroe', 'Vic Santos'];
  const cos = ['Keller Williams', 'RE/MAX Pros', 'Coldwell Banker', 'eXp Realty', 'Century 21 Premier'];
  const cities = ['Longview', 'White Oak', 'Gladewater', 'Kilgore', 'Hallsville'];
  const lines = ['Name,Email,Brokerage,Phone,City'];
  for (let i = 0; i < 180; i++) {
    const n = names[i % names.length] + (i >= names.length ? ' ' + (Math.floor(i / names.length) + 1) : '');
    lines.push(`${n},${n.toLowerCase().replace(/[^a-z]+/g, '.').replace(/\.$/, '')}${i}@example.com,${cos[i % cos.length]},903555${String(1000 + i).slice(-4)},${cities[i % cities.length]}`);
  }
  app.importPartners(lines.join('\n'), { sourceList: 'realtors-gregg-nov-2026' });
  // a few of the other partner types, with profiles filled in, so each tab has something to show
  const others = [
    ['inspector', 'Carl Dawson', 'East Texas Home Inspections', 'carl@ethi.example.com', '9035550201', 'Longview', { 'Inspections Per Month': 35, 'Refers Roofers': 'Sometimes', 'Areas Served': 'Longview, Kilgore' }],
    ['inspector', 'Maria Vega', 'Pine Curtain Inspections', 'maria@pci.example.com', '9035550202', 'Gladewater', { 'Inspections Per Month': 18, 'Refers Roofers': 'No', 'Areas Served': 'Gladewater, White Oak' }],
    ['insurance', 'Dale Pruitt', 'State Farm — Pruitt Agency', 'dale@sf.example.com', '9035550301', 'Longview', { 'Carriers': 'State Farm', 'Handles Claims': 'Yes', 'Areas Served': 'Gregg County' }],
    ['insurance', 'Renee Holt', 'Farm Bureau Longview', 'renee@fb.example.com', '9035550302', 'Longview', { 'Carriers': 'Texas Farm Bureau', 'Handles Claims': 'No', 'Areas Served': 'Longview' }],
    ['property_manager', 'Greg Albright', 'Albright Property Management', 'greg@apm.example.com', '9035550401', 'Longview', { 'Doors Managed': 140, 'Property Types': 'single family, duplex', 'Decision Maker': 'Yes' }],
  ];
  others.forEach(o => {
    const id = app.addPartner({ type: o[0], name: o[1], company: o[2], email: o[3], phone: o[4], area: o[5] });
    app.savePartner(id, { profile: o[6] });
  });
  app.savePartner(app.$rows('Partners').find(p => p.Name === 'Carl Dawson').ID, { response: 'Referred a job', nextStep: 'Drop off report samples Fri' });
  let s = 11; const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  app.assignVersions({ versions: ['A', 'B', 'C'], rng });
  // curated lists: the whole Gregg file, and a hand-picked group Tanner met
  const l1 = app.createList({ name: 'Gregg County realtors · Nov 2026', notes: 'the whole import, minus the book' }).id;
  app.addMatchingToList(l1, { type: 'realtor', sourceList: 'realtors-gregg-nov-2026' });
  const l2 = app.createList({ name: 'Met at the TAR mixer', notes: 'Tanner shook hands with these on Nov 12' }).id;
  app.addToList(l2, app.$rows('Partners').filter(p => p.Type === 'realtor').slice(3, 15).map(p => p.ID));
  // offices: the brokerages behind the seeded people, one visited, one with a visit step due
  (function () {
    const offices = app.listOffices();
    const kw = offices.find(o => /keller/i.test(o.name));
    if (kw) { app.saveOffice(kw.id, { address: '5521 Old Jacksonville Hwy, Tyler, TX', manager: 'Pat Delgado', phone: '9035550199' }); app.logOfficeVisit(kw.id, { outcome: 'left_samples', met: 'Pat', notes: 'Sales meeting Thursdays 9am; bring 10 reports.', at: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) }); }
    app.saveCampaign('CP-1', { visitAfterDays: 2 });
  })();
  // content library
  app.createContent({ title: 'Judson Rd before/after', kind: 'photo', link: 'https://drive.google.com/file/d/example1/view', text: 'Twenty-year-old three-tab replaced with architectural shingle, one day.', tags: ['before-after', 'tyler'] });
  app.createContent({ title: 'Hail check caption', kind: 'caption', text: 'Storm came through last night. Give it a week, then look for granules in the gutters. A roof check is free; message us.', tags: ['hail', 'storm'] });
  app.createContent({ title: 'Sample roof report', kind: 'document', link: 'https://drive.google.com/file/d/example2/view', tags: ['realtors', 'sample'] });
  app.createContent({ title: 'The Carters, Longview', kind: 'testimonial', text: '“They had the report in my inbox the next morning and the buyer never raised the roof again.” — Dana C., listing agent', tags: ['testimonial', 'realtors'] });
  app.createContent({ title: 'Drone flyover, Gladewater', kind: 'video', link: 'https://drive.google.com/file/d/example3/view', tags: ['drone', 'gladewater'] });
  // social drafts
  app.createSocialPost({ title: 'Hail season reminder', platforms: ['Instagram', 'Facebook'], caption: 'Storm came through Tyler last night. If you heard hail on the roof, give it a week and then look for granules in the gutters. A roof check is free; message us.', hashtags: '#TylerTX #EastTexasRoofing #ArmorTexRoofs', plannedDate: '2026-11-25', status: 'ready', imageLink: 'https://drive.google.com/file/d/example/view' });
  app.createSocialPost({ title: 'Before and after · Judson Rd', platforms: ['Instagram'], caption: 'Twenty-year-old three-tab, replaced in a day with architectural shingle. Swipe for the before.', hashtags: '#roofreplacement #TylerTX', status: 'draft' });
  app.createSocialPost({ title: 'Meet Tanner', platforms: ['Facebook', 'LinkedIn'], caption: '', notes: 'Photo of Tanner in the truck. Keep it short.', status: 'idea' });
  app.createSocialPost({ title: 'Thanksgiving', platforms: ['Instagram', 'Facebook', 'Google Business'], caption: 'Thankful for every family that trusted us with their roof this year. Happy Thanksgiving from all of us at ArmorTex.', status: 'posted', postUrl: 'https://instagram.com/p/example' });
  app.saveCampaign('CP-1', { name: 'Tyler realtors · email test', lists: [l1], stages: [], versions: ['A', 'B', 'C'], startDate: '2026-11-17', notes: 'The first email test. Letters A/B/C, no E until pay-at-closing is decided.', tags: ['realtors', 'gregg', 'november'] });
  app.createCampaign({ name: 'Home inspectors · January', type: 'inspector', versions: ['A', 'B'], startDate: '2027-01-06', tags: ['inspectors', 'january'] });
  const old = app.createCampaign({ name: 'Gladewater test · five addresses', type: 'realtor', tags: ['realtors', 'test'] });
  app.saveCampaign(old.id, { status: 'done' });
  // a little history so Campaign and records have something to show
  const ps = app.$rows('Partners');
  const day = 86400000; const now = Date.now();
  const emails = []; const events = [];
  ps.slice(0, 60).forEach((p, i) => {
    const sentAt = new Date(now - day * (7 - (i % 5)));
    emails.push({ ID: 'E-' + (i + 1), 'Campaign ID': 'CP-1', 'Partner ID': p.ID, Version: p.Version, Step: 'first', 'Scheduled For': sentAt, 'Sent At': sentAt, 'Gmail Thread ID': 'thr' + i, 'Gmail Message ID': 'msg' + i, Status: i % 17 === 3 ? 'bounced' : 'sent', Subject: 'Free roof report on your listings, 48 hours', 'Sent By': 'tanner@armortexroofs.com' });
    if (i % 6 === 1) events.push({ ID: 'EV-' + events.length, 'Partner ID': p.ID, 'Email ID': 'E-' + (i + 1), Kind: 'reply', At: new Date(sentAt.getTime() + day), Snippet: i % 12 === 1 ? 'Sure, can you look at 214 Bayhills Dr, Hideaway? Listing goes live Friday.' : 'Send the sample over, thanks.', By: 'trigger', 'AI Verdict': 'yes', 'AI Reason': 'They asked for the sample to be sent.', 'AI Action': i % 12 === 1 ? 'sent' : 'suggested' });
    if (i % 9 === 2) events.push({ ID: 'EV-' + events.length, 'Partner ID': p.ID, Kind: 'call', Outcome: 'talked', At: new Date(sentAt.getTime() + day * 2), Snippet: 'Wants the sample. Has two listings in Fairway Oaks.', By: 'tanner@armortexroofs.com' });
  });
  // calls and texts as Quo would have logged them (ps[2] = a realtor with a full phone history, ps[3] = a missed call, plus one unknown number)
  const q = (n, extra) => Object.assign({ ID: 'EV-' + (events.length + n), 'Partner ID': ps[2].ID, Source: 'quo', By: 'tanner@armortexroofs.com' }, extra);
  events.push(
    q(0, { Kind: 'call', Outcome: 'no_answer', Direction: 'out', Duration: 0, Phone: ps[2].Phone, At: new Date(now - day * 4 - 3600000), 'Source ID': 'AC-seed-1' }),
    q(1, { Kind: 'text', Outcome: 'sent', Direction: 'out', Phone: ps[2].Phone, At: new Date(now - day * 4 - 3500000), Snippet: 'Hi Dana, Tanner with ArmorTex Roofs. Tried you just now about the free roof report, call me when you have a minute.', 'Source ID': 'AM-seed-1' }),
    q(2, { Kind: 'text', Outcome: 'received', Direction: 'in', Phone: ps[2].Phone, By: 'quo', At: new Date(now - day * 4 - 1800000), Snippet: 'Sure, can you look at 1402 Fairway Oaks Dr? Listing goes live Friday.', 'Source ID': 'AM-seed-2' }),
    q(3, { Kind: 'call', Outcome: 'talked', Direction: 'out', Duration: 254, Phone: ps[2].Phone, At: new Date(now - day * 4), 'Recording URL': 'https://example.com/recordings/AC-seed-2.mp3', Snippet: 'Dana has two listings in Fairway Oaks with roofs from 2009. Wants the sample report first. Next: Email the sample today.', Transcript: 'Tanner Fought: Hi Dana, Tanner with ArmorTex, thanks for texting back.\n+19035551002: Of course. So this report, is it really free?\nTanner Fought: It is. Photos, a grade and a plain recommendation, within 48 hours.\n+19035551002: Send me a sample and I will send the Fairway Oaks address over.', 'Source ID': 'AC-seed-2' }),
    q(4, { 'Partner ID': ps[3].ID, Kind: 'call', Outcome: 'missed', Direction: 'in', Duration: 0, Phone: ps[3].Phone, By: 'quo', At: new Date(now - 7200000), 'Source ID': 'AC-seed-3' }),
    q(5, { 'Partner ID': '', Kind: 'call', Outcome: 'talked', Direction: 'in', Duration: 38, Phone: '9035559999', By: 'quo', At: new Date(now - 5400000), Snippet: 'Unknown number (903) 555-9999', 'Needs Review': 'Yes', 'Source ID': 'AC-seed-4' }),
  );
  app._appendRows_('Emails', emails);
  app._appendRows_('Events', events);
  // Quo looks connected in the preview: a key, two numbers, a webhook
  app.PropertiesService.getScriptProperties().setProperty('QUO_API_KEY', 'preview-key-0000');
  app.saveSettings({ quo_numbers: JSON.stringify([{ id: 'PN1', number: '+19035550100', name: 'Tanner', users: ['tanner@armortexroofs.com'] }, { id: 'PN2', number: '+19035550199', name: 'Office', users: ['brian@armortexroofs.com'] }]), quo_users: JSON.stringify({ US1: { email: 'tanner@armortexroofs.com', name: 'Tanner Fought' } }), quo_watch: JSON.stringify(['PN1']), quo_hook_url: 'https://script.google.com/a/macros/armortexroofs.com/s/EXAMPLE/exec', quo_webhook_id: '4181', quo_webhook_url: 'https://script.google.com/a/macros/armortexroofs.com/s/EXAMPLE/exec?src=quo&token=seed' });
  app.PropertiesService.getScriptProperties().setProperty('QUO_LAST_HOOK', JSON.stringify({ at: new Date(now - 5400000).toISOString(), type: 'call.completed', eventId: 'EV1', result: { action: 'review', eventId: 'EV-5' } }));
  app.savePartner(ps[1].ID, { response: 'Sent an address', nextStep: 'Drive by 214 Bayhills Dr Thu', profile: { 'Listings Per Year': 24, 'Avg Listing Value': 385000, 'Areas Served': 'White Oak, Longview' } });
  app.savePartner(ps[0].ID, { profile: { 'Listings Per Year': 9, 'Avg Listing Value': 410000 } });
  app._appendRows_('Referrals', [{ ID: 'R-1', Date: new Date(now - day * 3), Direction: 'in', 'Partner ID': ps[1].ID, 'Customer Or Address': '214 Bayhills Dr, Hideaway TX 75771', 'Request Type': 'listing_report', 'Listing Value': 415000, 'Roof Age Years': 14, 'Due At': new Date(now - day), 'Report Recipient': ps[1].Email, 'Report Sent At': new Date(now - day * 1.5), 'Report Link': 'https://example.com/report.pdf' }]);
  app.assignRepToList('realtors-gregg-nov-2026', 'tanner@armortexroofs.com');
  app.setCallQueue(ps[4].ID, true);
  app.recountPartnerStages();
  // a series to the warm and partner tiers
  (function () {
    const addr = app.getSettings().business_address, opt = app.getSettings().opt_out_line;
    const body = 'Hi {{first}},\n\nTwo roofs we finished this month and one thing to check before the next storm: https://armortexroofs.com/news\n\nBrian\nArmorTex Roofs\n' + addr + '\n' + opt;
    const s = app.createCampaign({ name: 'Partner news · monthly', kind: 'series', type: 'realtor', tiers: ['marketing', 'partners'], tags: ['newsletter', 'partners'] });
    const d = new Date(); const iso = (n) => { const x = new Date(d.getTime() + n * 86400000); return x.toISOString().slice(0, 10); };
    app.saveStep(s.id, '1', { sendOn: iso(2), subject: 'December roofs and a hail tip', body: body });
    app.addStep(s.id, { sendOn: iso(16), subject: 'Holiday hours and the January schedule', body: body });
    app.addStep(s.id, { sendOn: iso(30), subject: 'What a roof report caught last week', body: body });
    app.dealLetters(s.id);
    app.saveCampaign(s.id, { status: 'running' });
  })();
}

const SHIM = `<script>
  // google.script.run shim: POSTs to /api and resolves like Apps Script does.
  window.google = { script: { run: (function () {
    function make(ok, bad) {
      return new Proxy({}, { get: function (_, name) {
        if (name === 'withSuccessHandler') return function (fn) { return make(fn, bad); };
        if (name === 'withFailureHandler') return function (fn) { return make(ok, fn); };
        if (name === 'withUserObject') return function () { return make(ok, bad); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          fetch('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name, args: args }) })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || 'error'); return j.result; }); })
            .then(function (res) { if (ok) ok(res); })
            .catch(function (e) { if (bad) bad(e); else console.error(e); });
        };
      } });
    }
    return make(null, null);
  })() } };
</script>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { name, args } = JSON.parse(body || '{}');
        if (typeof app[name] !== 'function' || /^_|_$/.test(name)) throw new Error('Script function not found: ' + name);
        const result = app[name].apply(null, args || []);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ result: result === undefined ? null : result }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: e.message }));
      }
    });
    return;
  }
  if (url.pathname === '/') { res.writeHead(302, { location: '/exec' + url.search }); res.end(); return; }
  if (url.pathname !== '/exec' && url.pathname !== '/dev') { res.writeHead(404); res.end('not found'); return; }
  // Two doors like Apps Script: /exec (Tanner's) and /dev (the amber test bench).
  ctx.appUrl = 'http://127.0.0.1:' + PORT + url.pathname;
  if (url.searchParams.get('as')) ctx.user = url.searchParams.get('as');
  const parameter = {};
  url.searchParams.forEach((v, k) => { parameter[k] = v; });
  try {
    let html = app.doGet({ parameter }).getContent();
    html = html.replace('</head>', SHIM + '</head>');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Render error: ' + e.stack);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('ArmorTex Outreach preview: http://127.0.0.1:' + PORT + '/exec?page=today  (also /dev for the test bench; user: ' + ctx.user + '; add &as=email to switch)');
});
