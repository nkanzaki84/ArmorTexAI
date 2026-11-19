/**
 * ArmorTex Outreach — Code.gs
 * Web app entry (doGet, include) and one-time setup().
 *
 * Files:
 *   Config.gs    constants, headers, enums, settings, roles
 *   sheet.gs     read/write helpers (all Sheet access goes through these)
 *   users.gs     roles + permission checks
 *   partners_server.gs  partner import, version assignment, partner record
 *   campaign_server.gs  daily batch, versions, stats, do-not-contact
 *   (v1 next)    emails.gs — send batch, reply check trigger
 *   *.html       UI: index shell + one include per page
 */

// ============================================================
// 1. Web app entry
// ============================================================

function doGet(e) {
  const params = (e && e.parameter) || {};
  const requested = String(params.page || '');
  const validPages = PAGE_CATALOG.map(function (p) { return p.key; }).concat(['partner', 'home']);

  let session = null;
  try { session = getCurrentUserSession(); } catch (err) { session = { denied: true, reason: 'lookup_failed', message: err.message }; }

  let noAccess = null;
  if (session.denied) noAccess = { kind: 'denied', reason: session.reason || 'denied', email: session.email || '', message: session.message || '' };

  let page = requested;
  if (!page) page = session.defaultLanding || 'today';
  if (validPages.indexOf(page) === -1) page = 'today';
  // Record pages sit under their list page for access purposes.
  const accessKey = page === 'partner' ? 'partners' : page === 'home' ? 'homes' : page;
  if (!noAccess && session.allowedPages.indexOf(accessKey) === -1) {
    noAccess = { kind: 'forbidden', requestedLabel: accessKey, roleLabel: session.roleLabel, landing: session.defaultLanding || 'today' };
  }

  const tpl = HtmlService.createTemplateFromFile('index');
  tpl.page = page;
  tpl.recordId = String(params.id || '');
  tpl.side = (String(params.side || '') === 'homes') ? 'homes' : 'partners';
  tpl.appUrl = ScriptApp.getService().getUrl();
  tpl.appVersion = APP_VERSION;
  tpl.appBuildDate = APP_BUILD_DATE;
  tpl.session = session;
  tpl.noAccess = noAccess;
  return tpl.evaluate()
    .setTitle('ArmorTex Outreach')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Include an HTML partial, optionally with template variables. */
function include(filename, context) {
  const tpl = HtmlService.createTemplateFromFile(filename);
  if (context) Object.keys(context).forEach(function (k) { tpl[k] = context[k]; });
  return tpl.evaluate().getContent();
}

/** Smoke test from the editor or `clasp run-function ping`. */
function ping() { return 'pong ' + new Date().toISOString() + ' as ' + _userEmail_(); }

// ============================================================
// 2. setup() — create or repair the Sheet. Safe to re-run.
// ============================================================

/**
 * Creates the Sheet on first run (ID saved in Script Properties), then for
 * every tab in HEADERS: creates the tab if missing, appends any header that
 * is missing to the RIGHT, never renames or reorders. Seeds settings,
 * versions and the owner's Users row. Returns a report.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty(PROP_SHEET_ID);
  let ss = null;
  if (sheetId) { try { ss = SpreadsheetApp.openById(sheetId); } catch (err) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    sheetId = ss.getId();
    props.setProperty(PROP_SHEET_ID, sheetId);
  }

  const report = { sheetId: sheetId, url: ss.getUrl ? ss.getUrl() : '', created: [], appended: [] };
  Object.keys(HEADERS).forEach(function (tabName) {
    let tab = ss.getSheetByName(tabName);
    if (!tab) { tab = ss.insertSheet(tabName); report.created.push(tabName); }
    const wanted = HEADERS[tabName];
    const lastCol = tab.getLastColumn();
    const existing = lastCol ? tab.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    const have = {};
    existing.forEach(function (h) { if (h) have[h] = true; });
    const missing = wanted.filter(function (h) { return !have[h]; });
    if (!existing.filter(Boolean).length) {
      tab.getRange(1, 1, 1, wanted.length).setValues([wanted]);
      report.appended.push(tabName + ': ' + wanted.length + ' headers');
    } else if (missing.length) {
      tab.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      report.appended.push(tabName + ': +' + missing.join(', '));
    }
    try { tab.setFrozenRows(1); tab.getRange(1, 1, 1, Math.max(wanted.length, existing.length)).setFontWeight('bold'); } catch (err) { /* fake runtime */ }
  });

  // Remove the default "Sheet1" once our tabs exist.
  try {
    const def = ss.getSheetByName('Sheet1');
    if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  } catch (err) { /* ignore */ }

  _seedSettings_();
  _seedVersions_();
  _seedUsers_();
  return report;
}

function _seedSettings_() {
  const have = {};
  _readTab_(TAB.SETTINGS).forEach(function (r) { have[String(r['Name']).trim()] = true; });
  const rows = Object.keys(SETTING_DEFAULTS)
    .filter(function (k) { return !have[k]; })
    .map(function (k) { return { Name: k, Value: SETTING_DEFAULTS[k] }; });
  _appendRows_(TAB.SETTINGS, rows);
}

function _seedVersions_() {
  const have = {};
  _readTab_(TAB.VERSIONS).forEach(function (r) { have[String(r['Letter']).trim()] = true; });
  const rows = SEED_VERSIONS
    .filter(function (v) { return !have[v.Letter]; })
    .map(function (v) { return Object.assign({ Subject: '', Body: '', 'Follow Up Body': '', Locked: '', 'Updated At': new Date() }, v); });
  _appendRows_(TAB.VERSIONS, rows);
}

/** For the Settings page: where the Sheet lives. */
function getSheetInfo() {
  _requireRole_(ADMIN_ROLES);
  const ss = _getSpreadsheet_();
  return { id: ss.getId(), url: ss.getUrl() };
}
