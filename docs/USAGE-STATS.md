# Anonymous usage statistics (website only)

The owner asked on 2026-10-27 to track, anonymously, when distinct people open the site (time of day), how long they use
it, and where they use it from. Visit start and distinct visitors are collected regardless of the rider's choice, visit
length is on with an opt-out, and the nearest stop is opt-in. Code: `web/js/data/usage.js`. Receiver:
`tools/usage/Code.gs`. Report: `tools/usage_report.py`.

**Status: on since October 29, 2026.** `USAGE_URL` in `web/js/data/usage.js` holds the owner's Apps Script web app
address; the live site counts visits as below. Setting it back to `""` (and restoring the old privacy wording) turns it off.

## What is collected, and why it is anonymous

| Row | When | Fields | Rider's control |
|---|---|---|---|
| `start` | each visit, when it begins | Chicago date, weekday and time to the minute; home-screen app or browser tab; app version; first visit of this browser (1 / 0) | always sent (owner's rule) |
| `end` | each time the page goes to the background | seconds on screen in this visit, to 5 s, at most 3 h (the largest per visit counts) | on by default; Settings > Usage statistics > "Share how long I use the app"; off by default when the browser sends Global Privacy Control or Do Not Track |
| `place` | once per visit, when a position is known | the name of the stop nearest the first position of the visit, within 400 m, or "Away from stops"; both directions of a street stop count as one place | off by default; "Include my nearest stop"; needs location on |

Every row also has `anon_id`, a random 128-bit number made in the browser the first time (localStorage `sb:usageId`),
and `session_id`, a random number per visit. **The rider's identity is never collected**: the rows contain no name,
account, email, phone number, IP address (Apps Script cannot see it), user agent, screen size, referrer, coordinates,
searches or taps. The random number is not linked to any of those, and "Get a new anonymous number" in Settings replaces it.

Never sent: in demo mode (`?demo=1`), from automated browsers, from pages not served over https (local testing), and
from the iPhone app. The iPhone app's App Privacy label stays **Data Not Collected**.

A visit ends after 30 minutes in the background; coming back later is a new visit. Limits: one browser counts as one
visitor (on an iPhone the installed home-screen app and a Safari tab count as two); a visitor who clears site data
counts again as new; blockers may stop some rows; the address is public, so the receiver checks every row's format
and drops the rest.

## Turning it on

1. **The sheet.** In Google Drive, create a Google Sheet, for example "Straight Bussing usage". Keep it private. Do
   not share it or publish it to the web: the privacy page says only the developer can open it.
2. **The receiver.** In the sheet: Extensions > Apps Script. Replace `Code.gs` with `tools/usage/Code.gs` and save.
3. **Deploy.** Deploy > New deployment > type **Web app**; Execute as: **Me**; Who has access: **Anyone**. Deploy,
   allow the permissions it asks for (`@OnlyCurrentDoc`: only this spreadsheet; Google may first say the app is not
   verified, which is normal for your own script: Advanced > Go to ...), and copy the web app URL
   (`https://script.google.com/macros/s/.../exec`).
4. **Check it.** Open the URL in a browser: it should say "Straight Bussing usage statistics receiver. POST only."
5. **Connect the app.** Put the URL in `USAGE_URL` (`web/js/data/usage.js`), set today's date as "Effective" in
   `web/privacy.html`, bump the cache name in `web/sw.js`, and merge the branch to main. The Pages deploy makes it live.
   Claude Code can do this step: give it the URL.
6. **Watch the first rows.** Open the live site on a phone, wait a minute, switch to another app, then look at the
   sheet: the tabs `starts` and `ends` appear with your visit (and `places` if you turned on the nearest stop).

**"Access Denied" / "You need access"** when opening the URL signed out: the deployment is not open to everyone.
Deploy > Manage deployments > the pencil > Who has access: **Anyone** > Deploy (the URL stays the same). A university
Google account (Google Workspace) may only offer "Anyone within ...": then make the Sheet and the script in a personal
Gmail account instead and send the new URL. Check it in a private browser window: it must show the one-line reply.

**Receiver version 2 (2026-10-29).** `tools/usage/Code.gs` now formats the Sheet: a **Summary** tab first (visitors and
visits today, last 7 days and all time, typical visit length, home-screen share, a per-day table for 30 days, visits by
hour, places), rebuilt at most every 5 minutes as rows arrive and whenever the Sheet is opened (also menu Straight Bussing
> Refresh summary); the raw tabs get readable headers, Chicago time, dates, weekday names and Yes / No. Test rows (version
`receivercheck` / `selftest`, or a visitor number of all zeros) never count. Version 1 tabs are converted the first time
version 2 receives a row. `GET <url>?seen=<visit number>` answers yes / no for one visit (used to check the setup).
Tests: `python tools/test_usage_receiver.py`.

**Is my visit counted?** Open the site, then Settings > Usage statistics: the app reads the receiver's reply and says
"This visit was counted at ..." (or why not). In the Sheet look at the **starts** tab (or Summary), not Sheet1. In the
Apps Script editor, **Executions** lists every doPost with its time and status.

Updating the receiver later: edit the script, then Deploy > Manage deployments > edit > Version: New version (the URL
stays the same).

## Reading the data

In the sheet, File > Download > Comma separated values, once per tab, saved as `starts.csv`, `ends.csv`, `places.csv`
in one folder, then:

```
python tools/usage_report.py --dir <folder> [--since 2026-11-01] [--out report.md]
```

It prints distinct visitors and visits per day, visits by hour of the day and by weekday, visit lengths (median,
percentiles, a length table, total per visitor) and places (visits per place, and each visitor's most frequent place).

## Keeping it honest

- The privacy page (`web/privacy.html`), About (`ABOUT_USAGE`), Settings (`USAGE_ALWAYS`) and the location note
  (`LOC_ZONE_NOTE`) say exactly what is sent. A new field means updating all four first.
- Keep rows for at most 12 months (the privacy page says so): delete older rows in the sheet now and then.
- Never add a field that identifies a person or a device (name, email, IP, user agent, coordinates, fingerprinting),
  never link the random number to anything else, and never send from the iPhone app without a new App Privacy label.
- Turning it off everywhere: set `USAGE_URL` back to `""` (and restore the old privacy wording), or delete the Apps
  Script deployment (rows then fail silently; the app keeps working).
