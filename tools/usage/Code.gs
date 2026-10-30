/** @OnlyCurrentDoc  (the script may touch only the spreadsheet it is attached to) */
/**
 * Straight Bussing: receiver for the website's anonymous usage statistics (web/js/data/usage.js), version 2.
 * A Google Apps Script web app bound to a Google Sheet that only the owner can open. Setup and the meaning of every
 * column: docs/USAGE-STATS.md. Apps Script never sees the visitor's IP address, so none is stored.
 *
 * Tabs (created and formatted on first use, times in Chicago time):
 *   Summary  rebuilt at most every 5 minutes when rows arrive, and when the sheet is opened: totals, visitors per day,
 *            visits by hour, visit length, places. Test rows (version receivercheck / selftest, or an all-zero visitor
 *            number) are left out.
 *   starts   one row per visit (always sent): when, visitor number, visit number, day, weekday, start time, app,
 *            version, first visit of that browser
 *   ends     the visit's length (riders can turn it off; may repeat per visit with a growing length: the largest counts)
 *   places   the nearest stop (only riders who turned it on)
 * Anything that does not match the format is dropped (the address is public, so junk is expected).
 * GET ?seen=<visit number> answers yes / no: whether that one visit arrived (for checking the setup; a visit number
 * is a random 32-digit hex value, so this reveals nothing about anyone).
 * Version 1 tabs (headers like received_utc) are converted the first time version 2 runs.
 * New visitor (owner 2026-10-30: "do not double count users that have the same id"): Yes only on the first row of
 * each anonymous number. Decided here, not by the browser: a start row is new only if its number is not in starts yet,
 * and every summary refresh re-marks the whole column (each number's earliest row Yes, all others No) and counts the
 * flags it corrected. The Summary counts new visitors by the day each number first appeared.
 * One row per visit (owner 2026-10-30: a visitor was double counted): a start or place row whose Visit number is
 * already in its tab is not added again (a retry, or a second copy the browser sent when it could not read the first
 * reply), every summary refresh deletes such repeats left from before and counts them, and the Summary counts visits
 * by Visit number.
 */
var CHI = "America/Chicago";
var HEADERS = {
  start: ["Received (Chicago time)", "Visitor (anonymous number)", "Visit", "Day", "Weekday", "Start time", "App", "Version", "New visitor"],
  end: ["Received (Chicago time)", "Visitor (anonymous number)", "Visit", "Length (seconds)", "Length (minutes)"],
  place: ["Received (Chicago time)", "Visitor (anonymous number)", "Visit", "Nearest stop"]
};
var TAB_NAMES = { start: "starts", end: "ends", place: "places" };
var WIDTHS = { start: [170, 270, 270, 100, 80, 90, 100, 80, 95], end: [170, 270, 270, 120, 120], place: [170, 270, 270, 240] };
var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var TEST_VERSIONS = { receivercheck: 1, selftest: 1 };
var HEX32 = /^[0-9a-f]{32}$/;
var MAX_BODY = 600;
var SUMMARY_EVERY_S = 300;
var HEAD_BG = "#00A894", HEAD_FG = "#FFFFFF";

/* ---------------------------------------------------------------- web app */

function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents) || "";
    if (body.length > MAX_BODY) return reply("too long");
    var d = JSON.parse(body);
    var row = toRow(d, new Date());
    if (!row) return reply("dropped");
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      ensureSetup();
      if (d.e !== "end" && knownIn(TAB_NAMES[d.e], 3, String(d.sid))) return reply("ok");   // this visit is already in: never twice
      if (d.e === "start") row[8] = knownVisitor(String(d.id)) ? "No" : "Yes";   // new = this number never seen before
      tab(d.e).appendRow(row);
      maybeRefreshSummary();
    } finally {
      lock.releaseLock();
    }
    return reply("ok");
  } catch (err) {
    console.error(err);
    return reply("error");
  }
}

function doGet(e) {
  var sid = e && e.parameter && e.parameter.seen;
  if (sid) {
    if (!HEX32.test(String(sid))) return reply("no");
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_NAMES.start);
    var hit = sh && sh.createTextFinder(String(sid)).matchEntireCell(true).findNext();
    return reply(hit ? "yes" : "no");
  }
  return reply("Straight Bussing usage statistics receiver. POST only.");
}

/** Sheet menu (simple trigger): refresh and format by hand; the summary is also refreshed on every open. */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu("Straight Bussing")
      .addItem("Refresh summary", "refreshSummary")
      .addItem("Format all tabs", "formatAll")
      .addToUi();
    refreshSummary();
  } catch (err) {
    console.error(err);
  }
}

/* ---------------------------------------------------------------- rows (pure) */

/**
 * A valid row for the tab of kind d.e, or null. Pure apart from Utilities (date conversion).
 * @param {object} d the JSON the website sent
 * @param {Date} now
 * @returns {Array|null}
 */
function toRow(d, now) {
  if (!d || d.v !== 1 || !HEADERS[d.e] || !HEX32.test(String(d.id)) || !HEX32.test(String(d.sid))) return null;
  if (d.e === "start") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.day)) || !/^\d{2}:\d{2}$/.test(String(d.time))) return null;
    var dow = Number(d.dow);
    if (!(dow >= 0 && dow <= 6) || Math.floor(dow) !== dow) return null;
    var app = d.app === "home-screen" ? "home-screen" : "browser";
    var ver = String(d.ver || "").replace(/[^0-9A-Za-z._]/g, "").slice(0, 20);
    return [now, d.id, d.sid, Utilities.parseDate(d.day, CHI, "yyyy-MM-dd"), DAYS[dow], d.time, app, ver, d.nu === 1 ? "Yes" : "No"];
  }
  if (d.e === "end") {
    var dur = Number(d.dur);
    if (!(dur >= 0 && dur <= 10800)) return null;
    return [now, d.id, d.sid, Math.round(dur), Math.round(dur / 6) / 10];
  }
  var zone = String(d.zone || "").slice(0, 60);
  if (!zone || /[\u0000-\u001f<>]/.test(zone)) return null;
  if (/^[=+\-@]/.test(zone)) zone = "'" + zone;   // never a spreadsheet formula
  return [now, d.id, d.sid, zone];
}

/** Is this value in column col (1-based) of the named tab, below the header? */
function knownIn(name, col, value) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return false;
  return !!sh.getRange(2, col, sh.getLastRow() - 1, 1).createTextFinder(value).matchEntireCell(true).findNext();
}

/** Is this anonymous number already in the starts tab? */
function knownVisitor(id) {
  return knownIn(TAB_NAMES.start, 2, id);
}

/**
 * Rows that repeat an earlier row's Visit number (column C), by 0-based index: the first copy stays. Pure.
 * @param {Array[]} rows
 * @returns {number[]}
 */
function repeatedVisitRows(rows) {
  var seen = {}, out = [];
  rows.forEach(function (r, i) {
    var sid = String(r[2] || "");
    if (!sid) return;
    if (seen[sid]) out.push(i); else seen[sid] = 1;
  });
  return out;
}

/** A row's received moment: a Date, or a version 1 ISO text; null if unreadable. */
function whenOf(v) {
  if (v instanceof Date) return v;
  var d = v ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}

/**
 * The New visitor column as it should be: "Yes" on each anonymous number's earliest row (received time; sheet order
 * breaks ties), "No" on every other row and on test rows. Pure.
 * @param {Array[]} starts rows of the starts tab
 * @returns {string[]}
 */
function newVisitorFlags(starts) {
  var first = {};
  starts.forEach(function (r, i) {
    if (!r[2] || isTestRow(r[1], r[7])) return;
    var t = whenOf(r[0]), ms = t ? t.getTime() : Infinity, key = String(r[1]);
    if (!(key in first) || ms < first[key].ms) first[key] = { ms: ms, i: i };
  });
  return starts.map(function (r, i) {
    var f = first[String(r[1])];
    return f && f.i === i ? "Yes" : "No";
  });
}

/** "HH:mm" for a text time or a time Sheets turned into a clock value. */
function timeText(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CHI, "HH:mm");
  return String(v || "").slice(0, 5);
}

/** "yyyy-MM-dd" for a Date or a version 1 text day. */
function dayText(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CHI, "yyyy-MM-dd");
  return String(v || "").slice(0, 10);
}

function isTestRow(visitor, version) {
  return /^0+$/.test(String(visitor)) || TEST_VERSIONS[String(version)] === 1;   // Sheets may store 000...0 as 0
}

function median(xs) {
  if (!xs.length) return null;
  var v = xs.slice().sort(function (a, b) { return a - b; }), m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * The summary as blocks of rows, from the raw tab values (header rows removed). Pure apart from Utilities.
 * @param {Array[]} starts rows of the starts tab
 * @param {Array[]} ends rows of the ends tab
 * @param {Array[]} places rows of the places tab
 * @param {Date} now
 * @returns {{totals:Array[], days:Array[], hours:Array[], places:Array[], updated:string}}
 */
function summarize(starts, ends, places, now) {
  var today = Utilities.formatDate(now, CHI, "yyyy-MM-dd");
  var weekAgo = Utilities.formatDate(new Date(now.getTime() - 6 * 86400000), CHI, "yyyy-MM-dd");
  var visits = [], sessions = {};
  starts.forEach(function (r) {
    if (!r[2] || isTestRow(r[1], r[7]) || sessions[String(r[2])]) return;   // one visit per Visit number
    var v = { visitor: String(r[1]), sid: String(r[2]), day: dayText(r[3]), weekday: String(r[4]),
      hour: parseInt(timeText(r[5]).slice(0, 2), 10), app: String(r[6]) };
    if (/^\d$/.test(v.weekday)) v.weekday = DAYS[Number(v.weekday)];   // version 1 rows
    visits.push(v);
    sessions[v.sid] = v;
  });
  var len = {};
  ends.forEach(function (r) {
    var sid = String(r[2]), s = Number(r[3]);
    if (sessions[sid] && s >= 0) len[sid] = Math.max(len[sid] || 0, s);
  });
  var where = {};
  places.forEach(function (r) {
    var sid = String(r[2]);
    if (sessions[sid] && r[3]) where[sid] = String(r[3]).replace(/^'/, "");
  });
  var uniq = function (list) { var o = {}; list.forEach(function (v) { o[v.visitor] = 1; }); return Object.keys(o).length; };
  var mins = function (list) {
    var m = median(list.filter(function (v) { return len[v.sid] !== undefined; }).map(function (v) { return len[v.sid]; }));
    return m === null ? "" : Math.round(m / 6) / 10;
  };
  var firstDay = {};   // each anonymous number's first day: a visitor is new once (owner 2026-10-30)
  visits.forEach(function (v) { if (!firstDay[v.visitor] || v.day < firstDay[v.visitor]) firstDay[v.visitor] = v.day; });
  var newOn = function (from, to) {
    return Object.keys(firstDay).filter(function (k) { return firstDay[k] >= from && firstDay[k] <= to; }).length;
  };
  var todays = visits.filter(function (v) { return v.day === today; });
  var week = visits.filter(function (v) { return v.day >= weekAgo && v.day <= today; });
  var home = visits.filter(function (v) { return v.app === "home-screen"; }).length;
  var totals = [
    ["Distinct visitors today", uniq(todays)], ["New visitors today (first visit ever)", newOn(today, today)], ["Visits today", todays.length],
    ["Distinct visitors, last 7 days", uniq(week)], ["New visitors, last 7 days", newOn(weekAgo, today)], ["Visits, last 7 days", week.length],
    ["Distinct visitors, all time", uniq(visits)], ["Visits, all time", visits.length],
    ["Typical visit length, all time (median minutes)", mins(visits)],
    ["Visits from the installed home-screen app", visits.length ? Math.round(100 * home / visits.length) + "%" : ""]
  ];
  var byDay = {};
  visits.forEach(function (v) { (byDay[v.day] = byDay[v.day] || []).push(v); });
  var days = Object.keys(byDay).sort().reverse().slice(0, 30).map(function (d) {
    var list = byDay[d];
    return [d, list[0].weekday, uniq(list), list.length, newOn(d, d), mins(list)];
  });
  var hours = [];
  for (var h = 0; h < 24; h++) {
    var at = visits.filter(function (v) { return v.hour === h; });
    if (at.length) hours.push([((h % 12) || 12) + (h < 12 ? " AM" : " PM"), at.length, uniq(at)]);
  }
  var byPlace = {};
  Object.keys(where).forEach(function (sid) { (byPlace[where[sid]] = byPlace[where[sid]] || []).push(sessions[sid]); });
  var placeRows = Object.keys(byPlace).map(function (p) { return [p, byPlace[p].length, uniq(byPlace[p])]; })
    .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 20);
  return { totals: totals, days: days, hours: hours, places: placeRows, updated: Utilities.formatDate(now, CHI, "yyyy-MM-dd h:mm a") };
}

/* ---------------------------------------------------------------- sheets */

function tab(kind) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_NAMES[kind]);
  if (!sh) {
    sh = ss.insertSheet(TAB_NAMES[kind]);
    sh.appendRow(HEADERS[kind]);
    formatTab(sh, kind);
  }
  return sh;
}

/** Header colors, frozen header, widths, number formats. Safe to run again. */
function formatTab(sh, kind) {
  var n = HEADERS[kind].length;
  sh.getRange(1, 1, 1, n).setValues([HEADERS[kind]]).setFontWeight("bold").setBackground(HEAD_BG).setFontColor(HEAD_FG)
    .setWrap(true).setVerticalAlignment("middle");
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 36);
  WIDTHS[kind].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(2, 1, rows, 1).setNumberFormat("yyyy-mm-dd h:mm:ss am/pm");
  sh.getRange(2, 2, rows, 2).setNumberFormat("@");   // the random numbers stay text (never 0 or 1.2E+31)
  if (kind === "start") {
    sh.getRange(2, 4, rows, 1).setNumberFormat("yyyy-mm-dd");
    sh.getRange(2, 6, rows, 1).setNumberFormat("@");
  }
  if (kind === "end") sh.getRange(2, 5, rows, 1).setNumberFormat("0.0");
  var extra = sh.getMaxColumns() - n;
  if (extra > 0) sh.hideColumns(n + 1, extra);
}

/** Version 1 rows (received_utc text, weekday 0-6, new_user 0/1) to version 2 values; headers too. */
function migrateV1(sh, kind) {
  var head = sh.getRange(1, 1, 1, 1).getValue();
  if (head !== "received_utc") return;
  var last = sh.getLastRow();
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, HEADERS[kind].length).getValues();
    var out = vals.map(function (r) {
      var when = typeof r[0] === "string" && r[0] ? new Date(r[0]) : r[0];
      if (kind === "start") {
        var day = r[3] instanceof Date ? r[3] : Utilities.parseDate(String(r[3]).slice(0, 10), CHI, "yyyy-MM-dd");
        var wd = /^\d$/.test(String(r[4])) ? DAYS[Number(r[4])] : r[4];
        return [when, r[1], r[2], day, wd, timeText(r[5]), r[6], r[7], r[8] === 1 || r[8] === "1" ? "Yes" : r[8] === "Yes" ? "Yes" : "No"];
      }
      if (kind === "end") return [when, r[1], r[2], Number(r[3]) || 0, Math.round((Number(r[3]) || 0) / 6) / 10];
      return [when, r[1], r[2], r[3]];
    });
    sh.getRange(2, 1, out.length, HEADERS[kind].length).setValues(out);
  }
  sh.getRange(1, 1, 1, HEADERS[kind].length).setValues([HEADERS[kind]]);
}

/** Once per spreadsheet: Chicago time, version 1 conversion, formatting, the Summary tab. */
function ensureSetup() {
  var props = PropertiesService.getDocumentProperties();
  if (props.getProperty("setup") === "2") return;
  formatAll();
  props.setProperty("setup", "2");
}

/** Menu item (and the one-time setup): format every tab and rebuild the summary. */
function formatAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(CHI);
  Object.keys(TAB_NAMES).forEach(function (kind) {
    var sh = ss.getSheetByName(TAB_NAMES[kind]);
    if (!sh) return;
    migrateV1(sh, kind);
    formatTab(sh, kind);
  });
  var blank = ss.getSheetByName("Sheet1");
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  refreshSummary();
}

function maybeRefreshSummary() {
  var cache = CacheService.getDocumentCache();
  if (cache.get("summary")) return;
  refreshSummary();
  cache.put("summary", "1", SUMMARY_EVERY_S);
}

function rowsOf(ss, kind) {
  var sh = ss.getSheetByName(TAB_NAMES[kind]);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS[kind].length).getValues();
}

/**
 * Delete rows of the starts and places tabs that repeat an earlier row's Visit number (from before the receiver
 * refused repeats); the first copy stays. Adds the count to the document property repeatsRemoved.
 * @returns {number} rows deleted now
 */
function removeRepeatedVisits(ss) {
  var gone = 0;
  ["start", "place"].forEach(function (kind) {
    var sh = ss.getSheetByName(TAB_NAMES[kind]);
    if (!sh || sh.getLastRow() < 2) return;
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
    var rep = repeatedVisitRows(rows);
    for (var k = rep.length - 1; k >= 0; k--) sh.deleteRow(rep[k] + 2);   // bottom up, so the indexes stay right
    gone += rep.length;
  });
  if (gone) {
    var props = PropertiesService.getDocumentProperties();
    props.setProperty("repeatsRemoved", String(Number(props.getProperty("repeatsRemoved") || 0) + gone));
  }
  return gone;
}

/**
 * Re-mark the starts tab's New visitor column (newVisitorFlags): runs with every summary refresh, so repeated "Yes"
 * flags for the same number (old rows, races, imported data) are cleaned automatically. Writes only when something
 * changes and adds the count to the document property newFixed.
 * @returns {number} flags corrected now
 */
function cleanNewVisitors(ss) {
  var sh = ss.getSheetByName(TAB_NAMES.start);
  if (!sh || sh.getLastRow() < 2) return 0;
  var n = sh.getLastRow() - 1;
  var rows = sh.getRange(2, 1, n, HEADERS.start.length).getValues();
  var flags = newVisitorFlags(rows), fixed = 0, changed = 0;
  var col = rows.map(function (r, i) {
    var was = r[8] === "Yes" || r[8] === 1 || r[8] === "1" ? "Yes" : "No";   // version 1 rows hold 1 / 0
    if (was !== flags[i]) fixed++;
    if (String(r[8]) !== flags[i]) changed++;
    return [flags[i]];
  });
  if (!changed) return 0;
  sh.getRange(2, 9, n, 1).setValues(col);
  var props = PropertiesService.getDocumentProperties();
  props.setProperty("newFixed", String(Number(props.getProperty("newFixed") || 0) + fixed));
  return fixed;
}

/** Menu item: rebuild the Summary tab (first tab) from the raw tabs. */
function refreshSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  removeRepeatedVisits(ss);
  cleanNewVisitors(ss);
  var props = PropertiesService.getDocumentProperties();
  var fixed = Number(props.getProperty("newFixed") || 0), repeats = Number(props.getProperty("repeatsRemoved") || 0);
  var s = summarize(rowsOf(ss, "start"), rowsOf(ss, "end"), rowsOf(ss, "place"), new Date());
  var sh = ss.getSheetByName("Summary") || ss.insertSheet("Summary", 0);
  if (sh.getIndex() !== 1) { ss.setActiveSheet(sh); ss.moveActiveSheet(1); }
  sh.clear();
  sh.setColumnWidth(1, 330); sh.setColumnWidth(2, 110); sh.setColumnWidth(3, 130); sh.setColumnWidth(4, 90);
  sh.setColumnWidth(5, 110); sh.setColumnWidth(6, 150);
  var r = 1;
  var put = function (values, style) {
    if (!values.length) return;
    var width = values[0].length;
    var rg = sh.getRange(r, 1, values.length, width).setValues(values);
    if (style === "title") rg.setFontSize(16).setFontWeight("bold");
    if (style === "note") rg.setFontColor("#555555").setFontStyle("italic");
    if (style === "head") rg.setFontWeight("bold").setBackground(HEAD_BG).setFontColor(HEAD_FG);
    if (style === "h2") rg.setFontWeight("bold").setFontSize(12);
    r += values.length;
  };
  put([["Straight Bussing website: anonymous visitors"]], "title");
  put([["Updated " + s.updated + " (Chicago time). A visitor is a random number made in one browser; identity is never collected. Test rows are left out."]], "note");
  put([["New visitor = the first visit of that anonymous number, counted once. Repeated new-visitor flags corrected so far: " + fixed + ". Repeated copies of a visit removed so far: " + repeats + "."]], "note");
  r++;
  put([["Totals", "Count"]], "head");
  put(s.totals);
  r++;
  put([["Per day (last 30 days)"]], "h2");
  put([["Day", "Weekday", "Distinct visitors", "Visits", "New visitors", "Median minutes"]], "head");
  put(s.days.length ? s.days : [["No visits yet", "", "", "", "", ""]]);
  r++;
  put([["Visits by hour of the day (Chicago time), all time"]], "h2");
  put([["Hour", "Visits", "Distinct visitors"]], "head");
  put(s.hours.length ? s.hours : [["No visits yet", "", ""]]);
  r++;
  put([["Where (nearest stop; only riders who turned it on)"]], "h2");
  put([["Nearest stop", "Visits", "Distinct visitors"]], "head");
  put(s.places.length ? s.places : [["None yet", "", ""]]);
  sh.setFrozenRows(0);
}

function reply(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}
