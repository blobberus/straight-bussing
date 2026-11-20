# Bus menu: Report and feedback (owner 2026-11-20)

Owner, 2026-11-20: "There should be an ability for the user to click a particular bus on the map which will show its
next stop, line, and schedule. In this menu, at the bottom should be report and feedback: this button should eventually
link to a google form where I can collect feedback data but for now gray this button out and keep the feature
functionality and how it should work within the github info."

This file is that "github info": what the button does today, how it is meant to work, and the owner's steps to turn
it on. The bus menu itself is described in `docs/ARCHITECTURE.md` "Bus menu (2026-11-20)".

## What it does now (shipped 2026-11-20)

- A tap on a bus on the map opens its bus menu (web `web/js/ui/views/bus.js`; iPhone app `BusDetailView`, ported from
  the web). The very last item of the menu is **Report and feedback**.
- It is **grayed out**: gray words on the plain gray fill, no press effect, `aria-disabled="true"`. It stays a real
  button, so a screen reader or keyboard reaches it and reads "Report and feedback, not available yet" plus the line
  under it. A tap does nothing.
- Under it: "Coming soon: report a problem with this bus or send feedback."
- Nothing is sent anywhere, and nothing about the button is stored.
- The switch is one constant: `BUS_REPORT_URL = ""` in `web/js/ui/feedback.js` (next to `FEEDBACK_URL`, the beta
  feedback form). iPhone app: `SiteLinks.busReport = nil` in the Kit.

## How it should work once the form exists

- The button turns into a normal link (the same look as See the whole route, with the speech-bubble icon) that opens
  the Google Form in a **new tab** (Safari on iPhone), never inside the app.
- The form opens with **only these five answers filled in**, so the owner knows which bus the report is about:

  | Detail | Example | Where it comes from |
  |---|---|---|
  | Line name | 53rd Street Express | the line the menu shows |
  | Bus number shown | Bus 2 (or "Bus 1647", the fleet label, on a line with one bus) | the name the menu and the map badge show |
  | Next stop | Levi Hall | where the bus is heading |
  | Time | 2026-11-20 13:16 | Chicago time, rounded to the minute, when the menu was shown |
  | App version | 2.0.0 | `APP_VERSION` (web About) / the app's version (iOS) |

- **Never** a location (the rider's or the bus's coordinates), an identity, an account, a device id or an IP address.
  The rider can change or delete every prefilled answer, and nothing is submitted until they press Submit in the form.
- The line under the button then reads: "Opens a Google Form in a new tab with this line, bus, next stop, time and app
  version filled in. Nothing is sent until you press Submit there."
- A bus that stopped reporting still offers the button (a vanished bus is worth a report): the line and the bus's
  fleet label are filled in, the next stop is left empty.
- Code: `busReportLink(info)` in `web/js/ui/feedback.js` builds the link from `core/busmenu.js reportInfo` (the five
  details). It uses only the five entry ids in `BUS_REPORT_ENTRIES`, only `https://` addresses, one line per value,
  120 characters at most; a detail without its entry id is simply left out. Tests: `web/tests/bus-report.js` (the link
  builder, with a made-up form) and `web/tests/bus-view.js` (the grayed button, and the link once a form is set).

## Owner's steps to turn it on (about 15 minutes)

Claude cannot make the form: it needs the owner's Google account. Everything else is built.

1. **Make the form.** https://forms.google.com > Blank form, signed in with the Google account that should receive the
   reports (a personal account is simplest; a UChicago account limits forms to University users by default, see 3).
   Title `Straight Bussing: report a bus`; description `Unofficial student project. For safety rides or anything urgent,
   call 773.702.8181.`
2. **Questions** (the first five are the ones the app fills in; keep them Short answer, not required):
   - `Line` (Short answer)
   - `Bus` (Short answer)
   - `Next stop` (Short answer)
   - `Time (Chicago)` (Short answer)
   - `App version` (Short answer)
   - `What happened?` (Multiple choice, for example: The bus was not where the map showed it / The times were wrong /
     The bus skipped a stop / The bus was crowded or full / Something else), Required on
   - `Details` (Paragraph, not required)

   Do not add a question that asks for an email address or a name unless you also update the privacy wording in step 6.
3. **Settings tab > Responses:** Collect email addresses **Do not collect**; under "Requires sign in" turn **off**
   "Limit to 1 response" (and, on a UChicago account, "Restrict to users in University of Chicago"), so nobody has to
   sign in.
4. **Get the five entry ids.** Three-dot menu (top right) > **Get pre-filled link** > type `line` into Line, `bus` into
   Bus, `stop` into Next stop, `time` into Time, `version` into App version > Get link > Copy link. It looks like
   `https://docs.google.com/forms/d/e/1FAIpQL.../viewform?usp=pp_url&entry.111111111=line&entry.222222222=bus&entry.333333333=stop&entry.444444444=time&entry.555555555=version`.
   Each `entry.<number>` before `=line`, `=bus`, ... is that question's id.
5. **Set it in the code** (or send the copied link to Claude, who does this and runs the tests):
   - `web/js/ui/feedback.js`: `BUS_REPORT_URL = "https://docs.google.com/forms/d/e/1FAIpQL.../viewform"` (the part
     before `?`; not the forms.gle short link, which cannot carry the answers) and
     `BUS_REPORT_ENTRIES = Object.freeze({ line: "entry.111111111", bus: "entry.222222222", stop: "entry.333333333", time: "entry.444444444", version: "entry.555555555" })`.
   - iPhone app: `SiteLinks.busReport` and its entry ids in the Kit (the iOS agent's port; same five).
   - `web/tests/bus-report.js` first test checks that the shipped address is empty: change it to check the real one
     (a `docs.google.com/forms/` https address and five `entry.<digits>` ids).
   - Bump the cache name in `web/sw.js`.
6. **Privacy wording** (ship checklist 6: the app must say exactly what leaves the device):
   - `web/privacy.html`: a new bullet next to "Beta feedback (optional)", for example: **Report a bus (optional).** Only
     when you tap "Report and feedback" in a bus's menu does a Google Form open in a new tab (in Safari on iPhone), with
     the line, the bus number shown, its next stop, the time (Chicago, to the minute) and the app version filled in; no
     location and nothing that identifies you. You can change or delete those answers, and nothing is submitted until
     you press Submit. Update the "Effective" date at the top and the short version ("unless you send a support request,
     beta feedback or a bus report").
   - About (`web/js/ui/views/about.js`, the "Beta feedback" line) and iOS Settings / About: one sentence the same way.
   - `.claude/rules/project.md` ship checklist item 6: add the bus report form to the list of what leaves the device.
   - **App Privacy (App Store Connect):** the label can stay **Data Not Collected**, for the same reason as the support
     form (`docs/APPSTORE-SUBMIT.md` step 17): the form is optional, opened by the rider in Safari outside the app,
     prefilled only with what the rider sees and can edit, and the app itself sends nothing. If the owner wants zero
     doubt, declare "Other User Content" (App Functionality, not linked to the user, not used for tracking) instead;
     the label can change without a new build.
7. **Test.**
   - `python tools/run_browser_tests.py` (all pass), then on the live site: tap a bus > Report and feedback: the form
     opens in a new tab with the line, Bus N, the next stop, the time and the version filled in.
   - Check the form's link in the address bar: no coordinates, nothing else.
   - Send one test report and see it under the form's Responses tab; delete it there.
   - On an iPhone: the same in Safari from the installed app.

## Why a form and not a server

The app has no server (ship checklist 6, App Store D6). A Google Form keeps it that way: the rider decides each time
whether to send anything, sees exactly what is sent, and the owner reads the answers in Google Forms or a linked
Google Sheet. The same pattern as the support form (`web/support-form.js`) and the beta feedback form
(`FEEDBACK_URL`).
