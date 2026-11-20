// The bus menu's Report and feedback link (bus.test.html; owner 2026-11-20: "this button should eventually link to a
// google form ... but for now gray this button out"): ui/feedback.js BUS_REPORT_URL, BUS_REPORT_ENTRIES, busReportLink.
import { test, eq, ok } from "./lib.js";
import { BUS_REPORT_URL, BUS_REPORT_ENTRIES, BUS_REPORT_FIELDS, busReportLink, FEEDBACK_URL } from "../js/ui/feedback.js";

const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSdTEST/viewform";
const IDS = { line: "entry.1001", bus: "entry.1002", stop: "entry.1003", time: "entry.1004", version: "entry.1005" };
const INFO = { line: "53rd Street Express", bus: "Bus 2", stop: "Levi Hall", time: "2026-11-20 13:16", version: "2.0.0" };

test("bus report: shipped with no form yet (the button stays grayed out), next to FEEDBACK_URL", () => {
  eq(BUS_REPORT_URL, "", "no form until the owner sets one (docs/BUS-REPORT.md)");
  eq(busReportLink(INFO), "", "no link while the address is empty");
  eq(Object.keys(BUS_REPORT_ENTRIES), ["line", "bus", "stop", "time", "version"]);
  ok(Object.values(BUS_REPORT_ENTRIES).every((v) => v === ""), "no entry ids yet");
  eq(BUS_REPORT_FIELDS, ["line", "bus", "stop", "time", "version"]);
  ok(FEEDBACK_URL.startsWith("https://"), "the beta feedback form is separate and unchanged");
});

test("bus report: with a form set, the link prefills exactly the five details, in order, encoded", () => {
  const link = busReportLink(INFO, { url: FORM, entries: IDS });
  const u = new URL(link);
  eq(u.origin + u.pathname, FORM);
  eq([...u.searchParams.keys()], ["entry.1001", "entry.1002", "entry.1003", "entry.1004", "entry.1005", "usp"]);
  eq(u.searchParams.get("entry.1001"), "53rd Street Express");
  eq(u.searchParams.get("entry.1002"), "Bus 2");
  eq(u.searchParams.get("entry.1003"), "Levi Hall");
  eq(u.searchParams.get("entry.1004"), "2026-11-20 13:16");
  eq(u.searchParams.get("entry.1005"), "2.0.0");
  eq(u.searchParams.get("usp"), "pp_url", "Google Forms shows the prefilled answers");
  ok(!/ /.test(link), "spaces encoded");
});

test("bus report: nothing but the five details ever goes in, whatever else the caller passes", () => {
  const extra = { ...INFO, lat: 41.79, lon: -87.6, user: "someone", device: "abc", ip: "1.2.3.4" };
  const ids = { ...IDS, lat: "entry.9", user: "entry.10" };
  const u = new URL(busReportLink(extra, { url: FORM, entries: ids }));
  eq([...u.searchParams.keys()].length, 6, "five details + usp");
  ok(!u.searchParams.has("entry.9") && !u.searchParams.has("entry.10"), "an id for anything else is never used");
  ok(!/41\.79|87\.6|someone|abc|1\.2\.3\.4/.test(u.toString()), "no location, identity or device id");
});

test("bus report: a detail without its entry id or value is left out; bad ids and addresses give no link", () => {
  const u = new URL(busReportLink({ ...INFO, stop: "" }, { url: FORM, entries: { ...IDS, version: "" } }));
  eq([...u.searchParams.keys()], ["entry.1001", "entry.1002", "entry.1004", "usp"], "no stop value, no version id");
  const odd = new URL(busReportLink(INFO, { url: FORM, entries: { ...IDS, line: "line" } }));
  ok(!odd.searchParams.has("line"), "an id that is not entry.<digits> is ignored");
  eq(busReportLink(INFO, { url: "http://docs.google.com/forms/x", entries: IDS }), "", "https only");
  eq(busReportLink(INFO, { url: "javascript:alert(1)", entries: IDS }), "", "never a script address");
  eq(busReportLink(INFO, { url: "  ", entries: IDS }), "", "blank");
  eq(busReportLink(INFO, { url: FORM, entries: {} }), FORM, "no ids yet: the plain form");
  eq(busReportLink(null, { url: FORM, entries: IDS }), FORM, "no details: the plain form");
});

test("bus report: values are trimmed, one line, at most 120 characters; a form's own parameters are kept", () => {
  const long = "x".repeat(300);
  const u = new URL(busReportLink({ ...INFO, line: `  53rd\n  Street  ${long}` }, { url: FORM + "?hl=en", entries: IDS }));
  eq(u.searchParams.get("hl"), "en");
  const v = u.searchParams.get("entry.1001");
  ok(v.startsWith("53rd Street x") && v.length === 120 && !/\n/.test(v), v.slice(0, 30));
});
