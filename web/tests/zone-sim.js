/*
 * Classic (non-module) script for zone.test.html: makes this page behave like a device set to Los Angeles
 * before any app module loads. Headless Edge on Windows ignores the TZ variable, and the test machine is in
 * Chicago, so without this a formatter that forgot its zone would still pass.
 * What changes: Intl.DateTimeFormat and Date's toLocale*String default to America/Los_Angeles, and the local
 * getters (getHours, getDate, getDay, ..., getTimezoneOffset, toDateString) read Los Angeles wall time. A
 * formatter that asks for a zone (America/Chicago) is unaffected. The local Date(y, m, d) constructor still uses
 * the machine zone: app code never uses it.
 */
(function () {
  "use strict";
  var ZONE = "America/Los_Angeles";
  var Real = Intl.DateTimeFormat;
  function withZone(o) {
    var x = Object.assign({}, o || {});
    if (!x.timeZone) x.timeZone = ZONE;
    return x;
  }
  function DTF(locales, options) { return new Real(locales, withZone(options)); }
  DTF.prototype = Real.prototype;
  DTF.supportedLocalesOf = Real.supportedLocalesOf.bind(Real);
  Intl.DateTimeFormat = DTF;
  ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].forEach(function (k) {
    var real = Date.prototype[k];
    Date.prototype[k] = function (loc, o) { return real.call(this, loc, withZone(o)); };
  });

  var partsFmt = new Real("en-US", { timeZone: ZONE, hourCycle: "h23", weekday: "short", year: "numeric", month: "numeric",
    day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function parts(d) {
    var p = {};
    partsFmt.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month, d: +p.day, dow: DOW[p.weekday], h: +p.hour % 24, mi: +p.minute, s: +p.second };
  }
  var getters = {
    getFullYear: function (p) { return p.y; }, getMonth: function (p) { return p.m - 1; }, getDate: function (p) { return p.d; },
    getDay: function (p) { return p.dow; }, getHours: function (p) { return p.h; }, getMinutes: function (p) { return p.mi; },
    getSeconds: function (p) { return p.s; },
  };
  Object.keys(getters).forEach(function (k) {
    Date.prototype[k] = function () { return isNaN(this.getTime()) ? NaN : getters[k](parts(this)); };
  });
  Date.prototype.getTimezoneOffset = function () {
    var t = this.getTime();
    if (isNaN(t)) return NaN;
    var p = parts(this);
    return Math.round((t - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s, ((t % 1000) + 1000) % 1000)) / 60000);
  };
  Date.prototype.toDateString = function () {
    if (isNaN(this.getTime())) return "Invalid Date";
    var p = parts(this);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.dow] + " " + MON[p.m - 1] + " " + String(p.d).padStart(2, "0") + " " + p.y;
  };
  window.SIMULATED_ZONE = ZONE;
})();
