# Straight Bussing: poster brief (product statement + functional proposal)

For the agent designing a QR code poster that riders see inside the campus shuttles. This file is self-contained:
everything you may claim is listed here, and the "Do not claim" rules are hard rules. Owner: Nathan.
Written 2026-10-15 against the live site.

## 1. Product statement

**What it is.** Straight Bussing is a free, unofficial live tracker for the campus shuttles in Hyde Park, Chicago.
It is a web app at **https://blobberus.github.io/straight-bussing/**. It opens in any phone browser and can be
added to the Home Screen so it opens like an app. A native iPhone app is in development ("coming", no date).
It is a student project, currently in beta.

**Who it is for.** Students, staff and visitors who ride the campus shuttles (North, South, East, Central,
53rd Street Express, Midway Metra, Red Line/Arts Block, Apostolic, Drexel and the rest) and want to know where their
bus is right now without hunting through menus.

**One-line pitch.** Where your shuttle is, when it comes, and how to get there, on one clean map.

**Tagline options** (pick one; all are plain, none promise accuracy):
1. "Where's my bus? Scan and see."
2. "Every campus shuttle, live, on one map."
3. "Catch the shuttle, not the wait."

## 2. Perks to advertise (most important first)

Poster line (3 to 8 words) and the plain truth behind it. Use 3 to 5 of these on the poster, not all.

| # | Poster line | What it really does |
|---|---|---|
| 1 | Live buses on a map | Every running shuttle moves on the map from the shuttle system's live GPS feed. |
| 2 | Your next bus, no taps | With location on, opening the app shows the nearest stop and its next arrivals at a glance. |
| 3 | Directions with the shuttle | Type a place (a dorm, Regenstein, Medici, Chipotle) and get walk + shuttle trips, with one transfer at most. |
| 4 | "Get off in 2 stops" alerts | During a trip the app counts down your stops and tells you when your stop is next. |
| 5 | Know when your bus is close | Optional alerts when a bus is 1 or 2 stops away (on the web, while the app is open). |
| 6 | Your routes, your stations | Save custom route sets and favorite stations; hide routes you never take. |
| 7 | Honest when data is late | If the live feed is delayed, the app says so ("Live data delayed") instead of showing old times as fresh. |
| 8 | Service alerts in full | Detours and schedule notices from the shuttle operator are shown word for word. |
| 9 | Buildings and dorms named | Campus buildings, every dorm and nearby spots are labeled on the map. |
| 10 | Your dot shows where you face | The location dot has a direction cone (compass, or your direction while walking). |
| 11 | Dark mode | Auto, Light or Dark. |
| 12 | No account. No ads. No tracking. | Nothing to sign up for; no analytics; your location is used on your phone (only the rounded ends of a walking route go to a map routing service, when you ask for directions). Do not write "your location never leaves your phone". |
| 13 | Free | Free, no in-app purchases. |
| 14 | Add it to your Home Screen | Opens like an app; the app itself loads even without signal (live times need a connection). |

Optional teaser (small, playful, never reveal names): "Zoom all the way in. Some places have secret names."

## 3. Do not claim (hard rules)

- **No accuracy claims.** Do not say or imply "more accurate", "smarter", "better predictions", "AI", "learns",
  "never miss a bus" or "on time". Improved arrival times are a work in progress and are **not** in the current
  build. The times shown are the live predictions the shuttle system publishes, shown as they are. Trip and walking
  totals are estimates and the app labels them "est."
- **Not official.** No "official", no University of Chicago or UGo names as branding, no crest, no university
  logos, no Passio logo, no maroon used as a brand color, nothing that looks like the university or the operator
  made or endorses it. The owner has permission to use the shuttle data; that is not an endorsement.
- **Always include the disclaimer** in small type: "Unofficial. Not affiliated with or endorsed by the University
  of Chicago or Passio." (The app itself says "Not affiliated with the University.")
- **No invented numbers:** no ratings, user counts, minutes saved, "#1", reviews or quotes.
- **No App Store or Google Play badges.** The iPhone app is not released; "iPhone app coming" is the most you may say.
- **No en dash or em dash characters** in any poster text (project copy rule). Use commas, colons or periods.
- **No tracking links in the QR code:** no bit.ly or other short links, no UTM tags, no QR generator redirect
  services. The app has no analytics by design, so scans cannot be counted, and that is intended.
- Do not promise lock-screen or Dynamic Island trip displays; those come with the iPhone app. On the web, alerts
  work while the app is open.

## 4. Brand and visual direction

**Name:** Straight Bussing (two words, both capitalized). Do not abbreviate on the poster.

**Feel:** Apple Maps / Citymapper. Calm, lots of white space, one accent color, the map is the hero. No gradients,
no glow, no emoji, no stock photos of buses. Route colors are the only bright colors, and only as map data.

**App icon:** a white bird riding a white bus on a solid teal square (#00A894). Nathan must give you the file:
`straight-bussing-icon-LARGE.png` (1000 x 1000 px, the master; about 8.5 cm / 3.3 in wide at 300 dpi, so ask Nathan
for a larger or vector original before printing it bigger). Do not redraw or recolor it. The icon's teal may be the
poster's brand color (a teal band or the icon tile); keep it apart from the "Live" green below, which it resembles, so
riders never read teal as "live".

**Colors** (from the app's design tokens, `web/css/tokens.css`):

| Role | Light | Dark |
|---|---|---|
| Background | #FCFCFD (off-white, never pure white surfaces in the app) | #1C1C1E |
| Surface / cards | #F2F2F7 | #2C2C2E |
| Text | #111114 | #F5F5F7 |
| Secondary text | #5C5C63 | #A1A1A8 |
| Accent (actions, links, location dot) | #0066D6 text, #0071E3 fills | #409CFF |
| Icon teal (the icon only, not a UI accent) | #00A894 | #00A894 |
| Live (green) | #1E9E4A fills, #17803B text | #32D74B |

**The one-accent rule:** blue is the only accent. Green means *live data and nothing else*. On the poster, use
green only for a "Live" marker next to bus positions or times (for example a small green dot by "Live"), never for
headlines, buttons or decoration.

**Type:** the app uses the system font (SF Pro on Apple devices, Segoe UI or Roboto elsewhere) and SF Pro Rounded for
big arrival numbers. SF Pro's license covers Apple platform interface mockups, not general print, so for the
poster use **Inter** (free, SIL Open Font License) as the stand-in; bold for the headline, regular for body.
Numbers in tabular figures.

**Layout concepts:**
1. *Phone-first:* a clean phone mockup showing the map with a few colored route lines, bus markers and the
   bottom sheet ("Current trip", next arrivals), headline above, QR code bottom right with the call to action.
   Only use real screenshots of the live site that Nathan provides; do not invent screens or times.
2. *Big question:* headline "Where's my bus?" in large type on off-white, 3 perk lines with simple line icons,
   the QR code as the largest object, app icon + name + URL at the bottom, disclaimer in small type.

Any screenshot shown must not display a precise arrival time as a promise; if a screenshot shows times, it is fine
as an illustration, but no caption may say the times are exact.

## 5. QR code spec

- **Target:** exactly `https://blobberus.github.io/straight-bussing/` (with the trailing slash). Encode the plain
  URL, nothing appended.
- **Print the URL in text** under the code: `blobberus.github.io/straight-bussing`
- **Error correction:** M (15%) or Q (25%). Use Q if a small icon is placed in the center; otherwise M.
- **Quiet zone:** at least 4 modules of empty space on every side.
- **Colors:** dark modules on a light background (for example #111114 on #FCFCFD). Never inverted, never on a photo,
  never low contrast.
- **Size:** scanning distance is about 10 times the code's width. Arm's length (about 60 cm / 2 ft) needs at least
  6 cm / 2.4 in; across the aisle (about 1.5 m / 5 ft) needs 15 cm / 6 in. Recommended: **at least 10 cm / 4 in**,
  15 cm / 6 in if the card allows. Riders scan in a moving, vibrating bus, so err larger.
- **Placement:** below eye level of a standing rider is fine; avoid the very bottom edge of the card and glare spots
  (matte finish, not glossy lamination).
- **Test before printing:** scan the final print-size proof with an iPhone camera and an Android camera, at arm's
  length and at 1.5 m, in normal and dim light.
- **Call to action next to the code** (pick one):
  "Scan for live bus times" / "Scan. See your bus." / "Point your camera here".
- **Install hint** (optional, small): "Add to Home Screen to keep it one tap away."

## 6. Owner to-dos (Nathan; not for the designer)

- [ ] **Get written approval from UChicago Transportation before posting inside any shuttle.** The data permission
  (granted 2026-10-11) covers using the shuttle data, not advertising in their vehicles. Ask what is allowed:
  where, how many, how long, and who installs them.
- [ ] Confirm the card size and mounting with the operator. Common interior bus card sizes to ask about:
  11 x 17 in (tabloid, easy to print) and 11 x 28 in (standard transit "car card" above the windows). Also
  consider campus bulletin boards and bus shelters, each with their own approval.
- [ ] Keep the safety number 773.702.8181 off the poster unless Transportation asks for it; the app already shows
  it and links to the official app wherever no bus reports.
- [ ] Provide the designer: `straight-bussing-icon-LARGE.png` (the app icon), and 1 or 2 real screenshots of the live
  site (light mode reads best in print; demo mode `?demo=1` shows simulated buses when none run, but a poster
  screenshot from demo mode must not be passed off as a real moment).
- [ ] Before printing: check that nothing on the poster claims better arrival accuracy (the accuracy work is not
  shipped yet); when it ships, a new poster line can be added.

## 7. Facts sheet (quote verbatim)

```
Name:        Straight Bussing
What:        Free, unofficial live tracker for the campus shuttles in Hyde Park, Chicago
Web:         https://blobberus.github.io/straight-bussing/
Platforms:   Any phone or computer browser; add to the Home Screen to open it like an app.
             iPhone app coming.
Price:       Free. No ads, no in-app purchases.
Account:     None needed.
Privacy:     No account, no tracking, no analytics. Your location is used on your phone.
Times:       Live arrival predictions from the shuttle system, shown as published; they can be wrong.
             Trip totals are estimates.
Status:      Beta. Feedback welcome in the app (Settings, Give feedback).
Disclaimer:  Unofficial. Not affiliated with or endorsed by the University of Chicago or Passio.
```

## 8. Done means (checklist for the poster agent)

- [ ] A rider understands what it is and what to do in about 3 seconds (headline + QR + call to action).
- [ ] The QR code meets section 5 and was tested at print size on iPhone and Android.
- [ ] The URL is printed under the code.
- [ ] The disclaimer is present; no university or operator logos, names as branding, or maroon.
- [ ] No accuracy, speed or "on time" claims; no invented numbers; no store badges.
- [ ] No en or em dash characters anywhere on the poster.
- [ ] Green is used only for "live"; blue is the one accent; the app icon is unchanged.
- [ ] Deliver a print-ready PDF at the chosen size with 0.125 in (3 mm) bleed, plus a PNG preview.
