// js/support.js (support.html "Contact support"): the app-and-device answer, the {app} placeholder in the Google
// Form's pre-filled link (raw or as Google writes it, %7Bapp%7D), ?contact=1 forwarding, and the GitHub Issues
// fallback while support-form.js is empty. Runs on a detached copy of the page's elements; nothing navigates.
import { test, eq, ok } from "./lib.js";
import { appDetails, browserText, clean, formLink, issuesLink, mountSupport, ISSUES_URL } from "../js/support.js";
import { SUPPORT_FORM_URL } from "../support-form.js";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  androidChrome: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
};
const GOOGLE = "https://docs.google.com/forms/d/e/1FAIpQLSdTEST/viewform?usp=pp_url&entry.1234567890=%7Bapp%7D";

test("support: browser and device from the user agent (iPad asking for the desktop site counts as iPad)", () => {
  eq(browserText(UA.iphoneSafari), "Safari 26.0 on iPhone");
  eq(browserText(UA.iphoneChrome), "Chrome 141 on iPhone");
  eq(browserText(UA.ipadDesktop, 5), "Safari 26.0 on iPad");
  eq(browserText(UA.ipadDesktop, 0), "Safari 26.0 on Mac");
  eq(browserText(UA.windowsEdge), "Edge 141 on Windows");
  eq(browserText(UA.windowsFirefox), "Firefox 143 on Windows");
  eq(browserText(UA.androidChrome), "Chrome 141 on Android");
  eq(browserText(UA.samsung), "Samsung Internet 28 on Android");
  eq(browserText(""), "unknown browser");
});

test("support: app details from the iPhone app's and the web About's query, else the browser", () => {
  const ios = "?contact=1&app=ios&v=" + encodeURIComponent("1.0.0 (12)") + "&os=" + encodeURIComponent("iOS 26.1 on iPhone17,1");
  eq(appDetails(ios, UA.iphoneSafari), "Straight Bussing iPhone app 1.0.0 (12), iOS 26.1 on iPhone17,1");
  eq(appDetails("?contact=1&app=web&v=2.0.0", UA.windowsEdge), "Straight Bussing web app 2.0.0, Edge 141 on Windows");
  eq(appDetails("", UA.iphoneSafari), "Straight Bussing, Safari 26.0 on iPhone", "opened straight from the App Store page");
  eq(appDetails("?app=evil&v=1", UA.iphoneSafari), "Straight Bussing 1, Safari 26.0 on iPhone", "unknown platforms are dropped");
});

test("support: query values are cleaned (control characters, spaces, length)", () => {
  eq(clean("  a\u0000b\n\tc  "), "a b c");
  eq(clean(null), "");
  eq(clean("x".repeat(100)).length, 60);
  const long = appDetails("?app=ios&v=" + "9".repeat(80) + "&os=" + "y".repeat(200), "");
  ok(long.length <= "Straight Bussing iPhone app ".length + 40 + 2 + 60, "bounded: " + long.length);
});

test("support: {app} in the pre-filled link is replaced, raw or as Google encodes it", () => {
  const d = "Straight Bussing iPhone app 1.0.0 (12), iOS 26.1 on iPhone17,1";
  const want = "https://docs.google.com/forms/d/e/1FAIpQLSdTEST/viewform?usp=pp_url&entry.1234567890=" + encodeURIComponent(d);
  eq(formLink(GOOGLE, d), want, "%7Bapp%7D");
  eq(formLink(GOOGLE.replace("%7Bapp%7D", "{app}"), d), want, "{app}");
  eq(formLink(GOOGLE.replace("%7Bapp%7D", "%7bapp%7d"), d), want, "lower-case hex");
  eq(new URL(formLink(GOOGLE, d)).searchParams.get("entry.1234567890"), d, "Google reads back exactly the details");
  eq(formLink("  " + GOOGLE + "\n", d), want, "pasted with spaces");
  eq(formLink("https://docs.google.com/forms/d/e/X/viewform", d), "https://docs.google.com/forms/d/e/X/viewform", "no placeholder: plain form link");
  eq(formLink("https://forms.gle/abc123", d), "https://forms.gle/abc123");
  eq(formLink("", d), "", "not set");
  eq(formLink("https://evil.example/forms/x?e=%7Bapp%7D", d), "", "only Google Forms links");
  eq(formLink("javascript:alert(1)//docs.google.com/forms/", d), "");
  eq(formLink("http://docs.google.com/forms/d/e/X/viewform", d), "", "https only");
});

test("support: the shipped config is empty or a Google Forms link", () => {
  ok(SUPPORT_FORM_URL === "" || formLink(SUPPORT_FORM_URL, "x") !== "", "support-form.js holds a docs.google.com/forms or forms.gle link");
});

function page() {
  const doc = document.implementation.createHTMLDocument("support");
  doc.body.innerHTML = `<h2 id="contact">Contact support</h2><p data-js-only hidden>Filled in: <b data-support-details></b></p>
    <a data-support-contact href="${ISSUES_URL}">Contact support</a>`;
  return doc;
}
function fakeLocation(search) {
  return { search, replaced: null, replace(u) { this.replaced = u; } };
}

test("support page: with the form link, the button opens the form; ?contact=1 forwards with location.replace", () => {
  const doc = page(), loc = fakeLocation("?app=web&v=2.0.0");
  eq(mountSupport({ doc, loc, ua: UA.windowsEdge, touchPoints: 0, form: GOOGLE }), "form");
  const href = doc.querySelector("[data-support-contact]").href;
  eq(new URL(href).searchParams.get("entry.1234567890"), "Straight Bussing web app 2.0.0, Edge 141 on Windows");
  eq(doc.querySelector("[data-support-details]").textContent, "Straight Bussing web app 2.0.0, Edge 141 on Windows");
  ok(!doc.querySelector("[data-js-only]").hidden && doc.documentElement.classList.contains("has-form"), "form texts shown");
  eq(loc.replaced, null, "no forwarding without contact=1");

  const loc2 = fakeLocation("?contact=1&app=ios&v=" + encodeURIComponent("1.0.0 (3)") + "&os=" + encodeURIComponent("iOS 26.1 on iPhone17,1"));
  eq(mountSupport({ doc: page(), loc: loc2, ua: UA.iphoneSafari, form: GOOGLE }), "forwarded");
  eq(new URL(loc2.replaced).searchParams.get("entry.1234567890"), "Straight Bussing iPhone app 1.0.0 (3), iOS 26.1 on iPhone17,1");
});

test("support page: without the form link, GitHub Issues (details in the new issue), never forwarding", () => {
  const doc = page(), loc = fakeLocation("?contact=1&app=web&v=2.0.0");
  eq(mountSupport({ doc, loc, ua: UA.iphoneChrome, form: "" }), "issues");
  eq(loc.replaced, null, "stays on the support page");
  ok(!doc.documentElement.classList.contains("has-form"), "GitHub texts shown");
  const href = doc.querySelector("[data-support-contact]").href;
  eq(href, issuesLink("Straight Bussing web app 2.0.0, Chrome 141 on iPhone"));
  ok(href.startsWith(ISSUES_URL + "?body=") && decodeURIComponent(href.split("body=")[1]).startsWith("App and device: Straight Bussing web app 2.0.0"));
  eq(mountSupport({ doc: page(), loc: fakeLocation("?contact=1"), ua: "", form: "https://not-google.example/x" }), "issues", "a wrong link is ignored");
});
