/**
 * ArmorTex Contact Book — Apps Script entry point.
 *
 * v0: serves the UI mockup only. No parsing or storage yet.
 * The mockup lives in src/Index.html (frozen copy in mockups/v0-contact-book.html).
 */

/**
 * Web app entry point. Serves the single-page UI.
 * @param {GoogleAppsScript.Events.DoGet} e
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ArmorTex Contact Book')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Smoke test callable from the editor or `clasp run-function ping`.
 * @return {string}
 */
function ping() {
  return 'pong ' + new Date().toISOString();
}
