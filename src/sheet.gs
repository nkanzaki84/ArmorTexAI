/**
 * ArmorTex Outreach — sheet.gs
 * Sheet access helpers. Every read and write in the app goes through here.
 *
 *   _readTab_(tab)                 → array of row objects keyed by header
 *   _appendRows_(tab, [rowObj])    → one setValues call, never a loop of appendRow
 *   _updateRow_(tab, rowIndex, rowObj)
 *   _updateRows_(tab, [{rowIndex, row}])
 *   _findRowIndex_(tab, predicate) → 1-based sheet row or -1
 *   _nextId_(tab)                  → "P-13" style ID
 *   _setting_(name) / _setSetting_(name, value)
 */

function _getSpreadsheet_() {
  const sheetId = PropertiesService.getScriptProperties().getProperty(PROP_SHEET_ID);
  if (!sheetId) throw new Error('Outreach Sheet not initialized. Run setup() from the Apps Script editor.');
  return SpreadsheetApp.openById(sheetId);
}

function _getTab_(tabName) {
  const tab = _getSpreadsheet_().getSheetByName(tabName);
  if (!tab) throw new Error('Tab "' + tabName + '" not found. Re-run setup().');
  return tab;
}

/** Header name → 0-based column index, read from the live header row (so
 *  appended columns in any order still work). */
function _headerIndex_(tab) {
  const lastCol = tab.getLastColumn();
  if (lastCol < 1) return {};
  const names = tab.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = {};
  names.forEach(function (n, i) { if (n !== '') idx[String(n)] = i; });
  return idx;
}

/**
 * Returns array of objects keyed by header name. Dates become ISO strings so
 * google.script.run can serialize them (a Date inside an array arrives as null
 * on the client). Each object also gets a non-enumerable _row (1-based sheet row).
 */
function _readTab_(tabName) {
  const tab = _getTab_(tabName);
  const lastRow = tab.getLastRow();
  if (lastRow < 2) return [];
  const idx = _headerIndex_(tab);
  const headers = HEADERS[tabName];
  const width = tab.getLastColumn();
  const data = tab.getRange(2, 1, lastRow - 1, width).getValues();
  return data.map(function (row, r) {
    const obj = {};
    headers.forEach(function (h) {
      const i = idx[h];
      let v = (i === undefined) ? '' : row[i];
      if (v instanceof Date) v = v.toISOString();
      obj[h] = v;
    });
    Object.defineProperty(obj, '_row', { value: r + 2, enumerable: false });
    return obj;
  });
}

// ISO datetime strings coming back from the client are turned into real Dates
// on write; date-only strings ("2026-12-01") are left alone to avoid tz shifts.
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
function _coerceCell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' && ISO_DATETIME_RE.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return v;
}

function _rowArray_(tabName, idx, width, rowObject, existing) {
  const row = existing ? existing.slice() : new Array(width).fill('');
  HEADERS[tabName].forEach(function (h) {
    const i = idx[h];
    if (i === undefined) return;
    if (Object.prototype.hasOwnProperty.call(rowObject, h)) row[i] = _coerceCell_(rowObject[h]);
  });
  return row;
}

/** Append many rows in one write. Returns the number appended. */
function _appendRows_(tabName, rowObjects) {
  if (!rowObjects || !rowObjects.length) return 0;
  const tab = _getTab_(tabName);
  const idx = _headerIndex_(tab);
  const width = tab.getLastColumn();
  const rows = rowObjects.map(function (o) { return _rowArray_(tabName, idx, width, o, null); });
  const start = tab.getLastRow() + 1;
  tab.getRange(start, 1, rows.length, width).setValues(rows);
  return rows.length;
}

/** Overwrite one row (1-based sheet row). Only headers present in rowObject change. */
function _updateRow_(tabName, rowIndex, rowObject) {
  _updateRows_(tabName, [{ rowIndex: rowIndex, row: rowObject }]);
}

/**
 * Update several rows. Writes ONLY the cells named in each row object, one
 * setValue per cell. It used to read the whole row back and re-write it, and
 * every round trip shifted the date cells it was not even changing (seen
 * 2026-11-22: a call's At moved back a day with each recording / transcript /
 * summary update). Volumes are tiny, so per-cell writes are fine.
 */
function _updateRows_(tabName, updates) {
  if (!updates || !updates.length) return;
  const tab = _getTab_(tabName);
  const idx = _headerIndex_(tab);
  updates.forEach(function (u) {
    HEADERS[tabName].forEach(function (h) {
      const i = idx[h];
      if (i === undefined || !Object.prototype.hasOwnProperty.call(u.row, h)) return;
      tab.getRange(u.rowIndex, i + 1).setValue(_coerceCell_(u.row[h]));
    });
  });
}

/** 1-based sheet row index of the first row matching predicate, or -1. */
function _findRowIndex_(tabName, predicate) {
  const rows = _readTab_(tabName);
  for (let i = 0; i < rows.length; i++) if (predicate(rows[i])) return rows[i]._row;
  return -1;
}

function _byId_(tabName, id) {
  const rows = _readTab_(tabName);
  for (let i = 0; i < rows.length; i++) if (String(rows[i]['ID']) === String(id)) return rows[i];
  return null;
}

/** Next ID for a tab: prefix + (max numeric suffix + 1). Pass `count` to
 *  reserve a block for a batch append: returns an array. */
function _nextId_(tabName, count) {
  const prefix = ID_PREFIX[tabName];
  if (!prefix) throw new Error('No ID prefix for ' + tabName);
  const tab = _getTab_(tabName);
  const lastRow = tab.getLastRow();
  let max = 0;
  if (lastRow >= 2) {
    const col = _headerIndex_(tab)['ID'];
    tab.getRange(2, col + 1, lastRow - 1, 1).getValues().forEach(function (r) {
      const m = String(r[0]).match(/-(\d+)$/);
      if (m && Number(m[1]) > max) max = Number(m[1]);
    });
  }
  if (count === undefined) return prefix + '-' + (max + 1);
  const ids = [];
  for (let i = 1; i <= count; i++) ids.push(prefix + '-' + (max + i));
  return ids;
}

// ===== Settings =====
function _settings_() {
  const out = Object.assign({}, SETTING_DEFAULTS);
  _readTab_(TAB.SETTINGS).forEach(function (r) {
    const k = String(r['Name'] || '').trim();
    if (k) out[k] = r['Value'];
  });
  return out;
}

function _setting_(name) {
  const v = _settings_()[name];
  return (v === undefined || v === null) ? '' : String(v);
}

function _setSetting_(name, value) {
  const rowIndex = _findRowIndex_(TAB.SETTINGS, function (r) { return String(r['Name']).trim() === name; });
  if (rowIndex === -1) _appendRows_(TAB.SETTINGS, [{ Name: name, Value: value }]);
  else _updateRow_(TAB.SETTINGS, rowIndex, { Name: name, Value: value });
}

// ===== Small utilities =====
function _userEmail_() {
  try { return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); }
  catch (err) { return ''; }
}

function _yes_(v) { return String(v || '').trim().toLowerCase() === 'yes'; }

function _normEmail_(v) { return String(v || '').trim().toLowerCase(); }

function _digits_(v) { return String(v || '').replace(/\D/g, ''); }

/** Dates travel as strings. Parse "YYYY-MM-DD" or "MM/DD/YYYY" as a LOCAL
 *  date (script time zone is America/Chicago), never UTC midnight. */
function _parseLocalDate_(v) {
  if (!v) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d;
}

/** "YYYY-MM-DD" in the script time zone. */
function _dateKey_(d) {
  return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Short weekday name in the script time zone: Mon, Tue, … */
function _weekday_(d) {
  return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), 'EEE');
}

/** Adds n business days (Mon–Fri) to a date. */
function _addBusinessDays_(date, n) {
  const d = new Date(date.getTime());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

/** Fisher–Yates with an injectable RNG so tests are deterministic. */
function _shuffle_(arr, rng) {
  const a = arr.slice();
  const rand = rng || Math.random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
