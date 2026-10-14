# App Store submission guide: from today to "live on the App Store"

Researched 2026-10-10, pipeline and owner decisions added 2026-10-11, from Apple's own pages first (links inline).
Facts I could not confirm on a first-party page are marked **(unverified)**. This guide is about the **native SwiftUI
app in `ios/`**. It builds on, and does not repeat: `docs/APPSTORE.md` (costs, 4.2 analysis), `conversion to
appstore.md` (feature plan, Live Activity and push design), `ios/README.md` (code layout, CI, checklist). Owner:
Nathan, on Windows, no Mac.

## Nathan's checklist (start here)

The release pipeline exists (2026-10-11): GitHub Actions builds the app, Apple's cloud signs it and the run uploads it
to App Store Connect. No Mac, no certificate, no .p12, no provisioning profile. What is left is yours, in this order.
Times are estimates. Run commands in Git Bash, or type them after `! ` in a Claude Code session (replace the
CAPITALS); never paste the contents of the .p8 key into a chat.

1. [ ] **Enroll in the Apple Developer Program as an individual.** 20 min, then Apple's check (often 1 to 2 days,
   unverified). Fastest: the **Apple Developer** app on your iPhone > Account > Enroll (it asks for a photo of your ID);
   or https://developer.apple.com/programs/enroll/ . Needs: two-factor authentication, your legal first and last name,
   a street address, your own card; **99 USD a year**. As an individual, **your legal name is shown as the seller** on
   the App Store. When the confirmation email arrives, copy your **Team ID** from https://developer.apple.com/account >
   Membership details (10 characters, not a secret).
2. [ ] **Accept the agreements.** 5 min. https://appstoreconnect.apple.com > Business: sign the latest agreement (no
   app can be added before). Free app: leave Paid Apps, tax and banking alone. Same Agreements tab > Compliance >
   Digital Services Act > Complete Compliance Requirements > "This is not a trader account" > Done (United States
   only, no income). If https://developer.apple.com/account shows an agreement banner, accept it too.
3. [ ] **Register the two bundle ids.** 3 min, or skip it: the first run of step 8 registers them, then stops and
   asks for step 4. https://developer.apple.com/account/resources/identifiers/list > (+) > App IDs > App > Continue >
   Description `Straight Bussing`, Bundle ID Explicit `io.github.blobberus.straightbussing`, no capabilities >
   Continue > Register. Again with `Straight Bussing Widgets` and `io.github.blobberus.straightbussing.widgets`.
4. [ ] **Create the app record.** 3 min. App Store Connect > Apps > (+) > New App: Platforms iOS; Name
   `Straight Bussing`; Primary Language English (U.S.); Bundle ID `io.github.blobberus.straightbussing`; SKU
   `straightbussing-ios`; User Access Full Access > Create. If the name is taken, pick a variant and tell Claude.
5. [ ] **Create the API key (Admin).** 5 min. App Store Connect > Users and Access > Integrations > App Store Connect
   API > **Request Access** (once; Apple approves case by case, often at once). Then Team Keys > Generate API Key (or
   +): Name `GitHub Actions`, Access **Admin** > Generate. Admin is required: Apple's cloud signing refuses other key
   roles, and a key's role can't be changed later. **Download API Key** (`AuthKey_XXXXXXXXXX.p8`, it downloads only
   once: keep it in your password manager). Copy the **Key ID** (in the key's row) and the **Issuer ID** (above the
   list).
6. [ ] **Create the `appstore` environment.** 2 min. Open
   https://github.com/blobberus/straight-bussing/settings/environments, then New environment > `appstore` >
   Configure environment. Tick **Required reviewers**, add `blobberus`, Save protection rules. Deployment branches and tags > Selected branches and tags > Add deployment branch or tag rule:
   `main` (Ref type Branch), then `v*` (Ref type Tag). Every upload then waits for your click, so no script, agent or
   leaked token can use the Admin key without you. (Claude could not create it: changing repository settings needs
   your permission.)
7. [ ] **Store the key in GitHub: 3 secrets and 1 variable.** 3 min. With your values:
   ```bash
   gh variable set APPLE_TEAM_ID -R blobberus/straight-bussing --body "TEAMID1234"
   gh secret set ASC_KEY_ID     -R blobberus/straight-bussing --env appstore --body "KEYID12345"
   gh secret set ASC_ISSUER_ID  -R blobberus/straight-bussing --env appstore --body "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   base64 -w0 ~/Downloads/AuthKey_KEYID12345.p8 | gh secret set ASC_KEY_P8 -R blobberus/straight-bussing --env appstore
   ```
   In PowerShell instead of Git Bash, the last line is
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\AuthKey_KEYID12345.p8")) | gh secret set ASC_KEY_P8 -R blobberus/straight-bussing --env appstore`.
   Check: `gh secret list -R blobberus/straight-bussing --env appstore` shows the three names (never the values).
8. [ ] **Run the release.** 2 min of clicks, then about 20 to 30 min of build (est.). Open
   https://github.com/blobberus/straight-bussing/actions/workflows/ios-release.yml, then Run workflow > Branch main,
   **Dry run unticked** > Run workflow (or `gh workflow run ios-release.yml -R blobberus/straight-bussing`). Open the run > **Review deployments** > tick appstore > Approve and deploy. A missing
   secret, a rejected key, unregistered ids or a missing app record stop the run in the first minutes with a message
   that says what to do. When it is green, Apple processes the build and emails you (minutes to an hour, est.). Later
   releases: the same, or push a tag `v1.0.1` after Claude bumps the version.
9. [ ] **Install it from TestFlight on your iPhone.** 10 min, then 1 to 2 weeks of riding with it. In App Store
   Connect: Apps > Straight Bussing > TestFlight > Internal Testing > (+) > group `Me` > add yourself > add the build. Install
   **TestFlight** from the App Store, open the invite, Install. Follow `docs/TESTFLIGHT-PLAN.md` (test script, bug
   loop, severities, the external round, when to freeze) and tell Claude what is off; every fix is one more run of
   step 8 (the build number goes up by itself).
10. [ ] **Make the support form.** 2 min. Recipe: "Support form" below. Paste the pre-filled link into
    `web/support-form.js` (the line `export const SUPPORT_FORM_URL = "";`) or send it to Claude. Until then the support
    page offers GitHub Issues, which also satisfies review.
11. [ ] **Fill in the listing.** 30 min of copy and paste. App Store Connect > your app:
    - **App Information**: Subtitle `Unofficial shuttle tracker`; Category Navigation, secondary Travel; **Content
      Rights**: Yes, it shows third-party content, and you have the rights (permission granted 2026-10-11). **Age
      Rating** > Set Up: every answer No / None (no web view, no user-generated content, no chat, no ads): **4+**.
    - **Pricing and Availability**: Free; United States only.
    - **App Privacy**: Privacy Policy URL `https://blobberus.github.io/straight-bussing/privacy.html`; Get Started > "Do
      you or your third-party partners collect data from this app?" **No**. The label reads **Data Not Collected**
      (why that is true: step 17).
    - **Version 1.0** page: the 6 screenshots from the "App Store screenshots" section of
      https://blobberus.github.io/straight-bussing/ios/ (step 19); Promotional Text, Description and Keywords from
      step 18; Support URL `https://blobberus.github.io/straight-bussing/support.html`; Marketing URL
      `https://blobberus.github.io/straight-bussing/`; Version `1.0.0`; Copyright `2026 YOUR LEGAL NAME`.
    - **App Review Information**: Sign-in required off; your name, email and phone (+1 ...); Notes: the text in step
      18; **Attachment: the written permission** from UChicago Transportation / Passio (the email as a PDF or a
      screenshot).
    - **Version Release**: Manually release this version.
12. [ ] **Submit for review.** 2 min. Version page > Build > Add Build (or +) > pick the TestFlight build > Add for
    Review > Submit to App Review. Apple reviews half of all submissions within 24 hours and 90% within 48. If it is
    rejected, paste the message to Claude (section 4 has the replies).
13. [ ] **Release.** 1 min. When the status is Pending Developer Release: Release This Version. Tell Claude, who adds
    the App Store link to the web About and `.claude/rules/project.md`.

Done by Claude (2026-10-10 and 11): [x] release pipeline `.github/workflows/ios-release.yml` with a green dry run
(section 5, step 13); [x] bundle id `io.github.blobberus.straightbussing` and version 1.0.0 in `ios/project.yml`;
[x] privacy and support pages, linked in the app; [x] "Contact support" with the app details, ready for the form;
[x] simulated buses for the reviewer; [x] 6.9-inch screenshot set; [x] export compliance; [x] listing text and review
notes (step 18). Permission: [x] granted (owner statement, 2026-10-11).

## 0. Where the project stands (2026-10-11)

Done in `ios/` (see `ios/README.md`): native SwiftUI + MapKit app, Live Activity widget extension (updated locally,
`pushType: nil`), local notifications, when-in-use location only, no background modes, privacy manifest (no tracking,
no collected data), `ITSAppUsesNonExemptEncryption = NO`, 1024 px opaque icon, unofficial notice and 773.702.8181 in
About and empty states, privacy policy and Contact support links in About and Settings. CI builds **unsigned
simulator** builds on `macos-26` (Xcode 26.6, iOS 26 simulators; the job fails if Xcode is older than 26) and, since
2026-10-11, the **App Store build** (`ios-release.yml`, step 13).

The gaps the 2026-10-10 research found are all closed:
1. **CI Xcode too old to upload** (since 2026-04-28 uploads "must be built with Xcode 26 or later using an SDK for iOS
   26", [upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)): CI runs on `macos-26`
   (Xcode 26.6; [macos-26 image](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md)).
   Deployment target iOS 17 is fine (minimum is iOS 13 since 2026-09-09).
2. **Privacy policy link inside the app** (5.1.1(i), [guidelines](https://developer.apple.com/app-store/review/guidelines/)):
   About and Settings.
3. **Privacy policy and support URLs** ([app information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/),
   [version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)):
   `web/privacy.html`, `web/support.html` on GitHub Pages.
4. **Screenshot size**: CI makes the 6.9-inch set (step 19).
5. **The reviewer may see no buses**: Settings > Demo > Simulated buses (demo) (D7).
6. **Signing**: real bundle id, version 1.0.0, Release signing, cloud-signed upload pipeline (step 13). Only Nathan's
   Apple account, API key and secrets are missing (checklist steps 1 to 7).

## 1. Decisions

| # | Decision | Status | Why |
|---|---|---|---|
| D1 | Individual or organization account | **Individual** (Nathan's checklist step 1) | Organizations must be a legal entity (no DBAs), have a D-U-N-S Number, a public website on their own domain and a work email on that domain ([enrollment support](https://developer.apple.com/support/enrollment/)). A student club is usually not a legal entity. Catch: as an individual, **your legal name is shown as the seller** on the App Store. An app can be moved to an organization account later with App Transfer ([overview](https://developer.apple.com/help/app-store-connect/transfer-an-app/overview-of-app-transfer/)). |
| D2 | Real bundle id | **`io.github.blobberus.straightbussing`** (widget: `.widgets`), set 2026-10-11 as the one setting `SB_BUNDLE_ID` in `ios/project.yml` | Reverse DNS of a domain you control (blobberus.github.io). Permanent: the App Store Connect field "can't be changed after you upload your first build" and an uploaded bundle id can't be reused (reported on [Apple forums](https://developer.apple.com/forums/thread/7401), unverified on a help page). |
| D3 | App name and subtitle | Name **Straight Bussing** (16 of 30 chars), subtitle **Unofficial shuttle tracker** (26 of 30) | Names are 2 to 30 characters ([app information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)). Creating the record (checklist step 4) reserves the name. Keep "UChicago", "University of Chicago", "UGo", "Passio" out of the name, subtitle, keywords, icon and screenshots (2.3.7, 4.1(c), 5.2.1). |
| D4 | UChicago Transportation / Passio permission | **GRANTED** (owner statement, 2026-10-11) | Nathan attaches the written permission in App Review Information > Attachment, and the review notes say so (step 18). Permission is not endorsement: the app, the listing and the pages keep "unofficial" and "not affiliated with or endorsed by" unless Nathan decides otherwise. |
| D5 | Countries | **United States only** | The app is only useful in Chicago. Every account must still declare EU trader status, but if you don't distribute in the EU you are not a trader, so no address or phone is published ([DSA trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/)). |
| D6 | What version 1.0 contains | **The current feature set** (local Live Activity, bus alerts while the app is open, no server) | Without a server nothing about the rider leaves the phone, so the label is "Data Not Collected" and there is no backend to keep alive during review. Server push (P7) can come in 1.1 with an updated label. |
| D7 | Reviewer access to buses at any hour | **Settings > Demo > Simulated buses (demo)** (built 2026-10-10; off by default, never saved). Owner decision 2026-10-11: no demo banner any more; while it is on, the status pill says "Simulated buses" | Guideline 2.1 requires that reviewers can see the full app. Simulated buses must never look real (ship checklist item 1): the pill label stays on every screen. |
| D8 | Support channel | **A Google Form** (owner, 2026-10-11), opened from support.html with the app details filled in; GitHub Issues until the link is set | One pasted link (`web/support-form.js`); recipe in "Support form" below. |
| D9 | App Privacy label | **Data Not Collected** (owner, 2026-10-11) | Step 17. |
| D10 | Polling in Low Power Mode | **20 s** (kept; 10 s otherwise, only while the app is open) | Owner, 2026-10-11. |
| D11 | Operator alert text | **Shown verbatim, including "UGo"** | Owner, 2026-10-11. It is the operator's own wording, quoted as "From the shuttle operator"; "UGo" still stays out of the store metadata and screenshots (D3). |
| D12 | Phone numbers when no bus reports | **The operator's number from the live alert is the primary call, 773.702.8181 the secondary** | Owner, 2026-10-11. |

## 2. Costs

| Item | Cost | Notes / source |
|---|---|---|
| Apple Developer Program, individual | **99 USD per membership year** | "Prices may vary by region" ([enroll](https://developer.apple.com/programs/enroll/)). Pay with your own card, or in the Apple Developer app (gift card balance not accepted) ([app enrollment](https://developer.apple.com/help/account/membership/enrolling-in-the-app/)). |
| Fee waiver | not available | Only for nonprofit, accredited school or government legal entities; individuals excluded ([fee waivers](https://developer.apple.com/help/account/membership/fee-waivers/)). |
| University Program | not available | "The iOS Developer University Program has been discontinued as of May 15, 2024" ([page](https://developer.apple.com/programs/ios/university/)); it never allowed App Store distribution. There is no student program ([enrollment support](https://developer.apple.com/support/enrollment/)). |
| D-U-N-S Number | free, org only | Not needed for D1 = individual ([D-U-N-S](https://developer.apple.com/help/account/membership/D-U-N-S/)). |
| GitHub Actions macOS runners | **0 USD** | "free ... for public repositories that use standard GitHub-hosted runners" ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). If the repo ever goes private: 0.062 USD/min ([pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)). |
| Signing certificate | 0 USD | Apple's cloud-managed distribution certificate, renewed by Apple ([cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/)). |
| Xcode Cloud | not used | "You need to configure your first Xcode Cloud workflow in Xcode" ([docs](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow)), i.e. a Mac once, and our project is generated by XcodeGen, not committed. |
| Cloud Mac (only if debugging needs a real Xcode UI) | about 4 EUR minimum | Scaleway Mac mini M2 from 0.17 EUR/hour with a 24-hour minimum lease ([Scaleway](https://www.scaleway.com/en/mac-mini-m2/)); AWS EC2 Mac also bills at least 24 hours ([AWS docs](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-mac-instances.html)). |
| Google Form (support), TestFlight, App Review, pages on GitHub Pages, export compliance | 0 USD | |
| Apple commission | 0 USD | Free app, no in-app purchases. Do not sign the Paid Apps agreement. |
| **Year 1 total** | **99 USD** | |
| **Every year after** | **99 USD** | Auto-renews; see step 29. |

## 3. Timeline (realistic)

| Phase | Time | Source |
|---|---|---|
| Permission | done 2026-10-11 | owner statement |
| Repo prep and release pipeline (Claude) | done 2026-10-11 | step 13 |
| Enrollment, individual | Apple publishes no time; third parties report 24 to 48 hours, some 2026 forum posts report weeks | (unverified) [Apple forums](https://developer.apple.com/forums/thread/822540) |
| App Store Connect API access request | "reviewed and approved on a case-by-case basis" | [API help](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/); often immediate (unverified) |
| Agreements, ids, app record, key, environment, secrets (checklist 2 to 7) | about 25 minutes | |
| First TestFlight build | 20 to 30 min run (est.), then Apple processing; you get an email | [upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/) |
| Real-iPhone QA on TestFlight | 1 to 2 weeks | also closes the open "QA on a real iPhone" item in `.claude/rules/project.md` |
| App Review | "at least 50% of submissions in less than 24 hours and 90% in less than 48 hours"; first apps often need 1 to 3 rounds (est.) | [App Review](https://developer.apple.com/distribute/app-review/) |
| **Total from enrollment** | **about 2 to 4 weeks** | |

Avoid having the app in review during shuttle breaks (Thanksgiving Break is Nov 23 to 27; check `web/data/service.json`
for reduced service) and late December, when Apple usually slows reviews for the holidays (unverified for 2026).

## 4. Biggest review risks for this app

| # | Guideline | Risk | Mitigation in place | Still to do |
|---|---|---|---|---|
| 1 | **5.2.1, 5.2.2, 4.1(c), Content Rights** | **Low since 2026-10-11: permission granted** (owner statement). 5.2.2: "If your app uses, accesses, monetizes access to, or displays content from a third-party service, ensure that you are specifically permitted to do so under the service's terms of use. Authorization must be provided upon request." App Review asks: "If the app features third-party trademarks or copyrighted content ... provide the authorization to do so" ([App Review](https://developer.apple.com/distribute/app-review/)). | Written permission from UChicago Transportation / Passio; neutral name and icon; "unofficial" and "not affiliated or endorsed" everywhere; official phone and link; no university marks. | Attach the permission in App Review Information > Attachment (checklist step 11), which is where Apple asks for "partnership documentation or authorization"; the review notes say it is attached. Answer Content Rights truthfully (Yes, rights held). Stop names such as "UCHICAGO Medicine - River East" are factual place names; keep them out of metadata. |
| 2 | **2.1 App Completeness** | Medium. The reviewer is far from Chicago and may test when no shuttle runs, so the map looks empty. | Far-away location shows "No stops nearby" with the official contact (no dead end); stale banner; Settings > Demo > Simulated buses (demo), labeled "Simulated buses" in the status pill. | Review notes with service hours in Central Time (step 18). Submit on a weekday during class weeks. |
| 3 | **4.2 Minimum Functionality** | Low. Native SwiftUI with MapKit, Live Activity + Dynamic Island, notifications, offline schedules, on-device search, favorites. | Native app. | The review notes list the native features. |
| 4 | **5.1.1 / 5.1.2 Privacy, 5.1.5 Location** | Low if the label matches reality. Purpose strings must "clearly and completely describe your use of the data"; if location is declined, "offer the ability to manually enter an address". | When-in-use only, asked on tap, station/place search works without location, purpose string, privacy manifest, in-app privacy policy link. | Never describe 773.702.8181 as an emergency feature of this app; it is the official service's number. |
| 5 | **2.5.4 Background, Live Activities, 4.5.3 / 4.5.4 notifications** | Low. | No background modes; Live Activity only during a started trip, ends itself, shows "est." and a stale state; alerts are opt-in. | Do not add the `location` background mode just to keep the Live Activity fresh. |
| 6 | **2.3.7 Metadata** | Low. "don't try to pack any of your metadata with trademarked terms, popular app names". | Keywords without UChicago, UGo, Passio, Metra (step 18). | Operator alerts are shown verbatim in the app, "UGo" included (D11): fine as quoted operator text, but pick store screenshots without such an alert. |
| 7 | **Safety honesty** (our rule, also 2.3.1 accuracy) | Screenshots or text that imply official or exact times. | "est." labels, stale banner, "Simulated buses" pill on simulated screenshots. | Never write "official" or "real-time guaranteed". |

**How to answer a reviewer:** reply in App Store Connect (app > App Review messages), be short and factual, quote the
guideline number, say what you changed or attach the evidence, and resubmit. If you think the reviewer misunderstood,
appeal to the App Review Board (one appeal per rejected submission, give specific reasons), or book a free 30-minute
App Review appointment over Webex ([App Review](https://developer.apple.com/distribute/app-review/)). Example replies
Claude can adapt:
- 5.2.2: "The app shows schedule and vehicle-position data from the public GTFS and GTFS-Realtime feeds that Passio
  publishes for the shuttle system. UChicago Transportation and Passio gave permission for this use; the written
  permission is attached in App Review Information. The app is unofficial, uses no university trademarks, and links
  to the official service."
- 2.1 (empty map): "Shuttles run [hours] Central Time. To see live-looking buses at any time, open Settings and turn on
  Demo > Simulated buses (demo); the status pill then says "Simulated buses" on every screen."
- 4.2: list the native features (MapKit map, Live Activity on the Lock Screen and Dynamic Island, local stop alerts,
  on-device place search, offline schedules, favorites and custom routes, VoiceOver labels).

## 5. Step by step (details behind the checklist)

### Phase A: preparation (done)

1. **[done 2026-10-11] Permission in writing.** UChicago Transportation / Passio gave permission (owner statement).
   Keep the written reply (PDF or screenshot) for App Review Information > Attachment (checklist step 11).
2. **[N] Apple Account ready.** Two-factor authentication on; first and last name exactly your legal name ("Using an
   alias, nickname, or company name ... will cause a delay"); a street address (P.O. boxes are not accepted); your own
   payment card. You must be the age of majority where you live (18 in Illinois); if not, a parent enrolls
   ([enroll](https://developer.apple.com/programs/enroll/)). Where: https://account.apple.com .
3. **[done] Decisions D1 to D12** (section 1).
4. **[done 2026-10-10] Privacy policy and support pages** on GitHub Pages:
   `https://blobberus.github.io/straight-bussing/privacy.html` and `.../support.html` (`web/privacy.html`,
   `web/support.html`, deployed by `pages.yml`), linked from About and Settings on iPhone and from the web About. The
   policy says what leaves the device and to whom (5.1.1(i)), including, since 2026-10-11, the optional support form.
   Keep them in step with both About screens. The support page has "actual contact information" (the support form, or
   GitHub Issues until the form exists) plus the official service number.
5. **[done 2026-10-11] Code ready for release**: `ios/project.yml` has `SB_BUNDLE_ID` =
   `io.github.blobberus.straightbussing` (widget `$(SB_BUNDLE_ID).widgets`, UI tests `.uitests`; `ios.yml`,
   `simulate.sh` and `appetize.py` read it from the built app), `MARKETING_VERSION: "1.0.0"`, and a Release
   configuration with `CODE_SIGN_STYLE: Automatic` and `DEVELOPMENT_TEAM` from `APPLE_TEAM_ID`; Debug stays unsigned
   for the simulator CI. App and widget share the version and build number. There are no entitlements, app groups or
   keychain groups, so nothing else follows the id.

### Phase B: enroll (99 USD)

6. **[N] Enroll as an individual** (checklist step 1). Fastest: the **Apple Developer app** on your iPhone (Account >
   Enroll), which asks you to "take a picture of your photo ID" and charges your Apple Account payment method as an
   auto-renewing yearly subscription; the same device must be used for the whole enrollment
   ([app enrollment](https://developer.apple.com/help/account/membership/enrolling-in-the-app/)). Or on the web:
   https://developer.apple.com/programs/enroll/ . "If you haven't received a membership confirmation within 24 hours of
   your purchase, contact us" with the Enrollment ID ([enrollment support](https://developer.apple.com/support/enrollment/)).
   Note your **Team ID** at https://developer.apple.com/account (Membership details). Turn on Auto-renew there if you
   enrolled on the web.
7. **[N] First App Store Connect sign-in, agreements, DSA** (checklist step 2). https://appstoreconnect.apple.com
   - Business: the Account Holder must sign the latest agreement before any app can be added
     ([add a new app](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)). Free
     apps need no tax or banking forms; leave the **Paid Apps** agreement unsigned (third-party reports, unverified).
     An unsigned updated agreement also breaks cloud signing later; the release run then says "agreement".
   - Business > Agreements tab > Compliance > Digital Services Act > Complete Compliance Requirements: if you only
     distribute in the US and earn nothing, choose "This is not a trader account" (Apple says you must assess this
     yourself).
   - Optional: the App Store Connect app on your iPhone, for review status and replies on the go.

### Phase C: identifiers, key and secrets (no Mac, about 15 minutes)

8. **[N, optional] Register two App IDs** (checklist step 3). The release run's preflight registers missing ones
   through the API (`ios/scripts/asc.py`), so this is only needed if you want to create the app record before the
   first run. https://developer.apple.com/account/resources/identifiers/list > (+) > App IDs > App > Explicit:
   "Straight Bussing" `io.github.blobberus.straightbussing`, "Straight Bussing Widgets"
   `io.github.blobberus.straightbussing.widgets`. **Capabilities for 1.0: none.** Locally updated Live Activities need
   only the `NSSupportsLiveActivities` Info.plist key, which is set ([ActivityKit](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)).
   Later: Push Notifications (P7), Time Sensitive Notifications (P6), App Groups
   `group.io.github.blobberus.straightbussing` on both IDs for a favorite-stop widget (P8). With automatic signing a
   new capability is picked up by the next run (Xcode updates the profiles); no secrets change.
9. **[not needed] Certificate and profiles.** The 2026-10-10 plan (OpenSSL CSR, Apple Distribution certificate, .p12,
   two App Store profiles, five more secrets) is replaced by cloud signing (step 13). It stays below as the fallback.
10. **[not needed]** (was: provisioning profiles; Xcode creates them during the export.)
11. **[N] App Store Connect API key, Admin role** (checklist step 5). Users and Access > Integrations > App Store
    Connect API > **Request Access** (Account Holder; approved case by case). Then Team Keys > Generate API Key, name
    "GitHub Actions", Access **Admin**. Why Admin, not App Manager: signing with the cloud-managed distribution
    certificate needs the Account Holder or Admin role ([cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/));
    a user with another role can be given "Access to Cloud Managed Distribution Certificate", but a key cannot, and
    other keys fail with "Cloud signing permission error" ([Apple forums](https://developer.apple.com/forums/thread/698117),
    confirmed in a 2026-08 report: [rxliuli](https://rxliuli.com/blog/two-pitfalls-of-safari-cloud-signing-in-github-actions/)).
    Download `AuthKey_XXXXXXXXXX.p8` (it "can only be downloaded once") and copy the **Key ID** and **Issuer ID**
    ([API help](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/)). A key's role
    can't be edited; revoke and regenerate instead. An Admin key is powerful, so it lives only in the `appstore`
    environment, whose jobs wait for Nathan's approval (step 12). Revoke it in the same place if it is ever exposed.
12. **[N] Environment and secrets** (checklist steps 6 and 7). Environment `appstore` with Nathan as required reviewer
    and deployment refs `main` + tags `v*` (Settings > Environments; free for public repos). Environment secrets
    `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (base64 of the .p8 file; the PEM text itself also works) and the
    repository variable `APPLE_TEAM_ID` (not a secret). Commands: checklist step 7. Secrets are not passed to workflows
    triggered from forks. Do not paste key contents into a chat.

### Phase D: the release pipeline on GitHub Actions (done 2026-10-11)

13. **[done] `.github/workflows/ios-release.yml`** (Actions > "iOS release (TestFlight / App Store Connect)"; manual
    `workflow_dispatch` and `v*` tags; `runs-on: macos-26`). Two jobs:
    - **release** (`environment: appstore`, so it waits for Nathan's approval): checks that the three secrets and the
      variable exist and look right (readable message and the exact `gh` command when not); on a tag, checks that the
      tag is `v` + `MARKETING_VERSION`; checks `xcodebuild -version` is 26+; writes the key file; **preflight**
      (`ios/scripts/asc.py`, plain App Store Connect API calls): the key is accepted, both bundle ids are registered
      (registers missing ones), the app record exists (else it stops and says to create it); XcodeGen; the
      **unsigned** Release archive (`ios/scripts/release_archive.sh`: `xcodebuild archive ... -configuration Release
      -destination generic/platform=iOS CURRENT_PROJECT_VERSION=<run number> CODE_SIGNING_ALLOWED=NO`, then checks
      ids, versions, the iOS 26 SDK, privacy manifest, bundled data, icon, Info.plist keys and dSYMs); then
      ```bash
      xcodebuild -exportArchive -archivePath SB.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath export \
        -allowProvisioningUpdates -authenticationKeyPath AuthKey_ID.p8 -authenticationKeyID "$ASC_KEY_ID" \
        -authenticationKeyIssuerID "$ASC_ISSUER_ID"
      ```
      with `ios/ExportOptions.plist`: `method` `app-store-connect`, `destination` **`upload`**, `signingStyle`
      `automatic`, `teamID` (filled in from `APPLE_TEAM_ID`), `uploadSymbols`, `manageAppVersionAndBuildNumber` false.
      Xcode signs app and widget with Apple's cloud-managed distribution certificate, creates the App Store profiles,
      and uploads straight to App Store Connect. A failed export is explained (`asc.py explain`: Admin role, missing
      app record, agreement, reused build number, rejected key). The dSYMs are kept 90 days as an artifact.
    - **dry-run** (input `dry_run`; no environment, no secrets, nothing sent to Apple): the same unsigned Release
      archive and checks, plus the helper tests (`ios/scripts/test_asc.py`). First green run: see `ios/README.md`.

    **Build number** = `github.run_number` of this workflow: it only grows, App and widget share it. Re-running an old
    run reuses its number, so start a new run instead (the explain step says so).

    **Why this signing:** the simplest thing that works on a throwaway runner. Archiving unsigned means Xcode never
    needs an Apple Development certificate; with automatic signing at archive time, every fresh runner makes a new
    "Created via API" development certificate whose private key dies with the runner, until the account hits "maximum
    number of certificates" ([rxliuli, 2026-08](https://rxliuli.com/blog/two-pitfalls-of-safari-cloud-signing-in-github-actions/),
    [arabesque PR](https://github.com/isc/arabesque/pull/468), [Homefield PR](https://github.com/BraveKoon/Homefield/pull/19)).
    The export then signs with the cloud-managed certificate, which Apple keeps and renews. Evidence that an unsigned
    archive of an app with a WidgetKit Live Activity extension cloud-signs and uploads this way on `macos-26` with
    Xcode 26.6: a public project's TestFlight run of 2026-10-09
    ([BraveKoon/Homefield run 37954795575](https://github.com/BraveKoon/Homefield/actions/runs/37954795575): "Upload
    succeeded", "EXPORT SUCCEEDED", no CI certificate left). Our first real run is still the test; if the export fails
    there, the fallback is next.

    **Fallback: manual signing** (only if cloud signing fails for this app; costs one evening and five more secrets).
    Create the certificate with OpenSSL (Git Bash), outside the repo:
    ```bash
    openssl genrsa -out sb_dist.key 2048
    openssl req -new -key sb_dist.key -out sb_dist.csr -subj "/emailAddress=YOU@EXAMPLE.COM/CN=Your Legal Name/C=US"
    # upload sb_dist.csr at Certificates > (+) > Apple Distribution, download distribution.cer, then:
    openssl x509 -inform DER -in distribution.cer -out sb_dist.pem
    openssl pkcs12 -export -inkey sb_dist.key -in sb_dist.pem -out sb_dist.p12 \
      -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -passout pass:CHOOSE_A_PASSWORD
    ```
    Two App Store profiles (Profiles > (+) > Distribution > App Store Connect; "SB App Store", "SB Widgets App Store"),
    secrets `DIST_CERT_P12_BASE64`, `DIST_CERT_P12_PASSWORD`, `APP_PROFILE_BASE64`, `WIDGET_PROFILE_BASE64`,
    `KEYCHAIN_PASSWORD`; Claude then adds a keychain import step (`security create-keychain`, `import ... -t cert -f
    pkcs12`, `set-key-partition-list -S apple-tool:,apple:`), copies the profiles to
    `~/Library/Developer/Xcode/UserData/Provisioning Profiles/`, signs the archive manually (`CODE_SIGN_STYLE=Manual`,
    `CODE_SIGN_IDENTITY="Apple Distribution"`) and sets `signingStyle` `manual` + `provisioningProfiles` in the export
    options ([GitHub: sign Xcode apps](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)).
    The API key can then be App Manager. Not chosen first: more secrets, a certificate to renew yearly, and nothing
    that the cloud path lacks for this app. **Xcode Cloud** needs Xcode on a Mac to create the first workflow;
    **fastlane match** adds a private certificates repo and another password.

### Phase E: the App Store Connect record and metadata

14. **[N] Create the app record** (checklist step 4; [help](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)):
    Platform iOS; Name `Straight Bussing`; Primary Language English (U.S.); Bundle ID (step 8, or registered by the
    first run); SKU `straightbussing-ios`; User Access Full. If the name is taken, an error appears now: pick a variant
    (for example "Straight Bussing Shuttles") and tell Claude to update `CFBundleDisplayName` if it should match.
15. **[N] App Information** (sidebar > General > App Information):
    - Subtitle `Unofficial shuttle tracker`; Category Primary **Navigation**, Secondary **Travel** (matches
      `LSApplicationCategoryType`).
    - **Content Rights**: "Does your app contain, show, or access third-party content?" **Yes** (Passio feed data,
      OpenStreetMap places), and confirm you have the necessary rights: permission granted 2026-10-11
      ([rule](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)).
    - **Age Rating** > Set Up Age Ratings: no in-app controls; no capabilities (no web view, so "Unrestricted Web
      Access" is No; links open Safari; no user-generated content, chat, ads); every content item None. Expected result
      **4+** ([values](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/)).
      The 4+/9+/13+/16+/18+ system applies since 2026-01-31.
    - App Store Regulations and Permits > Digital Services Act: not a trader (D5).
    - Accessibility Nutrition Labels: voluntary for now; declare only features that pass Apple's criteria after the
      VoiceOver and Dynamic Type pass ([overview](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/)).
16. **[N] Pricing and Availability**: Price **Free** (0 USD); Availability **United States** only (D5); no pre-order.
17. **[N] App Privacy: Data Not Collected** (decided 2026-10-11, D9). Sidebar > App Privacy: Privacy Policy URL
    `https://blobberus.github.io/straight-bussing/privacy.html`, then Get Started > "Do you or your third-party partners
    collect data from this app?" **No**. Why this is consistent with Apple's rules
    ([app privacy details](https://developer.apple.com/app-store/app-privacy-details/)):
    - **"Collect"** means "transmitting data off the device in a way that allows you and/or your third-party partners
      to access it for a period longer than what is necessary to service the transmitted request in real time", and
      "Data that is processed only on device is not 'collected'". Third-party partners are "analytics tools,
      advertising networks, third-party SDKs, or other external vendors whose code you've added to your app": the app
      contains no third-party code.
    - **Location and search** stay on the device. The exceptions go to third parties only when the rider asks, carry
      nothing that identifies the rider, and are kept by nobody on our side: the rounded start and end of a walking leg
      to Apple Maps (MapKit) for sidewalk directions; typed place text (or its spelling fix) to photon.komoot.io only
      when the on-device index finds fewer than 5 matches or the rider taps "Search for ... instead". The developer
      receives none of it.
    - **The support form** is optional, user-initiated and outside the app: "Contact support" opens
      `support.html` in Safari (not an in-app web view), the app itself sends nothing, and only the form's Submit sends
      what the rider typed (plus the app and device line they can see and edit) to Google Forms. Apple's
      optional-disclosure rule names exactly this case, "data collected in optional feedback forms or customer service
      requests that are unrelated to the primary purpose of the app", for data that is not used for tracking or
      advertising, is collected only infrequently and optionally, and is affirmatively provided by the user each time.
      One criterion speaks of data "provided by the user in your app's interface" with the user's name shown in the
      form; our form is a web page outside the app, so the stronger reason is that the app does not collect it at all
      (like the Support URL on the store page). If Nathan ever wants zero doubt, he can instead declare Customer
      Support and Other User Contact Info (App Functionality, not used for tracking); the choice can be changed without
      a new build.
    - **The schedule check** (at most daily, blobberus.github.io) and the **Passio feed requests** are plain requests
      for public files: no location, search text, ID or cookie.
    - Must change when: server push ships (push token + watched stop leave the device, `conversion to appstore.md`
      section 8); analytics or crash SDKs are added; the support form moves into the app.
    - `ios/App/Resources/PrivacyInfo.xcprivacy` matches (re-checked 2026-10-11): `NSPrivacyTracking` false, no tracking
      domains, `NSPrivacyCollectedDataTypes` empty, and the only required-reason API is UserDefaults (CA92.1, the app's
      own settings; the widget extension uses none, and no file-timestamp, boot-time, disk-space or keyboard APIs are
      used).
18. **[N] Version page "1.0 Prepare for Submission"** (Claude drafted; Nathan pastes):
    - Screenshots: step 19. App icon: taken from the build (the 1024 px opaque PNG `make_icon.py` renders).
    - **Promotional Text** (170 max, 145 used):
      ```
      Live shuttle arrivals, trip directions and a Lock Screen countdown for your ride. Free, no account, no tracking. Unofficial: times are estimates.
      ```
    - **Description** (4000 max, plain text):
      ```
      Straight Bussing shows the campus shuttles in Hyde Park, Chicago, live on a map: where each bus is, when the next one reaches your stop, and how to get somewhere by walking and shuttle.

      WHERE IS MY BUS
      - Open the app and see the next buses at the stop nearest you, with "Leave in 4 min, est." so you know when to head out.
      - Live bus positions on Apple Maps, in route colors, with the direction of travel.
      - Every route's stops, today's hours, schedule changes and the shuttle operator's service alerts.

      GET SOMEWHERE
      - Search a building, cafe or address near campus. Search runs on your iPhone and fixes typos.
      - Up to four trip options with walking and shuttle, ranked by least walking and earliest arrival.
      - Start a trip and follow your bus stop by stop in the app, on the Lock Screen and in the Dynamic Island (updated while the app is open).
      - Bus alerts tell you when your bus is two stops or a few minutes away, while the app is open.

      MAKE IT YOURS
      - Favorite stations, custom routes and your own map order. Hide routes you never ride.
      - Light and dark mode, VoiceOver labels and Dynamic Type.

      HONEST TIMES
      Arrival times come from the live shuttle feed. Ride, wait and total times are estimates, marked "est." with their source. If the live feed is late or down, the app says so instead of showing old times as current. When no bus reports its location, the app shows the operator's alerts and phone numbers.

      PRIVATE BY DESIGN
      No account, no ads, no tracking, no analytics. Your location stays on your iPhone; only the rounded ends of a walking leg go to Apple Maps for sidewalk directions, and an address you type goes to a geocoder only when the on-device search finds too few matches.

      Straight Bussing is an unofficial student project, not affiliated with or endorsed by the University of Chicago or Passio. For official service, safety rides or anything urgent, call 773.702.8181.
      ```
    - **Keywords** (100 bytes, 92 used):
      `shuttle,bus,campus,tracker,transit,hyde park,arrivals,stops,routes,eta,live,commute,schedule`
    - Support URL `https://blobberus.github.io/straight-bussing/support.html`; Marketing URL (optional)
      `https://blobberus.github.io/straight-bussing/`; Version `1.0.0`; Copyright `2026 Your Legal Name`.
    - **App Review Information**: no sign-in required; contact name, email, phone in "+1 ..." format (private); Notes
      below; **Attachment: the written permission** (D4). A short screen recording of real service helps too (record
      one on your iPhone with Control Center > Screen Recording).
    - Release: **Manually release this version** (so launch day is your choice).
    - **Review notes** (4000 bytes max; hours from `web/data/service.json`, 2026-10-08):
      ```
      Straight Bussing is a free, unofficial tracker for the campus shuttles in Hyde Park, Chicago. No login.

      Permission: UChicago Transportation and Passio gave permission for this app to use the shuttle system's public GTFS and GTFS-Realtime feeds; the written permission is attached. The app stays labeled unofficial, uses no university trademarks, and About links to the official service (773.702.8181).

      Live data: shuttles run every day. Most routes run on weekdays from about 7 AM to 10 PM Central Time, and a few night routes run until about 4:30 AM. Outside service hours, or far from Chicago, the map correctly shows no buses and the app says so. To see every feature at any time: Settings > Demo > Simulated buses (demo). It is off by default and never saved; while it is on, the status pill says "Simulated buses".

      Try: tap "Search for a destination", type "Regenstein", choose an option, tap Start. This starts a Live Activity (Lock Screen and Dynamic Island) and the trip timeline in Current trip. Settings > Bus alerts > choose a station: local notifications while the app is open.

      Location is optional and asked only when you tap "Use my location". It stays on the device, except the start and end of a walking leg, rounded to about 10 m, sent to Apple Maps for sidewalk directions.

      Native features: MapKit map, Live Activity and Dynamic Island, local notifications, on-device place search, offline schedules, favorites and custom routes, VoiceOver labels.
      ```
19. **[done] Screenshots.** Required: one set (1 to 10, PNG or JPEG, **no alpha channel**) for **iPhone with Dynamic
    Island (large display)**: 1320 x 2868, 1290 x 2796 or 1260 x 2736 portrait. Only if those are missing, 1284 x 2778
    or 1242 x 2688 ("6.5 inch") become required; smaller sizes are scaled down automatically
    ([specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/)). CI
    (`ios.yml`, `simulate.sh`) boots an iPhone 17 Pro Max simulator, takes six light-mode screens and removes alpha
    (`store_png.py`); download them from the "App Store screenshots" section of
    https://blobberus.github.io/straight-bussing/ios/ (or the `store/` folder of the `ios-simulator-preview` artifact).
    Owner decision 2026-10-11: the shots no longer show a demo banner; simulated buses are labeled by the status pill
    ("Simulated buses"), and the shots must still reflect the real app. Pick frames without an operator alert that
    says "UGo" (D11). Note for later: "iPhone Duo" screenshots become required from April 2027 for apps built with the
    iOS 27.1 SDK.
20. **[done] Export compliance.** `ITSAppUsesNonExemptEncryption = NO` is in `project.yml`, right because the app only
    uses HTTPS through `URLSession`: "the use of encryption that's built into the operating system ... is exempt from
    export documentation upload requirements"
    ([encryption export](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)).
    App Store Connect therefore won't ask per build.

### Support form (Google Form, about 2 minutes; checklist step 10)

Owner decision 2026-10-11 (D8). Claude cannot make the form (it needs Nathan's Google account); everything else is
built: "Contact support" in iOS Settings and About opens
`https://blobberus.github.io/straight-bussing/support.html?contact=1&app=ios&v=<version (build)>&os=<iOS version on
model>` in Safari, the web About opens `support.html?contact=1&app=web&v=<APP_VERSION>`, and `support.html`
(`web/js/support.js`) puts "Straight Bussing <platform> <version>, <OS / device>" into the form's app-and-device answer
and forwards there. Opened without the query (from the App Store page), it describes the browser instead.

1. https://forms.google.com > Blank form, signed in with the Google account that should receive the requests (a
   personal account is simplest; a UChicago account restricts forms to University users by default, see 3). Title
   `Straight Bussing support`; description `Unofficial student project. For safety rides or anything urgent, call
   773.702.8181.`
2. Three questions:
   - `What happened?` Paragraph, **Required** on.
   - `App and device` Short answer, not required (description: `Filled in by the app. Change it if it is wrong.`).
   - `Email, if you want a reply` Short answer, not required.
3. Settings tab > Responses: **Collect email addresses: Do not collect**; under "Requires sign in" turn **off** "Limit
   to 1 response" (and, on a UChicago account, "Restrict to users in University of Chicago"), so nobody has to sign in.
4. Three-dot menu (top right) > **Get pre-filled link** > type `{app}` into "App and device" > Get link > Copy link. It
   looks like `https://docs.google.com/forms/d/e/1FAIp.../viewform?usp=pp_url&entry.123456789=%7Bapp%7D` (Google writes
   `{app}` as `%7Bapp%7D`; both work).
5. Paste it between the quotes of the only line in `web/support-form.js`:
   `export const SUPPORT_FORM_URL = "";`, commit, or send the link to Claude. The browser test
   (`python tools/run_browser_tests.py tests/support.test.html`) checks it is a Google Forms link.
6. Test: open https://blobberus.github.io/straight-bussing/support.html?contact=1&app=web&v=test : the form opens with
   "Straight Bussing web app test, <your browser>" filled in.
7. Optional: Responses tab > three dots > Get email notifications for new responses.

`web/privacy.html` already says what this sends: what you type plus the app and device line, to Google Forms, only on
Submit. If the form gets more questions (a screenshot upload needs sign-in), update that line.

### Phase F: TestFlight

21. **[N] Upload the first build** (checklist step 8). Apple emails when processing is done; the build then shows in
    the TestFlight tab ([upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)).
22. **[N] Internal testing (no review)** (checklist step 9). TestFlight > Internal Testing > (+) group > add yourself.
    Up to 100 internal testers, all App Store Connect users on your team; builds expire after 90 days
    ([TestFlight](https://developer.apple.com/testflight/)). Real-iPhone QA from `.claude/rules/project.md`: sheet detents and drag,
    safe areas, keyboard, location prompt and the "denied" path, stale banner (toggle Airplane Mode), Live Activity on
    the Lock Screen and Dynamic Island (iPhone 14 Pro or later), bus alerts, VoiceOver, Dynamic Type, dark mode,
    Contact support (opens Safari with the details filled in). Report bugs to Claude; each fix is a new build.
23. **[N] External testing (optional).** Needs a Beta App Description and a feedback email; the first build goes to
    Beta App Review; up to 10,000 testers by email or public link; max six review submissions per 24 hours
    ([invite external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/)).
    With the permission granted, a public link is fine.

### Phase G: submit and launch

24. **[N+C] Pre-submit check.** Claude ticks the `.claude/rules/project.md` ship checklist (stale-data honesty, "est." labels, no
    "official" claims, 44 pt targets, privacy) on the TestFlight build. Nathan confirms: permission attached, simulated
    buses work, privacy and support URLs load, screenshots match the build, Content Rights and App Privacy answered.
25. **[N] Submit** (checklist step 12). Version page > select the build > Add for Review > Submit to App Review.
    Status goes Waiting for Review > In Review > Pending Developer Release (manual release) or Rejected.
26. **[N+C] If rejected:** read the message under App Review, Claude prepares the fix or reply (section 4), resubmit.
    Use the appeal or the Webex appointment only when the rejection looks like a misunderstanding.
27. **[N] Release** (checklist step 13). Pending Developer Release > Release This Version. Then [C] adds the App Store
    link to the web About page and `.claude/rules/project.md`, and records the launch.

### Phase H: after launch

28. **Updates [C, N runs and submits].** Claude bumps `MARKETING_VERSION` (1.0.1, 1.1.0); Nathan runs step 8 (or pushes
    the tag `v` + version) and submits. "What's New" is required for every version after the first. For updates,
    choose **phased release**: automatic updates go to 1%, 2%, 5%, 10%, 20%, 50%, 100% over 7 days, pausable for 30
    days in total ([phased release](https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases/)).
    Each April Apple usually raises the minimum Xcode/SDK: check the
    [upcoming requirements](https://developer.apple.com/news/upcoming-requirements/) before each release.
29. **Yearly [N].** Membership renews automatically if Auto-renew is on. If it lapses: "your apps will no longer be
    available for download and you won't be able to submit new apps or updates or access Certificates, Identifiers &
    Profiles", but installed copies keep working; after renewing, free apps "become available again within 24 hours"
    ([renewal](https://developer.apple.com/help/account/membership/renewal/)). Nothing to renew for signing: "A new
    cloud-managed certificate is automatically created 90 days before expiration when new signing requests are
    received" ([cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/)).
30. **Takedown plan [N].** If the University or Passio ever withdraws the permission: Pricing and Availability > remove
    the app from sale in all countries, reply to them in writing, and keep the web app as the fallback.

## 6. Summary: who does what

| Only Nathan | Claude in this repo |
|---|---|
| Apple Account + 2FA, enrollment + ID photo + payment, agreements, DSA declaration, (optional) App IDs, app record, API key, GitHub environment + secrets + variable, approving release runs, the Google Form, Content Rights / age rating / privacy answers (truthfulness is his), attaching the permission, submit, reply to App Review, release, renewal | Release pipeline (`ios-release.yml`, `ExportOptions.plist`, `asc.py`, `release_archive.sh`), `project.yml` bundle id / version / signing, privacy and support pages, Contact support links, simulated buses, App Store screenshot job, listing text and review notes, fixes from TestFlight QA and review, docs and `.claude/rules/project.md` status |

## Sources (checked 2026-10-10, signing and privacy re-checked 2026-10-11)

Apple: [Program enrollment](https://developer.apple.com/programs/enroll/) ·
[Enrollment support](https://developer.apple.com/support/enrollment/) ·
[Enrolling in the Apple Developer app](https://developer.apple.com/help/account/membership/enrolling-in-the-app/) ·
[Identity verification](https://developer.apple.com/help/account/membership/identity-verification/) ·
[Fee waivers](https://developer.apple.com/help/account/membership/fee-waivers/) ·
[D-U-N-S](https://developer.apple.com/help/account/membership/D-U-N-S/) ·
[University Program (discontinued)](https://developer.apple.com/programs/ios/university/) ·
[Renewal](https://developer.apple.com/help/account/membership/renewal/) ·
[Cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/) ·
[Upcoming requirements](https://developer.apple.com/news/upcoming-requirements/) ·
[App Review Guidelines (updated 2026-06-08)](https://developer.apple.com/app-store/review/guidelines/) ·
[App Review](https://developer.apple.com/distribute/app-review/) ·
[App privacy details](https://developer.apple.com/app-store/app-privacy-details/) ·
[Add a new app](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/) ·
[App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/) ·
[Version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/) ·
[Age ratings](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/) ·
[Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/) ·
[Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/) ·
[App Store Connect API keys](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/) ·
[Generating API tokens](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests) ·
[Apple forums: Admin key for cloud signing](https://developer.apple.com/forums/thread/698117) ·
[TestFlight](https://developer.apple.com/testflight/) ·
[TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/) ·
[Invite external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/) ·
[Phased release](https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases/) ·
[DSA trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/) ·
[Accessibility Nutrition Labels](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/) ·
[Encryption export](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations) ·
[Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) ·
[First Xcode Cloud workflow](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow) ·
[App transfer](https://developer.apple.com/help/app-store-connect/transfer-an-app/overview-of-app-transfer/).
Other: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) ·
[GitHub runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) ·
[GitHub: sign Xcode apps](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications) ·
[macos-26 image](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md) ·
[Cloud signing pitfalls on GitHub Actions (rxliuli, 2026-08)](https://rxliuli.com/blog/two-pitfalls-of-safari-cloud-signing-in-github-actions/) ·
["Created via API" certificates piling up (isc/arabesque #468)](https://github.com/isc/arabesque/pull/468) ·
[Unsigned archive + cloud-signed export, green on macos-26 (BraveKoon/Homefield #20, run 37954795575)](https://github.com/BraveKoon/Homefield/actions/runs/37954795575) ·
[XcodeGen ProjectSpec (environment variables, per-config settings)](https://github.com/yonaskolb/XcodeGen/blob/master/Docs/ProjectSpec.md) ·
[Scaleway Mac mini](https://www.scaleway.com/en/mac-mini-m2/) ·
[AWS EC2 Mac](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-mac-instances.html) ·
[UChicago Shuttle Services](https://safety-security.uchicago.edu/transportation/shuttle-services/).
