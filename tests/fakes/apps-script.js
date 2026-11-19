/**
 * Fake Apps Script runtime for Node tests.
 * In-memory SpreadsheetApp / PropertiesService / Session / Utilities /
 * MailApp / GmailApp / ScriptApp / HtmlService, just enough for the app.
 *
 * Usage:
 *   const { loadApp } = require('./fakes/apps-script');
 *   const app = loadApp({ user: 'brian@armortexroofs.com' });
 *   app.setup(); app.importPartners(csv);
 *   app.$sheet('Partners')  → rows as arrays (header first)
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ---------- Spreadsheet ----------
class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col; this.numRows = numRows; this.numCols = numCols;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = this.sheet.rows[this.row - 1 + r] || [];
      const vals = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = line[this.col - 1 + c];
        vals.push(v === undefined ? '' : v);
      }
      out.push(vals);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    if (values.length !== this.numRows || values[0].length !== this.numCols) {
      throw new Error('setValues size mismatch: range ' + this.numRows + 'x' + this.numCols + ' vs data ' + values.length + 'x' + values[0].length);
    }
    for (let r = 0; r < this.numRows; r++) {
      const idx = this.row - 1 + r;
      while (this.sheet.rows.length <= idx) this.sheet.rows.push([]);
      const line = this.sheet.rows[idx];
      for (let c = 0; c < this.numCols; c++) {
        let v = values[r][c];
        if (v instanceof Date) v = new Date(v.getTime());
        line[this.col - 1 + c] = v === undefined || v === null ? '' : v;
      }
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.frozen = 0; }
  getName() { return this.name; }
  getLastRow() {
    let last = 0;
    this.rows.forEach((r, i) => { if (r.some(v => v !== '' && v !== undefined && v !== null)) last = i + 1; });
    return last;
  }
  getLastColumn() {
    let last = 0;
    this.rows.forEach(r => { r.forEach((v, i) => { if (v !== '' && v !== undefined && v !== null && i + 1 > last) last = i + 1; }); });
    return last;
  }
  getRange(row, col, numRows, numCols) {
    if (typeof row === 'string') throw new Error('A1 notation not supported in fake');
    return new FakeRange(this, row, col, numRows === undefined ? 1 : numRows, numCols === undefined ? 1 : numCols);
  }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(arr) { this.rows.push(arr.slice()); return this; }
  deleteRow(rowIndex) { this.rows.splice(rowIndex - 1, 1); return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  clear() { this.rows = []; return this; }
}

class FakeSpreadsheet {
  constructor(id, name) { this.id = id; this.name = name; this.sheets = [new FakeSheet('Sheet1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getName() { return this.name; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}

// ---------- CSV (RFC 4180-ish, like Utilities.parseCsv) ----------
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function pad(n) { return String(n).padStart(2, '0'); }
function formatDate(d, tz, fmt) {
  // Enough of SimpleDateFormat for the app: yyyy MM dd HH mm EEE, in the
  // given tz (uses Intl so tests run anywhere).
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(d).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  return fmt
    .replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', pad(Number(parts.hour) % 24)).replace('mm', parts.minute).replace('EEE', parts.weekday);
}

// ---------- HtmlService template renderer (<? ?>, <?= ?>, <?!= ?>) ----------
const SRC_DIR = path.join(__dirname, '..', '..', 'src');
function escHtml(v) { return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function compileTemplate(src) {
  let code = 'var __out = "";\n';
  let last = 0;
  const re = /<\?(!?=)?([\s\S]*?)\?>/g;
  let m;
  while ((m = re.exec(src))) {
    code += '__out += ' + JSON.stringify(src.slice(last, m.index)) + ';\n';
    if (m[1] === '=') code += '__out += __esc(' + m[2] + ');\n';
    else if (m[1] === '!=') code += '__out += String(' + m[2] + ');\n';
    else code += m[2] + '\n';
    last = m.index + m[0].length;
  }
  code += '__out += ' + JSON.stringify(src.slice(last)) + ';\n';
  // eslint-disable-next-line no-new-func
  return new Function('__ctx', '__esc', 'include', 'with (__ctx) { ' + code + ' } return __out;');
}
function renderTemplate(name, vars, ctx) {
  const file = path.join(SRC_DIR, name + '.html');
  const fn = compileTemplate(fs.readFileSync(file, 'utf8'));
  const scope = Object.assign({}, vars);
  const include = (child, extra) => renderTemplate(child, Object.assign({}, scope, extra || {}), ctx);
  return fn(scope, escHtml, include);
}

// ---------- Runtime ----------
function makeGlobals(ctx) {
  const spreadsheets = {};
  let nextId = 1;
  const scriptProps = {};
  const userProps = {};
  const sent = [];
  const threads = {};

  const g = {
    console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    SpreadsheetApp: {
      create(name) { const id = 'ss' + (nextId++); spreadsheets[id] = new FakeSpreadsheet(id, name); return spreadsheets[id]; },
      openById(id) { if (!spreadsheets[id]) throw new Error('Not found: ' + id); return spreadsheets[id]; },
      flush() {},
    },
    PropertiesService: {
      getScriptProperties() { return { getProperty: k => (k in scriptProps ? scriptProps[k] : null), setProperty: (k, v) => { scriptProps[k] = String(v); }, deleteProperty: k => { delete scriptProps[k]; } }; },
      getUserProperties() { return { getProperty: k => (k in userProps ? userProps[k] : null), setProperty: (k, v) => { userProps[k] = String(v); }, deleteProperty: k => { delete userProps[k]; } }; },
    },
    Session: {
      getActiveUser() { return { getEmail: () => ctx.user || '' }; },
      getEffectiveUser() { return { getEmail: () => ctx.effectiveUser || ctx.user || '' }; },
      getScriptTimeZone() { return 'America/Chicago'; },
    },
    Utilities: {
      parseCsv, formatDate,
      sleep() {},
      getUuid() { return 'uuid-' + (nextId++); },
      base64Encode(s) { return Buffer.from(s).toString('base64'); },
    },
    Logger: { log: (...a) => { if (ctx.verbose) console.log(...a); } },
    MailApp: { getRemainingDailyQuota() { return ctx.quota === undefined ? 1500 : ctx.quota; } },
    GmailApp: {
      sendEmail(to, subject, body, opts) {
        const id = 'msg' + (nextId++); const threadId = 'thr' + (nextId++);
        sent.push({ to, subject, body, opts, id, threadId });
        threads[threadId] = { id: threadId, messages: [{ id, from: ctx.user, to, subject, body, date: new Date() }] };
        return { getId: () => id, getThread: () => g.GmailApp.getThreadById(threadId) };
      },
      getThreadById(id) {
        const t = threads[id]; if (!t) return null;
        return {
          getId: () => t.id,
          getMessages: () => t.messages.map(m => ({
            getId: () => m.id, getFrom: () => m.from, getTo: () => m.to, getSubject: () => m.subject,
            getPlainBody: () => m.body, getDate: () => m.date, getThread: () => g.GmailApp.getThreadById(t.id),
          })),
        };
      },
      search() { return []; },
      // test helpers
      $sent: sent,
      $threads: threads,
      $reply(threadId, from, body) {
        const t = threads[threadId]; if (!t) throw new Error('no thread ' + threadId);
        const id = 'msg' + (nextId++);
        t.messages.push({ id, from, to: ctx.user, subject: 'Re: ' + t.messages[0].subject, body, date: new Date() });
        return id;
      },
    },
    ScriptApp: {
      getService() { return { getUrl: () => ctx.appUrl || 'https://script.google.com/a/macros/example/s/FAKE/exec' }; },
      getProjectTriggers() { return []; },
      newTrigger() { const b = { timeBased: () => b, everyMinutes: () => b, create: () => ({}) }; return b; },
    },
    HtmlService: {
      createTemplateFromFile(name) {
        const tpl = {};
        tpl.evaluate = () => {
          const html = renderTemplate(name, tpl, ctx);
          const out = { setTitle() { return out; }, addMetaTag() { return out; }, setXFrameOptionsMode() { return out; }, getContent: () => html };
          return out;
        };
        return tpl;
      },
      createHtmlOutput(html) { return { setTitle() { return this; }, addMetaTag() { return this; }, getContent: () => html }; },
    },
    UrlFetchApp: { fetch(url, opts) { ctx.fetches = ctx.fetches || []; ctx.fetches.push({ url, opts }); return { getResponseCode: () => 200, getContentText: () => '{}' }; } },
  };
  g.globalThis = g;
  return g;
}

/**
 * Load every src/*.gs into a fresh fake runtime and return the context so
 * tests can call the app's functions directly: app.setup(), app.importPartners(...)
 */
function loadApp(ctx) {
  ctx = ctx || {};
  const srcDir = path.join(__dirname, '..', '..', 'src');
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.gs') || f.endsWith('.js')).sort((a, b) => (a === 'Config.gs' ? -1 : b === 'Config.gs' ? 1 : a.localeCompare(b)));
  const g = makeGlobals(ctx);
  const context = vm.createContext(g);
  files.forEach(f => {
    const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
    vm.runInContext(code, context, { filename: f });
  });
  // Top-level `const`s in a vm script are lexical, not global properties.
  // Re-export the ones from every file so tests can read HEADERS, TAB, etc.
  const constNames = [];
  files.forEach(f => {
    const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
    (code.match(/^const\s+([A-Z_][A-Z0-9_]*)\s*=/gm) || []).forEach(line => constNames.push(line.replace(/^const\s+/, '').replace(/\s*=$/, '')));
  });
  vm.runInContext(constNames.map(n => 'this[' + JSON.stringify(n) + '] = ' + n + ';').join('\n'), context);
  context.$ctx = ctx;
  context.$as = (email) => { ctx.user = email; return context; };
  context.$sheet = (tabName) => {
    const ss = context._getSpreadsheet_();
    return ss.getSheetByName(tabName).rows.map(r => r.slice());
  };
  context.$rows = (tabName) => context._readTab_(tabName);
  return context;
}

module.exports = { loadApp, parseCsv, formatDate, renderTemplate, FakeSheet, FakeSpreadsheet };
