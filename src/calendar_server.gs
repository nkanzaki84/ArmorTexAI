// ============================================================
// Calendar (built 2026-11-23, Brian: "I want this to have a calendar").
// One month at a time, everything with a date on it: emails sent and the
// plan for the ones still to go, follow-ups due, calls due, replies and
// calls logged, social posts planned and posted. Read-only; links out.
// ============================================================

/**
 * @param {{month?: string, now?: Date}} opts  month = 'YYYY-MM' (default: this month); now for tests.
 * @return {{month, days: {[date]: Array<{kind, label, n?, id?, campaignId?, status?}>}, sendingDays: string[]}}
 */
function getCalendar(opts) {
  _requireRole_(ROLES.map(function (r) { return r.key; }));
  opts = opts || {};
  const now = opts.now ? new Date(opts.now) : new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(String(opts.month || ''));
  const year = m ? parseInt(m[1], 10) : now.getFullYear();
  const month = m ? parseInt(m[2], 10) - 1 : now.getMonth();
  const prefix = year + '-' + ('0' + (month + 1)).slice(-2);
  const inMonth = function (v) { if (!v) return ''; const k = _dateKey_(new Date(v)); return k.indexOf(prefix) === 0 ? k : ''; };
  const days = {};
  const add = function (key, item) { (days[key] = days[key] || []).push(item); };
  const bump = function (key, kind, label, extra) {
    const list = days[key] = days[key] || [];
    let it = list.filter(function (x) { return x.kind === kind && (!extra || x.campaignId === extra.campaignId); })[0];
    if (!it) { it = Object.assign({ kind: kind, n: 0, label: label }, extra || {}); list.push(it); }
    it.n++;
    return it;
  };

  const partners = _readTab_(TAB.PARTNERS);
  const emails = _readTab_(TAB.EMAILS);
  const campaigns = _readTab_(TAB.CAMPAIGNS);
  const cname = {};
  campaigns.forEach(function (c) { cname[String(c['ID'])] = String(c['Name'] || c['ID']); });

  // what went out, and what is queued
  emails.forEach(function (e) {
    if (e['Status'] === 'cancelled') return;
    const cid = String(e['Campaign ID'] || '');
    if (e['Sent At']) {
      const k = inMonth(e['Sent At']); if (!k) return;
      if (e['Step'] === 'sample report') bump(k, 'sample', 'sample report sent');
      else bump(k, 'sent', 'emails sent', { campaignId: cid, campaign: cname[cid] || '' });
    } else if (e['Status'] === 'queued' && e['Scheduled For']) {
      const k = inMonth(e['Scheduled For']); if (!k) return;
      bump(k, 'followup', 'follow-ups due', { campaignId: cid, campaign: cname[cid] || '' });
    }
  });

  // the plan for running campaigns: first emails and calls still to come
  const todayKey = _dateKey_(now);
  campaigns.filter(function (c) { return String(c['Status']) === 'running'; }).forEach(function (c) {
    const plan = _campaignPlan_(c, partners, emails, now);
    plan.days.forEach(function (d) {
      if (d.date.indexOf(prefix) !== 0 || d.date < todayKey) return;
      if (d.firsts) { const it = bump(d.date, 'plan', 'first emails planned', { campaignId: String(c['ID']), campaign: cname[String(c['ID'])] }); it.n += d.firsts - 1; }
      if (d.calls) { const it = bump(d.date, 'callplan', 'calls due (no reply)', { campaignId: String(c['ID']), campaign: cname[String(c['ID'])] }); it.n += d.calls - 1; }
    });
  });

  // what happened: replies in, calls and texts
  _readTab_(TAB.EVENTS).forEach(function (ev) {
    const k = inMonth(ev['At']); if (!k) return;
    if (ev['Kind'] === 'reply') bump(k, 'reply', 'replies');
    else if (ev['Kind'] === 'call' || ev['Kind'] === 'voicemail') bump(k, 'call', 'calls');
    else if (ev['Kind'] === 'text') bump(k, 'text', 'texts');
  });

  // social posts: planned (not yet posted) and posted
  _readTab_(TAB.SOCIAL).forEach(function (p) {
    const status = String(p['Status'] || 'idea');
    const when = status === 'posted' ? (p['Posted At'] || p['Planned Date']) : p['Planned Date'];
    const k = inMonth(when); if (!k) return;
    add(k, { kind: 'social', label: String(p['Title'] || '(untitled)'), id: String(p['ID']), status: status, platforms: _csvList_(p['Platforms']) });
  });

  // which weekdays are sending days for any running campaign (shaded on the grid)
  const sendingDays = {};
  campaigns.filter(function (c) { return String(c['Status']) === 'running'; }).forEach(function (c) { _campaignSending_(c).days.forEach(function (d) { sendingDays[d] = true; }); });

  return { month: prefix, today: todayKey, days: days, sendingDays: Object.keys(sendingDays) };
}
