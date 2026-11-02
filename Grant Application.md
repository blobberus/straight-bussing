# Grant Application: Straight Bussing (briefing for the agent who will write the application)

This document gives an agent with **no prior context** everything needed to draft the student's application to the
University of Chicago **Dean's Grants for Student Life (DGSL)** for the project **Straight Bussing**: what the project
is, how it works, what has already been built and measured, what the grant would pay for, and how each part of the
application form and each review criterion should be answered.

Prepared 2026-11-02 from the project repository (github.com/blobberus/straight-bussing) and the DGSL web page
(https://college.uchicago.edu/student-life/deans-grants-student-life, read 2026-11-02). Numbers are dated; where a
fact must be confirmed or filled in by the student, it is marked **[FILL IN]** or **[CONFIRM]**.

---

## 0. Read this first (rules for the drafting agent)

1. **Do not invent facts.** Use only what is in this document, or ask the student. Every number below has a date and
   a source. If a number is older than a few weeks when you write, ask the student for a fresh one.
2. **Personal details are not in this file on purpose** (this repository is public). Ask the student for: full name,
   year, major, student ID or CNetID if the form asks, email, phone, expected graduation quarter, and the advisor's
   name, title, department and email. Never put those details back into the repository.
3. **Frame it as a student-life service project, not research.** DGSL does **not** fund research, academic projects,
   BA theses or conferences (those go to the College Center for Research and Fellowships). Straight Bussing is a free
   campus service that helps students get around safely and on time. The prediction model and backtesting are how the
   service is made accurate, not an academic study. Avoid words like "research study", "thesis", "experiment on
   students", "paper". Prefer "build", "test", "launch", "improve the arrival times students see".
4. **No salaries, stipends or hired services** can be funded. The budget below only buys things: memberships, cloud
   computing, data access, a test device, printing. Nobody is paid. (If the office considers cloud subscriptions a
   "service", the student will ask; see section 11.)
5. **No retroactive funding.** List only purchases made **after** the award decision. Anything already bought (for
   example an Apple Developer membership bought before the decision) cannot be reimbursed; in that case list the
   next renewal instead.
6. **Accuracy about the app's status.** Straight Bussing is **unofficial**. UChicago Transportation and Passio
   (the shuttle tracking vendor) **gave permission** to use the shuttle data (2026-10-11), which is not an endorsement.
   The app never uses UChicago logos and does not present itself as the official UGo app; it links to the official
   PassioGO app and the UCPD number 773.702.8181. Describe it that way.
7. **Tone and length.** Clear, specific, modest, evidence-first. The committee scores "quality of application and
   written material" first: short paragraphs, concrete numbers, no hype.

---

## 1. The grant (DGSL) in brief

Source: the DGSL page (link above), read 2026-11-02.

| Item | What the page says | What it means for this application |
|---|---|---|
| Purpose | One-time funding for student life, leadership or public service projects that enrich College and University culture and increase engagement in the neighborhood | Straight Bussing is a free service for every student who rides the shuttles, and the CTA expansion reaches into Hyde Park |
| Eligibility | Current full-time College undergraduates in good standing who plan to enroll the next quarter; individual or group | Individual application **[CONFIRM the student is full-time and enrolling next quarter]** |
| Amount | Individuals up to **$1,500**; groups up to $1,500 per person, at most $6,000; the committee sets the award | Request **$1,500** (section 11); a $1,000 version is ready if the committee trims |
| Once per career | A student may receive only **one** DGSL grant | Worth making this one complete |
| Advisor | A current UChicago staff or faculty advisor must support the project and submit an evaluation; their name and email go on the form; confirm they agree **before** submitting | Advisor still being arranged (section 4). The application cannot be complete without one |
| Not funded | Research, academic projects, BA theses, academic conferences; salaries, hired services, stipends; retroactive costs; the same expense funded by another University office | See rules 3 to 5 above |
| IRB | Projects with human subjects or identifiable private information need an IRB exemption or approval | The app collects no identity (section 7.8). Do **not** describe surveys or user studies as research. If the student plans any survey beyond product feedback, they should ask IRB staff first |
| Graduating students | Their projects must take place during the academic year | **[CONFIRM graduation quarter]**; the plan below ends by mid June 2027 |
| Deadlines | 11:59 PM on Sep 30, Oct 15, Oct 31, Nov 15, Nov 30, Dec 15, Dec 31, Jan 15, Jan 31, Feb 15, Feb 28, Mar 15, Mar 31, Apr 15, Apr 30; one-week grace for recommendation letters | Next: **Nov 15, 2026**, then Nov 30 and Dec 15. Pick the first deadline the advisor can meet |
| Decision | Within two to three weeks of the deadline (the page states both) | A project whose start falls before the decision counts as retroactive: start dates in section 8 assume a decision about three weeks after the chosen deadline |
| After the award | An activity report reflecting on the project plus an updated expense report, before the end of the academic year | Plan for receipts and a short report in June 2027 (section 8) |
| Contact | collegedeangrants@uchicago.edu; The College, Harper Memorial Library, 1116 E. 59th St.; 773.702.1234 | For questions such as "do cloud subscriptions count as hired services?" |
| Form | Microsoft Form: https://forms.cloud.microsoft/r/yU0dAN5MXn (it did not render without signing in, so the field list below comes from the DGSL page and the student's notes; check the live form for word limits) | |

**Review criteria** (from the page): (1) quality of the application and written material; (2) project viability and
feasibility; (3) student preparation that ensures success and completion; (4) the staff or faculty advisor's
recommendation. Section 13 maps this project to each.

---

## 2. The form, field by field (where the content is)

| Form field | Use | Status |
|---|---|---|
| Student biographical data | Ask the student (rule 2) | **[FILL IN]** |
| Faculty or staff advisor information | Section 4 | **[FILL IN when confirmed]** |
| Project title | Section 5 | Ready (pick one) |
| Proposal summary | Section 6 (a 150-word draft) | Ready |
| Description of proposed project | Section 7 (problem, what exists, how it works, plan, deliverables, measures, risks) | Ready |
| Duration of project | Section 8 | Ready (adjust to the chosen deadline) |
| Names of project collaborators | Section 9 | Ready |
| Relevance of project to student life on campus | Section 10 | Ready |
| Request project funding | Section 11 ($1,500) | Ready |
| Itemized project budget | Section 11 table | Ready **[CONFIRM prices at purchase time]** |
| Advisor evaluation | Section 4 (what to send the advisor) | Advisor to submit |

---

## 3. Student biographical data

**[FILL IN]** from the student: name, year, major / intended major, expected graduation, email, phone, CNetID if
asked, whether the project is on behalf of a Recognized Student Organization (it is **not**: individual project,
so no Center for Leadership and Involvement advisor is needed).

Useful facts about the student's work for the bio or the "preparation" answer (all verifiable in the repository):
the student designed and built Straight Bussing from scratch starting October 7, 2026: the website and installable
web app, a native iPhone app, an automated data collection system, and a prediction test bench (section 12).
**[CONFIRM with the student how they want to describe their background, relevant courses and skills, and the tools
they used: the project was built with modern developer tools including GitHub Actions and an AI coding assistant;
let the student decide how to present this, and keep it truthful if the form asks.]**

---

## 4. Faculty or staff advisor

**Status: not yet confirmed (the student is arranging it).** The form needs at least one current UChicago staff or
faculty advisor's name and email, and the advisor must agree to submit an evaluation **before** the application is
sent (one-week grace after the deadline for the letter).

Good fits (no names here; the student chooses): a faculty member in computer science, data science, statistics or
public policy who can speak to the technical plan; or a staff member in a student life or campus operations office
who can speak to the benefit for students. Whoever it is should be able to vouch for feasibility and the student's
follow-through.

**Short note the student can send a prospective advisor** (adapt freely):

> I am applying for a Dean's Grant for Student Life (up to $1,500) for Straight Bussing, a free, unofficial tracker
> for the UGo shuttles that I built this quarter (live at blobberus.github.io/straight-bussing, with an iPhone app
> ready for TestFlight). UChicago Transportation and Passio gave me permission to use the shuttle data. Since
> October 8 it has logged over 75,000 real bus arrivals, and my tests show Passio's arrival times are later than the
> buses most of the time. The grant would pay for the App Store membership, the servers and computing to collect data
> and train a better arrival-time model, traffic data, and adding nearby CTA buses for Hyde Park. Would you be willing
> to be my advisor and submit a short evaluation form by [DEADLINE]? I can send a one-page summary.

**[FILL IN]** advisor name, title, department, email; date they agreed.

---

## 5. Project title (options)

1. **Straight Bussing: Accurate, Free Shuttle Arrival Times for UChicago Students** (recommended)
2. Straight Bussing: Smarter UGo Shuttle and Hyde Park Bus Tracking for Students
3. Getting Students There on Time: A Student-Built Shuttle Tracker with Better Predictions

---

## 6. Proposal summary (draft, about 150 words)

> Straight Bussing is a free, student-built app that shows where UChicago's UGo shuttles are and when they will
> arrive. It is already live as a website and installable web app, with a native iPhone app ready for testing, and
> UChicago Transportation and Passio have given permission to use the shuttle data. Since October 8, 2026 it has
> recorded more than 75,000 real bus arrivals at 93 stops on 14 routes, and its tests show the times riders see today
> are usually too optimistic: buses arrive later than shown about 9 times in 10. This grant would let me launch the
> iPhone app on the App Store, run the always-on data collection, train and backtest a prediction model that gives
> students more accurate arrival times, and add the CTA buses students use around Hyde Park. Every purchase is for
> the service itself; no one is paid. The result is a safer, less stressful commute, especially at night and in
> winter, for any student who rides.

---

## 7. Description of the proposed project

### 7.1 The problem students face

- UChicago runs the **UGo shuttles**: nine daytime routes on weekdays (for example Red Line/Arts Block, Friend
  Center & Metra, Drexel, Apostolic, Midway Metra, 53rd Street Express), four **NightRide** routes every evening
  (North, South, East, Central; 4 PM to midnight, every 15 to 30 minutes), the Regents Express, the South Loop
  Shuttle on Friday and Saturday, and the Downtown Campus Connector. Riders tap a University ID. (Source: UChicago
  Safety & Security, Shuttle Services page.) The University itself says "having reliable transportation options is an
  important part of staying safe."
- The official tracker is the vendor's PassioGO app. Students waiting outside need to know **when the next bus will
  really come**, not only where it is.
- **Measured problem** (this project's own test of the times PassioGO shows, from the public feed, October 12 to 30,
  2026, 183,904 scored predictions): buses arrived **later than shown 89% of the time**, on average **5.2 minutes**
  later at the lead times tested. Under the project's accuracy goal (a predicted time counts as right if it is within
  1 minute when the bus is under 20 minutes away, 2 minutes at 20 to 30 minutes, 3 minutes beyond, and almost never
  too late), PassioGO's times were right only **10% to 21%** of the time, depending on how far ahead. (Sources:
  `docs/GOAL-AND-METHOD.md`, data repo `algorithm-test/CONCLUSION.md`.)
- Where it goes wrong most (the "lateness perpetrators" found in the data): frequency-based trips with no timetable
  (the Downtown Campus Connector), buses already running more than 10 minutes late (PassioGO restarts the next trip on
  its printed time as if the bus were on time), the Red Line/Arts Block route (two stops about 10 minutes later than
  shown on average), and the 3 to 7 PM rush.
- A wrong time is not a small thing: a student leaves too early and waits in the cold or the dark, or leaves too late
  and misses the last bus of the night.

### 7.2 What Straight Bussing is today (built and running)

**Live at https://blobberus.github.io/straight-bussing/** (website and installable web app, "Add to Home Screen" on
iPhone and Android). A native iPhone app (SwiftUI and Apple Maps) is built automatically and ready for TestFlight and
App Store submission. Free, no account, no ads, no tracking of identity.

What a student can do (functionality):
- **See every shuttle live on a map** that updates every 10 seconds, with each bus moving smoothly along its route
  line; buses are numbered when a route has several.
- **See the next arrivals at a glance**: the nearest stop and its next buses appear without any tap.
- **Plan a trip**: search any place near campus (an on-device index of about 1,900 places, typo tolerant), get walk +
  shuttle directions with up to one transfer, walking paths on real sidewalks, and "close enough to walk" when walking
  is faster.
- **Follow a trip in progress**: "Arriving In: 4 min", a timeline of stops, "Get off in 2 stops" alerts, your position
  shown on the bus you ride.
- **Service alerts**: the operator's alerts are shown in full, with call links to route help and to UCPD
  (773.702.8181) whenever no bus is reporting.
- **Honesty about data**: a clear warning whenever the live feed is late or down; estimates are labeled "est."; it
  never claims to be official.
- **Personal setup**: custom route sets and favorite stops ("My Routes"), hide or show routes, "Lines by Time" (which
  lines run at a chosen time), light and dark themes, bus-near alerts.
- **Accessibility**: large tap targets, screen reader labels, contrast checked in light and dark, reduced motion.

How it looks (interface description, for the application text): a full-screen map in the style of Apple Maps or
Citymapper, with a bottom sheet that slides up and down over it. The sheet has three tabs: **Current trip** (the next
bus near you, or your trip in progress), **Routes** (every line, whether it is running, its stops and hours), and
**My Routes**. A floating search bar at the top opens directions; a settings gear and a clock ("Lines by Time") sit
beside it. Colors are restrained: green means live data only, everything else is neutral, with matching dark mode.

### 7.3 How it works (plain language, no code)

1. **Data in.** Passio publishes the UGo shuttles' live positions, predicted arrival times and service alerts as open
   transit data feeds (GTFS-realtime), plus the timetable (GTFS). The app reads them directly in the student's
   browser or phone. **Permission:** UChicago Transportation and Passio granted permission to use this data
   (2026-10-11; the written permission will be attached for App Store review).
2. **Ground truth.** An automated collector watches every bus every 10 seconds whenever buses run and records when
   each bus really reached each stop, plus what PassioGO was showing riders beforehand. It runs on GitHub's cloud
   (free for public projects), stops by itself when no bus is running, and starts again before service.
3. **Quality and safety nets.** Every run tests its own code first, refuses to save data that would lose records,
   records which timetable it used, and opens an automatic alert if anything looks wrong (a gap, an outage, a broken
   update). Run over the earlier weeks, these checks found a real 40-minute feed outage (October 28) that had gone
   unnoticed. A daily job archives everything,
   and a public data repository (github.com/blobberus/straight-bussing-data) shares the arrival records, a bus
   movement viewer and the methods.
4. **Predictions and backtesting.** A test bench scores any prediction method against the accuracy goal by
   "backtesting": each model is trained only on earlier days and graded on later days it never saw, exactly as it
   would face the future. The best model so far is shown to riders only once it beats PassioGO without being late
   more often, and its times are labeled "est.".
5. **Privacy.** No account, no identity. Location stays on the device (walking directions send only rounded walk
   endpoints to a routing service; a typed search may go to a public place-search service when the built-in index has
   few matches). The website counts visits anonymously (a random number per browser, never a name, email or exact
   location); the iPhone app collects nothing (App Store label "Data Not Collected"). Full text: the privacy policy.

### 7.4 The prediction model: preliminary results and the plan

Preliminary results (test days October 20 to 30, 2026, each model trained only on earlier days; share of predictions
that meet the accuracy goal, by how far ahead):

| Method | under 10 min | 10 to 15 | 15 to 20 | 20 to 30 | 30 to 45 |
|---|---|---|---|---|---|
| PassioGO (what riders see now) | 18% | 10% | 11% | 21% | 12% |
| Small neural network, tuned so it is never late more often than PassioGO | 27% | 15% | 15% | 26% | 13% |

So a learned correction already improves the times by about 4 to 9 points up to 30 minutes ahead without making
them more dangerous, but no method meets the goal (half of predictions) yet. Fitting models even with the answers in hand stays under about a
third, which shows that **better inputs**, not a bigger model, are what is missing. (Sources: data repo
`algorithm-test/CONCLUSION.md`, `RouteKnower.md` experiment E26.)

The plan funded by this grant:
1. **Better inputs:** how late a bus will leave the end of its line after a late arrival; spacing to the bus ahead on
   frequency routes; time spent at each stop; traffic (a traffic data API) and weather; when routes drop from two buses
   to one (already being recorded).
2. **Train and backtest** a small model (it runs on the phone itself, so no server is needed for riders) on more weeks
   of data, including winter weather.
3. **Ship it carefully:** shown only where it beats PassioGO in backtests and is not late more often; labeled
   "est."; PassioGO's own time stays available.
4. **Keep collecting** ground truth all year (the always-on server below makes collection independent of a single
   provider).

### 7.5 Expansion: CTA buses and trains around Hyde Park

Why: many students also ride CTA buses, several of which serve campus directly. UChicago's transportation pages list
CTA routes **2, 6, 15 and 28** for reaching campus, **171** and **172** (free for students with a University ID), and
**192**; route **55** connects to the Garfield Red Line, and route **4** runs on Cottage Grove. The Metra Electric
stops at 59th, 55th-56th-57th and 51st-53rd Streets also matter. Students should see shuttles and CTA together and get
honest times for both.

Data access (verified 2026-11-02, to reconfirm when building):
- **CTA Bus Tracker API** and **CTA Train Tracker API**: free developer keys under CTA's Developer Terms of Use;
  bus data refreshes about every 30 seconds; the default daily limit appears to be 100,000 requests per key (older
  documents say 10,000; confirm with CTA). Sources: transitchicago.com/developers.
- **Metra GTFS-realtime**: free key with a license agreement; data must be redistributed through the app's own host.
  Source: metra.com/developers.
- Neither CTA nor Metra publishes a history of where buses actually were, so the project collects its own CTA ground
  truth for the Hyde Park routes (same method as for the shuttles) to train CTA predictions. This is why the budget
  includes a second collector and extra training compute.

### 7.6 Deliverables and milestones

| By | Deliverable (functionality) | Interface |
|---|---|---|
| Month 1 | iPhone app on TestFlight for student beta testers; always-on collector server running next to the cloud collector; daily off-site backups | App Store-quality screens matching the website |
| Month 2 | **iPhone app on the App Store** (free); traffic and weather inputs collected | App Store listing, privacy label "Data Not Collected" |
| Month 3 | Prediction model v1 trained and backtested on 10+ weeks of data, including winter; public backtest report | "est." times shown only where they beat PassioGO |
| Month 4 | Model v1 shipped in the website and iPhone app (on-device) | Optional "Passio time / our estimate" detail on a stop |
| Month 5 | CTA Hyde Park buses (2, 4, 6, 15, 28, 55, 171, 172, 192) and nearby trains shown live; CTA collection running | CTA lines next to shuttles on the map and in directions, clearly labeled by operator |
| Month 6 | CTA prediction backtest; activity and expense report to the College | Final report and public data summary |

### 7.7 How success will be measured

- **Accuracy:** share of predictions meeting the goal, against PassioGO, on days the model never saw (target: beat
  PassioGO at every lead time, and never be "too late" more often than PassioGO).
- **Reliability:** share of service time the collector covered (it has been near 100% since October 10, 2026, with
  one Passio outage recorded).
- **Use:** anonymous weekly visitors, installs from the App Store, share of visits from students who added it to their
  home screen. **[FILL IN current numbers from the usage Summary tab before submitting.]**
- **Feedback:** responses to the in-app beta feedback form.

### 7.8 Risks and how they are handled

| Risk | Mitigation already in place or planned |
|---|---|
| Data access changes | Written permission from UChicago Transportation and Passio; the app reads public open-data feeds; the official app and phone number are always linked |
| Feed outages | The app warns riders when data is late; the collector records outages and alerts the developer |
| A model gives wrong times | Shown only after beating PassioGO in backtests, never late more often, labeled "est."; PassioGO's own times remain |
| App Store review | The release pipeline already exists and has passed a dry run; the permission letter goes with the submission |
| Dependence on one cloud provider | The funded always-on server and off-site backups (all data is already backed up off GitHub) |
| Privacy | No identity is collected; location never leaves the device except rounded walking-route endpoints for walking directions; anonymous visit counts only on the website |
| Student availability | The core app is finished and runs by itself; the grant work is incremental and fits a normal course load |

---

## 8. Duration of the project

Suggested: **about 6 months, from the award decision to mid June 2027** (Winter and Spring Quarters), for example
**January 4 to June 12, 2027** if submitted by the December 15 deadline, or **December 1, 2026 to June 12, 2027** if
submitted by November 15. The activity and expense reports go in before the end of the academic year.
**[CONFIRM the chosen deadline and graduation quarter; if graduating, everything must happen within the academic year.]**

---

## 9. Names of project collaborators

**None: an individual project designed, built and run by the student.** (Acknowledge, not as collaborators:
UChicago Transportation and Passio for permission to use the shuttle data; the advisor; student beta testers.)
**[CONFIRM no one else should be listed.]**

---

## 10. Relevance of the project to student life on campus

Points to make (pick the strongest three or four):
- **Every student who rides benefits, for free.** The shuttles carry students between dorms, classes, the Medical
  Center, the Red Line and Metra, and downtown. Accurate times mean less waiting and fewer missed buses.
- **Safety at night.** NightRide exists so students can get home safely from 4 PM to midnight. Knowing when the bus
  will truly arrive means less time waiting alone in the dark; the app always shows the UCPD number and the operator's
  alerts when no bus is reporting.
- **Chicago winters.** Minutes at a stop matter at -10 °F; honest arrival times let students wait indoors.
- **Built by a student, for students, in the open.** Free, no ads, no account, privacy first; its data and methods are
  public so other students can learn from them or build on them.
- **Neighborhood engagement.** The CTA expansion covers the buses students use to reach Hyde Park, Woodlawn, the Red
  and Green Lines and downtown (routes 2, 4, 6, 15, 28, 55, 171, 172, 192), making the neighborhood easier to explore.
- **Accessible.** Screen reader support, large controls, high contrast, dark mode, reduced motion.
- **Complements, not replaces, official tools.** It points to the official app and phone line and labels itself
  unofficial.

---

## 11. Funding request and itemized budget

**Request: $1,500** (the individual maximum). A **$1,000** version is listed below in case the committee awards less.

All prices checked 2026-11-02 from the providers' pages or current price guides **[CONFIRM at purchase; keep
receipts]**. Durations cover December 2026 to June 2027 (7 months) so everything falls within the academic year.
Nothing is a salary, stipend or payment to a person. Nothing is bought before the award (no retroactive costs).
No other University office is paying for these items.

| # | Item | Purpose | Cost basis | Amount |
|---|---|---|---|---|
| **A. Launch the app** | | | | |
| A1 | Apple Developer Program membership, 1 year | Required to publish the free iPhone app on the App Store and run TestFlight beta testing | $99 per year (Apple) | $99.00 |
| A2 | Google Play Console registration | Publish the app for Android students (a Play Store listing of the web app) | $25 one-time (Google) | $25.00 |
| A3 | Custom web domain, 1 year | A short, memorable address for posters and sharing (the site stays free on GitHub Pages) | about $20 per year **[CONFIRM registrar price]** | $20.00 |
| **B. Track the real buses (data collection)** | | | | |
| B1 | Always-on cloud server for shuttle data collection | Collects bus positions every 10 s all year, independent of the free GitHub runner; also stores and serves model files | DigitalOcean Basic droplet, 2 GiB, $12 per month x 7 | $84.00 |
| B2 | Off-site backup storage | Daily backup of all collected data outside GitHub | Google One 100 GB, $1.99 per month x 7 **[CONFIRM plan]** | $13.93 |
| **C. Train and backtest the prediction model** | | | | |
| C1 | Google Colab Pro+ (GPU notebooks) | Training and backtesting the arrival-time model on months of data; long background runs | $49.99 per month x 6 (600 compute units a month) | $299.94 |
| C2 | Pay-as-you-go GPU compute | Larger model comparisons and hyperparameter searches when Colab units run out | Colab Pay As You Go, $9.99 per 100 units x 15 | $149.85 |
| **D. Data access (APIs)** | | | | |
| D1 | Traffic data API (Google Maps Platform Routes, traffic-aware) | Live and typical traffic for the rush-hour delays that most hurt predictions | Free 5,000 calls a month per Pro SKU, then about $10 per 1,000 **[CONFIRM]**; capped budget | $250.00 |
| D2 | CTA Bus Tracker, CTA Train Tracker, Metra GTFS-realtime keys; weather (National Weather Service / Open-Meteo) | Real-time CTA and Metra data, weather inputs | Free keys | $0.00 |
| **E. CTA expansion (Hyde Park)** | | | | |
| E1 | Second cloud server for CTA data collection | Collects CTA bus positions on the Hyde Park routes to build CTA ground truth (CTA publishes no history) | DigitalOcean Basic droplet, 2 GiB, $12 per month x 6 | $72.00 |
| E2 | Extra training compute for CTA predictions | Train and backtest CTA arrival predictions | Colab Pay As You Go, $9.99 per 100 units x 10 | $99.90 |
| **F. Testing and reaching students** | | | | |
| F1 | Refurbished Android test phone | Test the web app, Android listing, location and notifications on Android (the student has only an iPhone **[CONFIRM]**) | about $175 **[CONFIRM model and price]** | $175.00 |
| F2 | Printed QR posters and flyers | Recruit beta testers and tell riders about the free app (posting only where permitted) | about $100 **[CONFIRM campus print shop quote]** | $100.00 |
| **G. Contingency** | | | | |
| G1 | Sales tax and price changes on the items above | Covers taxes and small price increases; unused funds are reported in the expense report | about 8% | $111.38 |
| | **Total** | | | **$1,500.00** |

Check of the arithmetic: A $144.00 + B $97.93 + C $449.79 + D $250.00 + E $171.90 + F $275.00 + G $111.38 = $1,500.00.

**If $1,000 is awarded:** A1 $99.00, A2 $25.00, B1 $84.00, B2 $13.93, C1 $249.95 (5 months instead of 6),
C2 $99.90 (10 x 100 units instead of 15), D1 $150.00 (lower cap), E1 $72.00, E2 $99.90, F2 $75.00, G1 $31.32
= $1,000.00. The Android test phone (F1) and the domain (A3) are dropped first.

Notes for the drafting agent:
- **Why these and not others:** the iPhone app cannot reach students without the Apple membership; reliable
  predictions need continuous ground truth (servers) and computing to train and backtest; the biggest remaining
  error is traffic, which needs a traffic data source; CTA data is free but CTA keeps no history, so the project must
  collect its own.
- **[CONFIRM with collegedeangrants@uchicago.edu if unsure]** whether cloud subscriptions (servers, Colab, APIs)
  count as "hired services". They are purchases of computing, not people, but ask if in doubt; if they are excluded,
  replace them with the closest allowed equivalent and say so.
- If the student already bought the Apple membership, do not list A1 as a new expense; list the renewal only if it
  falls inside the project period.

---

## 12. Student preparation (evidence the project will be finished)

Everything here is already done and checkable (repository github.com/blobberus/straight-bussing, live site
blobberus.github.io/straight-bussing):

| What | Evidence (as of 2026-11-02) |
|---|---|
| Live product | Website and installable web app live since October 8, 2026; redesign in the style of Apple Maps; dark mode; accessibility pass |
| Native iPhone app | SwiftUI + Apple Maps app at parity with the website, built and tested automatically in the cloud; App Store release pipeline ready (dry run passed); TestFlight plan written |
| Data collection | 75,000+ real arrivals recorded at 93 stops on 14 routes, 24 buses, 26 service days (October 8 to November 2, 2026); about 312,000 records of what PassioGO showed before each arrival; coverage near 100% since October 10 |
| Data quality systems | Automatic self-tests, a guard against data loss, timetable versioning, automatic health alerts, daily archive, off-site backup (all added after a risk review on November 1, 2026) |
| Prediction test bench | Backtesting framework scoring PassioGO, timetables, boosted trees and neural networks against the accuracy goal; leak checks; written conclusion (data repo `algorithm-test/`) |
| Open data | Public data repository with per-day CSVs, a bus movement viewer and the methodology, synced automatically every 30 minutes |
| Engineering discipline | About 400 commits since October 7, 2026; hundreds of automated tests (over 500 browser tests and 20 Python test suites); documented runbooks and a data collection log |
| Permission | UChicago Transportation and Passio granted permission to use the data (2026-10-11) |
| Feedback loop | In-app beta feedback form; anonymous usage statistics on the website |

**[FILL IN]** relevant courses, prior projects, leadership, and how many hours a week the student will commit.

---

## 13. How this application meets the review criteria

| Criterion | What to emphasize |
|---|---|
| Quality of application and written material | Clear problem with measured numbers; concrete deliverables by month; a budget that adds up and ties each item to a deliverable |
| Project viability and feasibility | The app already works and is live; data permission granted; prices verified; free data sources identified; risks have mitigations; the work fits six months |
| Student preparation | Section 12: built from scratch in weeks, with tests, monitoring and documentation; preliminary results already in hand |
| Advisor recommendation | Give the advisor this document's sections 6, 7.4, 11 and 12, the live link, and enough time before the deadline |

---

## 14. Reference: links and numbers

| Thing | Value | Source / date |
|---|---|---|
| Live website | https://blobberus.github.io/straight-bussing/ | live since 2026-10-08 |
| Code repository | https://github.com/blobberus/straight-bussing | |
| Public data repository | https://github.com/blobberus/straight-bussing-data (viewer: https://blobberus.github.io/straight-bussing-data/) | synced every ~30 min |
| Privacy policy | https://blobberus.github.io/straight-bussing/privacy.html | |
| Arrivals recorded | 75,123 (93 stops, 14 routes, 24 buses, Oct 8 to Nov 2, 2026) | data branch, 2026-11-02 |
| Passio predictions recorded | about 312,000 rows | data branch, 2026-11-02 |
| PassioGO accuracy (goal met) | 18% / 10% / 11% / 21% / 12% (under 10 / 10-15 / 15-20 / 20-30 / 30-45 min) | Oct 20 to 30, 2026 |
| Best safe model | 27% / 15% / 15% / 26% / 13% | same |
| Buses later than shown | 89% of predictions, 5.2 min on average | Oct 12 to 30, 2026 |
| Data permission | granted by UChicago Transportation and Passio | 2026-10-11 |
| UCPD 24/7 | 773.702.8181 | UChicago Safety & Security |
| DGSL page | https://college.uchicago.edu/student-life/deans-grants-student-life | read 2026-11-02 |
| DGSL form | https://forms.cloud.microsoft/r/yU0dAN5MXn | |
| CTA developer center | https://www.transitchicago.com/developers/ | read 2026-11-02 |
| Metra developers | https://metra.com/developers | read 2026-11-02 |
| Apple Developer Program | https://developer.apple.com/programs/ ($99 per year) | read 2026-11-02 |
| Google Play Console | https://support.google.com/googleplay/android-developer/answer/6112435 ($25 one-time) | read 2026-11-02 |
| Colab pricing | https://colab.research.google.com/signup (Pro $9.99, Pro+ $49.99 per month) | read 2026-11-02 |
| DigitalOcean droplets | https://www.digitalocean.com/pricing/droplets (Basic from $4; 2 GiB $12 per month) | read 2026-11-02 |
| Google Maps Platform pricing | https://developers.google.com/maps/billing-and-pricing/pricing | read 2026-11-02 |

Deeper project documents (in the code repository) if the drafting agent needs detail: `docs/GOAL-AND-METHOD.md`
(the accuracy goal and how predictions are scored), `docs/TEN-PERCENT-SHORTFALLS.md` (where PassioGO falls short),
`RouteKnower.md` (the prediction plan and experiment log), `docs/DATA-COLLECTION-LOG.md` (data checkups and fixes),
`docs/DATA.md` (how data is collected), `ios/README.md` (the iPhone app), `docs/APPSTORE-SUBMIT.md` (App Store steps).

---

## 15. Before submitting: checklist for the student

- [ ] Advisor confirmed, agreed to submit the evaluation, name and email ready
- [ ] Biographical details filled in (not stored in this repository)
- [ ] Deadline chosen (Nov 15, Nov 30 or Dec 15, 2026, ...) and project dates in sections 8 and 11 adjusted
- [ ] Graduation quarter checked (graduating students: project within the academic year)
- [ ] Usage numbers filled in (section 7.7)
- [ ] Prices reconfirmed; nothing already purchased listed as a new expense
- [ ] Asked the College whether cloud subscriptions are fundable, if unsure
- [ ] No survey or study of students described as research (IRB)
- [ ] Wording says "unofficial", permission is not endorsement, official app and 773.702.8181 mentioned
- [ ] Read the live form for word limits and extra questions not listed here
