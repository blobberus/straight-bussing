/** @OnlyCurrentDoc  (the script may touch only the spreadsheet it is attached to) */
/**
 * Straight Bussing: receiver for the website's anonymous usage statistics (web/js/data/usage.js).
 * A Google Apps Script web app bound to a Google Sheet that only the owner can open. Setup and the meaning of every
 * column: docs/USAGE-STATS.md. Apps Script never sees the visitor's IP address, so none is stored.
 *
 * One tab per row kind (created on first use):
 *   starts  received_utc, anon_id, session_id, day, weekday, start_time, app, version, new_user   (always sent)
 *   ends    received_utc, anon_id, session_id, duration_s     (visit length; rider can turn it off; may repeat per
 *           visit with a growing length: use the largest per session_id)
 *   places  received_utc, anon_id, session_id, zone           (nearest stop; only riders who turned it on)
 * Anything that does not match the format is dropped (the address is public, so junk is expected).
 */
var TABS = {
  start: ["received_utc", "anon_id", "session_id", "day", "weekday", "start_time", "app", "version", "new_user"],
  end: ["received_utc", "anon_id", "session_id", "duration_s"],
  place: ["received_utc", "anon_id", "session_id", "zone"]
};
var TAB_NAMES = { start: "starts", end: "ends", place: "places" };
var HEX32 = /^[0-9a-f]{32}$/;
var MAX_BODY = 600;

function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents) || "";
    if (body.length > MAX_BODY) return reply("too long");
    var d = JSON.parse(body);
    var row = toRow(d);
    if (!row) return reply("dropped");
    var lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      tab(d.e).appendRow(row);
    } finally {
      lock.releaseLock();
    }
    return reply("ok");
  } catch (err) {
    return reply("error");
  }
}

function doGet() {
  return reply("Straight Bussing usage statistics receiver. POST only.");
}

/** A valid row for the tab of kind d.e, or null. */
function toRow(d) {
  if (!d || d.v !== 1 || !TABS[d.e] || !HEX32.test(String(d.id)) || !HEX32.test(String(d.sid))) return null;
  var now = new Date().toISOString();
  if (d.e === "start") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.day)) || !/^\d{2}:\d{2}$/.test(String(d.time))) return null;
    var dow = Number(d.dow);
    if (!(dow >= 0 && dow <= 6)) return null;
    var app = d.app === "home-screen" ? "home-screen" : "browser";
    var ver = String(d.ver || "").replace(/[^0-9A-Za-z._]/g, "").slice(0, 20);
    return [now, d.id, d.sid, d.day, dow, d.time, app, ver, d.nu === 1 ? 1 : 0];
  }
  if (d.e === "end") {
    var dur = Number(d.dur);
    if (!(dur >= 0 && dur <= 10800)) return null;
    return [now, d.id, d.sid, Math.round(dur)];
  }
  var zone = String(d.zone || "").slice(0, 60);
  if (!zone || /[\u0000-\u001f<>]/.test(zone)) return null;
  if (/^[=+\-@]/.test(zone)) zone = "'" + zone;   // never a spreadsheet formula
  return [now, d.id, d.sid, zone];
}

function tab(kind) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = TAB_NAMES[kind];
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(TABS[kind]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function reply(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}
