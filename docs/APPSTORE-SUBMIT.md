# App Store submission guide: from today to "live on the App Store"

Researched 2026-10-10 from Apple's own pages first (links inline). Facts I could not confirm on a first-party page are
marked **(unverified)**. This guide is about the **native SwiftUI app in `ios/`**. It builds on, and does not repeat:
`docs/APPSTORE.md` (costs, 4.2 analysis), `conversion to appstore.md` (feature plan, Live Activity and push design),
`ios/README.md` (code layout, CI, checklist). Owner: Nathan, on Windows, no Mac.

Who does what, in every step:
- **[N]** only Nathan can do it (identity, payment, legal agreements, 2FA prompts, anything that needs his Apple Account).
- **[C]** Claude can do it in this repo (code, CI, docs, drafted text), after Nathan says go.
- **[N+C]** Claude prepares it (commands, text), Nathan runs or pastes it.

## 0. Where the project stands (2026-10-10)

Already done in `ios/` (see `ios/README.md`): native SwiftUI + MapKit app, Live Activity widget extension (updated
locally, `pushType: nil`), local notifications, when-in-use location only, no background modes, privacy manifest
(no tracking, no collected data), `ITSAppUsesNonExemptEncryption = NO`, 1024 px opaque icon, unofficial notice and
773.702.8181 in About and empty states. CI builds **unsigned simulator** builds on `macos-15`.

Gaps this research found (each becomes a step below):
1. **CI Xcode is too old to upload.** Since 2026-04-28, uploads "must be built with Xcode 26 or later using an SDK for
   iOS 26" ([upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)). The `macos-15` image
   defaults to Xcode 16.4; the `macos-26` image defaults to Xcode 26.6 and ships fastlane 2.239.0
   ([macos-15 image](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md),
   [macos-26 image](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md)).
   Deployment target iOS 17 is fine (minimum is iOS 13 since 2026-09-09).
2. **No privacy policy link inside the app.** Guideline 5.1.1(i): "All apps must include a link to their privacy policy
   in the App Store Connect metadata field and within the app in an easily accessible manner"
   ([guidelines](https://developer.apple.com/app-store/review/guidelines/)). About has privacy text but no link.
3. **No privacy policy or support page on GitHub Pages yet.** Both URLs are required for iOS apps
   ([app information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/),
   [version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)).
4. **CI screenshots are the wrong size.** `pick_simulator.py` prefers iPhone 16 Pro (1206 x 2622, "medium display",
   optional). The store needs the large size (see step 19).
5. **The reviewer may see no buses.** Reviewers are not in Chicago and may test at night or during a break. Demo mode
   is a launch argument (`-demo`) the reviewer cannot set.
6. **Signing does not exist yet**: placeholder bundle id `com.example.straightbussing`, no team, no certificate.

## 1. Decisions Nathan must make first

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Individual or organization account | **Individual** | Organizations must be a legal entity (no DBAs), have a D-U-N-S Number, a public website on their own domain and a work email on that domain ([enrollment support](https://developer.apple.com/support/enrollment/)). A student club is usually not a legal entity. Catch: as an individual, **your legal name is shown as the seller** on the App Store. An app can be moved to an organization account later with App Transfer ([overview](https://developer.apple.com/help/app-store-connect/transfer-an-app/overview-of-app-transfer/)). |
| D2 | Real bundle id | **`io.github.blobberus.straightbussing`** (widget: `io.github.blobberus.straightbussing.widgets`) | Reverse DNS of a domain you control (blobberus.github.io). Permanent: the App Store Connect field "can't be changed after you upload your first build" and an uploaded bundle id can't be reused (reported on [Apple forums](https://developer.apple.com/forums/thread/7401), unverified on a help page). Only buy a domain (about $12/yr, est.) if you want a brand id such as `com.straightbussing.app`. |
| D3 | App name and subtitle | Name **Straight Bussing** (16 of 30 chars), subtitle **Unofficial shuttle tracker** (26 of 30) | Names are 2 to 30 characters and one per localization ([app information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)). A web search found no existing listing with this name (unverified until App Store Connect accepts it in step 14; creating the record reserves it). Keep "UChicago", "University of Chicago", "UGo", "Passio" out of the name, subtitle, keywords, icon and screenshots (2.3.7, 4.1(c), 5.2.1). |
| D4 | The UChicago / Passio permission question (UNRESOLVED) | **Ask now (step 1). TestFlight for yourself while waiting. Submit publicly only with a written "no objection"**, as `CLAUDE.md` and `conversion to appstore.md` already require. | See section 4, risk 1. This is the one thing that can get the app rejected or removed later, and the App Store Connect "Content Rights" question asks you to state that you have the rights. |
| D5 | Countries | **United States only** | The app is only useful in Chicago. Every account must still declare EU trader status, but if you don't distribute in the EU you are not a trader, so no address or phone is published ([DSA trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/)). |
| D6 | What version 1.0 contains | **The current feature set** (local Live Activity, bus alerts while the app is open, no server) | Without a server nothing about the rider leaves the phone, so the privacy label is "Data Not Collected" and there is no backend to keep alive during review. Server push (P7) can come in 1.1 with an updated label. |
| D7 | Reviewer access to buses at any hour | **Add a clearly labeled "Preview with simulated buses" switch** (off by default, banner while on) | Guideline 2.1 requires that reviewers can see the full app; a recording alone may not be enough. Simulated buses must never look real (ship checklist item 1). |

## 2. Costs

| Item | Cost | Notes / source |
|---|---|---|
| Apple Developer Program, individual | **99 USD per membership year** | "Prices may vary by region" ([enroll](https://developer.apple.com/programs/enroll/)). Pay with your own card, or in the Apple Developer app (gift card balance not accepted) ([app enrollment](https://developer.apple.com/help/account/membership/enrolling-in-the-app/)). |
| Fee waiver | not available | Only for nonprofit, accredited school or government legal entities; individuals excluded ([fee waivers](https://developer.apple.com/help/account/membership/fee-waivers/)). |
| University Program | not available | "The iOS Developer University Program has been discontinued as of May 15, 2024" ([page](https://developer.apple.com/programs/ios/university/)); it never allowed App Store distribution. There is no student program ([enrollment support](https://developer.apple.com/support/enrollment/)). |
| D-U-N-S Number | free, org only | Up to 5 business days, then up to 2 business days to reach Apple ([D-U-N-S](https://developer.apple.com/help/account/membership/D-U-N-S/)). Not needed for D1 = individual. |
| GitHub Actions macOS runners | **0 USD** | "free ... for public repositories that use standard GitHub-hosted runners" ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). If the repo ever goes private: 0.062 USD/min ([pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)). |
| Xcode Cloud | 0 USD (25 compute hours/month included) | But "You need to configure your first Xcode Cloud workflow in Xcode" ([docs](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow)), i.e. a Mac once, and our project is generated by XcodeGen, not committed. Extra hours from 49.99 USD/month for 100 ([Xcode Cloud](https://developer.apple.com/xcode-cloud/)). Not recommended here. |
| Cloud Mac (only if debugging needs a real Xcode UI) | about 4 EUR minimum | Scaleway Mac mini M2 from 0.17 EUR/hour with a 24-hour minimum lease ([Scaleway](https://www.scaleway.com/en/mac-mini-m2/)); AWS EC2 Mac also bills at least 24 hours ([AWS docs](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-mac-instances.html)). |
| Codemagic (alternative CI) | 0 USD for 500 min/month | Personal accounts, macOS M2; then 0.095 USD/min ([Codemagic pricing](https://docs.codemagic.io/billing/pricing/), updated 2026-09-21). |
| TestFlight, App Review, privacy/support pages on GitHub Pages, export compliance | 0 USD | |
| Apple commission | 0 USD | Free app, no in-app purchases. Do not sign the Paid Apps agreement (step 7). |
| **Year 1 total** | **99 USD** | Plus optional domain (about 12 USD, est.) or a cloud Mac day (about 4 EUR). |
| **Every year after** | **99 USD** | Auto-renews; see step 29. |

## 3. Timeline (realistic)

| Phase | Time | Source |
|---|---|---|
| Permission emails (runs in parallel, start today) | unknown, plan for 2 to 6 weeks | |
| Repo prep by Claude (steps 4, 5, 13, 19) | 1 to 2 sessions | |
| Enrollment, individual | Apple publishes no time; third parties report 24 to 48 hours, some 2026 forum posts report weeks | (unverified) [Apple forums](https://developer.apple.com/forums/thread/822540) |
| App Store Connect API access request | "reviewed and approved on a case-by-case basis" | [API help](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/); often immediate (unverified) |
| Signing assets + secrets (steps 8 to 12) | one evening | |
| First TestFlight build | build 15 to 30 min (est.), then Apple processing; you get an email | [upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/) |
| Real-iPhone QA on TestFlight | 1 to 2 weeks | also closes the open "QA on a real iPhone" item in `CLAUDE.md` |
| App Review | "at least 50% of submissions in less than 24 hours and 90% in less than 48 hours"; first apps often need 1 to 3 rounds (est.) | [App Review](https://developer.apple.com/distribute/app-review/) |
| **Total if permission comes quickly** | **about 3 to 5 weeks** | |

Avoid having the app in review during shuttle breaks (Thanksgiving Break is Nov 23 to 27; check `web/data/service.json`
for reduced service) and late December, when Apple usually slows reviews for the holidays (unverified for 2026).

## 4. Biggest review risks for this app

| # | Guideline | Risk | Mitigation already in place | Still to do |
|---|---|---|---|---|
| 1 | **5.2.1, 5.2.2, 4.1(c), Content Rights** | High until permission exists. 5.2.2: "If your app uses, accesses, monetizes access to, or displays content from a third-party service, ensure that you are specifically permitted to do so under the service's terms of use. Authorization must be provided upon request." 5.2.1 bars third-party trademarks without permission. App Review asks: "If the app features third-party trademarks or copyrighted content ... provide the authorization to do so" ([App Review](https://developer.apple.com/distribute/app-review/)). Passio's feed is public and CORS-open but no license or terms for the Chicago feed were found (unverified). The University, or Passio, can also file a complaint after launch and get the app pulled. | Neutral name and icon, "unofficial" everywhere, official phone/link, no university marks. | Step 1: written no-objection from UChicago Transportation (Department of Safety and Security) and Passio. Attach it in App Review Information > Attachment, which is where Apple asks for "partnership documentation or authorization". Stop names in the data such as "UCHICAGO Medicine - River East" are factual place names; keep them out of metadata. |
| 2 | **2.1 App Completeness** | Medium. The reviewer is far from Chicago and may test when no shuttle runs, so the map looks empty. | Far-away location shows "No stops nearby" with the official contact (no dead end); stale banner. | D7 simulated-bus switch, review notes with service hours in Central Time, a screen recording link. Submit on a weekday during class weeks. |
| 3 | **4.2 Minimum Functionality** | Low. The app is native SwiftUI with MapKit, Live Activity + Dynamic Island, notifications, offline schedules, on-device search, favorites. A web wrapper would have been the risk. | Native app. | List the native features in the review notes. |
| 4 | **5.1.1 / 5.1.2 Privacy, 5.1.5 Location** | Low if the label matches reality. Purpose strings must "clearly and completely describe your use of the data"; if location is declined, "offer the ability to manually enter an address". Location must not be offered as an emergency service. | When-in-use only, asked on tap, station/place search works without location, purpose string says location stays on the iPhone, privacy manifest. | In-app privacy policy link (gap 2). Never describe 773.702.8181 as an emergency feature of this app; it is the official service's number. |
| 5 | **2.5.4 Background, Live Activities, 4.5.3 / 4.5.4 notifications** | Low. Background services only "for their intended purposes"; no spam via "Push Notifications, Live Activities"; push "must not be required for the app to function". | No background modes; Live Activity only during a started trip, ends itself, shows "est." and a stale state; alerts are opt-in and the app works with them off. | Do not add the `location` background mode just to keep the Live Activity fresh. |
| 6 | **2.3.7 Metadata** | Low. "don't try to pack any of your metadata with trademarked terms, popular app names". | | Keywords without UChicago, UGo, Passio, Metra (step 18). |
| 7 | **Safety honesty** (our rule, also 2.3.1 accuracy) | Screenshots or text that imply official or exact times. | "est." labels, stale banner. | Screenshots show "est." and "Unofficial"; never write "official" or "real-time guaranteed". |

**How to answer a reviewer:** reply in App Store Connect (app > App Review messages), be short and factual, quote the
guideline number, say what you changed or attach the evidence, and resubmit. If you think the reviewer misunderstood,
appeal to the App Review Board (one appeal per rejected submission, give specific reasons), or book a free 30-minute
App Review appointment over Webex ([App Review](https://developer.apple.com/distribute/app-review/)). Example replies
Claude can adapt:
- 5.2.2: "The app shows schedule and vehicle-position data from the public GTFS and GTFS-Realtime feeds that Passio
  publishes for the shuttle system. The attached email from [name, title, office] dated [date] confirms they have no
  objection. The app is unofficial, uses no university trademarks, and links to the official service."
- 2.1 (empty map): "Shuttles run [hours] Central Time on weekdays. To see live-looking buses at any time, open Settings,
  turn on Preview with simulated buses (labeled as simulated on every screen). A recording of real service is at [link]."
- 4.2: list the native features (MapKit map, Live Activity on the Lock Screen and Dynamic Island, local stop alerts,
  on-device place search, offline schedules, favorites and custom routes, VoiceOver labels).

## 5. Step-by-step checklist

### Phase A: free preparation (start today)

1. **[N+C] Ask for permission in writing.** Claude drafts the emails; Nathan sends them from his university email.
   - To: the shuttle contact on the official Shuttle Services page, bus@uchicago.edu (listed there for UGo shuttles),
     asking to forward it to the transportation manager in the Department of Safety and Security
     ([Shuttle Services](https://safety-security.uchicago.edu/transportation/shuttle-services/)); and Passio
     Technologies through their website contact form (address unverified).
   - Ask for: (a) no objection to a free, independent, unofficial iPhone app called Straight Bussing that shows shuttle
     schedules and live positions from the public Passio GTFS / GTFS-Realtime feeds; (b) whether the description may say
     "Not affiliated with the University of Chicago"; (c) whether polling every 10 seconds while the app is open is
     acceptable; (d) preferred attribution; (e) whom to contact if they want changes or a takedown.
   - Save every reply as a PDF (needed in step 18). Record the outcome in `CLAUDE.md`.
2. **[N] Get your Apple Account ready.** Two-factor authentication on; first and last name exactly your legal name
   ("Using an alias, nickname, or company name ... will cause a delay"); a street address (P.O. boxes are not
   accepted); your own payment card. You must be the age of majority where you live (18 in Illinois); if not, a
   parent enrolls ([enroll](https://developer.apple.com/programs/enroll/)). Where: https://account.apple.com .
3. **[N] Make decisions D1 to D7** (section 1) and tell Claude the bundle id, name, countries and your legal name for
   the copyright line.
4. **[C] Publish the privacy policy and support pages** on GitHub Pages, e.g.
   `https://blobberus.github.io/straight-bussing/privacy.html` and `.../support.html` (new files in `web/`, deployed by
   `pages.yml`). The policy must say what is collected (nothing), name third parties, and explain retention, deletion
   and how to revoke consent (5.1.1(i)). Content: no account, ads, analytics or tracking; location used only on the
   iPhone, revocable in iOS Settings > Privacy & Security > Location Services; the app downloads public shuttle feeds from
   passio3.com (your IP address reaches Passio's server like any web request; the app sends no personal data) and Apple
   Maps tiles via MapKit (Apple's privacy policy applies); notifications are scheduled on the device; settings stay on
   the device and are deleted with the app; the web version differs (typed destination text goes to photon.komoot.io,
   map tiles from OpenFreeMap); contact email; effective date. The support page needs "actual contact information"
   (an email address and the GitHub Issues link) plus the official service number. Cost 0, time 1 session.
5. **[C] Prepare the code for release** (one commit; `ios/` changes trigger `ios.yml`):
   - `ios/project.yml`: real bundle ids (`bundleIdPrefix` too), `MARKETING_VERSION: "1.0.0"`, `DEVELOPMENT_TEAM` from a
     variable, and a `Release` config per target with `CODE_SIGN_STYLE: Manual`, `CODE_SIGN_IDENTITY: Apple Distribution`,
     `PROVISIONING_PROFILE_SPECIFIER` = the profile names from step 10. Debug stays unsigned for the simulator CI.
     App and widget must keep the same version and build number (they already share the variables).
   - Privacy policy link in About and Settings (gap 2).
   - D7 simulated-bus switch, if chosen.
   - Move `ios.yml` to `runs-on: macos-26` so previews show what Xcode 26 builds (iOS 26 SDK builds pick up the new
     system look on standard controls; re-check the screenshots).
   - These can all be done before enrollment.

### Phase B: enroll (99 USD)

6. **[N] Enroll as an individual.** Fastest: the **Apple Developer app** on your iPhone (Account > Enroll), which asks
   you to "take a picture of your photo ID" and charges your Apple Account payment method as an auto-renewing yearly
   subscription; the same device must be used for the whole enrollment
   ([app enrollment](https://developer.apple.com/help/account/membership/enrolling-in-the-app/)). Or on the web:
   https://developer.apple.com/programs/enroll/ . Accept the Apple Developer Program License Agreement and pay 99 USD.
   "If you haven't received a membership confirmation within 24 hours of your purchase, contact us" with the Enrollment
   ID ([enrollment support](https://developer.apple.com/support/enrollment/)). Then note your **Team ID** at
   https://developer.apple.com/account (Membership details) and give it to Claude (it is not a secret). Turn on
   Auto-renew there if you enrolled on the web.
7. **[N] First App Store Connect sign-in, agreements, DSA.** https://appstoreconnect.apple.com
   - Business (Agreements, Tax, and Banking): the Account Holder must sign the latest agreement before any app can be
     added ([add a new app](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)).
     Free apps need no tax or banking forms; leave the **Paid Apps** agreement unsigned (third-party reports, unverified).
   - Business > Agreements > Compliance > Digital Services Act > Complete Compliance Requirements: if you only distribute
     in the US and earn nothing, declare **not a trader** (Apple says you must assess this yourself).
   - Optional: install the App Store Connect app on your iPhone to get review status and reply to App Review on the go.

### Phase C: identifiers and signing assets, without a Mac (one evening)

8. **[N] Register two App IDs.** https://developer.apple.com/account/resources/identifiers/list > (+) > App IDs > App >
   Explicit Bundle ID:
   - "Straight Bussing", `io.github.blobberus.straightbussing`
   - "Straight Bussing Widgets", `io.github.blobberus.straightbussing.widgets`
   - **Capabilities for 1.0: none.** Locally updated Live Activities need only the `NSSupportsLiveActivities` Info.plist
     key, which is already set ([ActivityKit](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)).
     Later: Push Notifications for server push and Live Activity push updates (P7), Time Sensitive Notifications (P6),
     App Groups `group.io.github.blobberus.straightbussing` on both IDs for the favorite-stop widget (P8). Adding a
     capability means regenerating both profiles (step 10) and updating the secrets.
9. **[N+C] Create the Apple Distribution certificate with OpenSSL** (Git Bash on Windows ships `openssl`). Work in a
   folder outside the repo, for example `~/sb-signing`:
   ```bash
   openssl genrsa -out sb_dist.key 2048
   openssl req -new -key sb_dist.key -out sb_dist.csr -subj "/emailAddress=YOU@EXAMPLE.COM/CN=Your Legal Name/C=US"
   ```
   Upload `sb_dist.csr` at Certificates > (+) > **Apple Distribution**, download `distribution.cer`, then:
   ```bash
   openssl x509 -inform DER -in distribution.cer -out sb_dist.pem
   # 3DES/SHA1 packaging so macOS `security import` accepts a .p12 made by OpenSSL 3 (reported issue, unverified)
   openssl pkcs12 -export -inkey sb_dist.key -in sb_dist.pem -out sb_dist.p12 \
     -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -passout pass:CHOOSE_A_PASSWORD
   ```
   Keep `sb_dist.key`, `sb_dist.p12` and the password in a password manager; never commit them. The certificate is
   valid for one year (unverified on a help page); renewing it means new profiles and secrets (step 29).
10. **[N] Create two App Store provisioning profiles.** Profiles > (+) > Distribution > **App Store Connect** > pick the
    App ID > pick the certificate > name it **SB App Store** (app) and **SB Widgets App Store** (widget) > Download.
    "For builds to be eligible for TestFlight, they must include application identifiers within the provisioning
    profiles" ([TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)),
    which App Store profiles do.
11. **[N] Create the App Store Connect API key.** Users and Access > Integrations > App Store Connect API > **Request
    Access** (Account Holder; approved case by case). Then Team Keys > Generate API Key, name "GitHub Actions", Access
    **App Manager**. Uploading builds needs "Account Holder, Admin, App Manager, or Developer"
    ([upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)); App Manager can
    also manage TestFlight. Do not use Admin unless you switch to cloud signing (below). Download `AuthKey_XXXXXXXXXX.p8`
    (it "can only be downloaded once"), and copy the **Key ID** and **Issuer ID** shown on that page
    ([API help](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/)). A key's role
    can't be edited later; revoke and regenerate instead.
12. **[N+C] Store the secrets in GitHub**, in an environment called `appstore` with Nathan as required reviewer
    (Settings > Environments; free for public repos), so only an approved run can sign. From Git Bash in `~/sb-signing`:
    ```bash
    R=blobberus/straight-bussing; E=appstore
    gh variable set APPLE_TEAM_ID -R $R --body "ABCDE12345"
    gh secret set ASC_KEY_ID     -R $R --env $E --body "XXXXXXXXXX"
    gh secret set ASC_ISSUER_ID  -R $R --env $E --body "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    base64 -w0 AuthKey_XXXXXXXXXX.p8                    | gh secret set ASC_KEY_P8_BASE64     -R $R --env $E
    base64 -w0 sb_dist.p12                              | gh secret set DIST_CERT_P12_BASE64  -R $R --env $E
    gh secret set DIST_CERT_P12_PASSWORD -R $R --env $E   # paste the .p12 password when asked
    base64 -w0 SB_App_Store.mobileprovision             | gh secret set APP_PROFILE_BASE64    -R $R --env $E
    base64 -w0 SB_Widgets_App_Store.mobileprovision     | gh secret set WIDGET_PROFILE_BASE64 -R $R --env $E
    openssl rand -base64 24                             | gh secret set KEYCHAIN_PASSWORD     -R $R --env $E
    ```
    Secrets are not passed to workflows triggered from forks. Do not paste key contents into a chat.

### Phase D: release pipeline on GitHub Actions (Claude)

13. **[C] Add `.github/workflows/ios-release.yml`** (manual `workflow_dispatch` and `v*` tags, `environment: appstore`,
    `runs-on: macos-26`). Steps, following GitHub's
    [Xcode signing guide](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications):
    1. Checkout, `brew install xcodegen`, `ios/scripts/bootstrap.sh`, `xcodebuild -version` (must print 26.x or later).
    2. Import the `.p12` into a temporary keychain (`security create-keychain`, `set-keychain-settings -lut 21600`,
       `unlock-keychain`, `import ... -A -t cert -f pkcs12`, `set-key-partition-list -S apple-tool:,apple:`,
       `list-keychain -d user -s`). If codesign says the certificate is not trusted, also import Apple's WWDR G3
       intermediate from https://www.apple.com/certificateauthority/ .
    3. Copy both profiles to `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` (the Xcode 16+ location) and to
       the old `~/Library/MobileDevice/Provisioning Profiles/` (GitHub's guide still shows the old one;
       [location change](https://github.com/fastlane/fastlane/discussions/29228)).
    4. Archive (build number = run number, so every upload is higher than the last):
       ```bash
       xcodebuild archive -project ios/StraightBussing.xcodeproj -scheme StraightBussing -configuration Release \
         -destination 'generic/platform=iOS' -archivePath "$RUNNER_TEMP/SB.xcarchive" \
         DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CURRENT_PROJECT_VERSION="$GITHUB_RUN_NUMBER"
       ```
    5. Export an `.ipa` with `xcodebuild -exportArchive -archivePath ... -exportPath "$RUNNER_TEMP/export"
       -exportOptionsPlist ios/ExportOptions.plist`, where the plist has `method` = `app-store-connect`,
       `destination` = `export`, `teamID`, `signingStyle` = `manual`, `signingCertificate` = `Apple Distribution`,
       `provisioningProfiles` = { app id: `SB App Store`, widget id: `SB Widgets App Store` }, `uploadSymbols` = true,
       `manageAppVersionAndBuildNumber` = false.
    6. Upload with the preinstalled fastlane:
       `fastlane pilot upload --ipa "$RUNNER_TEMP/export/StraightBussing.ipa" --api_key_path "$RUNNER_TEMP/asc_key.json"
       --skip_waiting_for_build_processing true`, where `asc_key.json` is `{"key_id", "issuer_id", "key"}` built from
       the secrets ([fastlane API key docs](https://docs.fastlane.tools/app-store-connect-api/)). Fallback: set
       `destination` = `upload` in the export plist and pass `-allowProvisioningUpdates -authenticationKeyPath
       -authenticationKeyID -authenticationKeyIssuerID` to `xcodebuild -exportArchive`.
    7. Keep the `.xcarchive` (dSYMs) as a workflow artifact for crash reports.

    Cost 0 USD (public repo). Why not the other options: **Xcode Cloud** needs Xcode on a Mac to create the first
    workflow and expects a committed project; **cloud signing** (`-allowProvisioningUpdates` with no local certificate)
    reportedly needs an Admin-role key and can leave a new certificate behind on every fresh runner
    ([report, 2026-08](https://rxliuli.com/blog/two-pitfalls-of-safari-cloud-signing-in-github-actions/)); **fastlane
    match** works too but adds a private certificates repo and another password. Manual signing with one certificate is
    the least moving parts for one developer.

### Phase E: the App Store Connect record and metadata

14. **[N] Create the app record.** Apps > (+) > New App ([help](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)):
    Platform iOS; Name `Straight Bussing`; Primary Language English (U.S.); Bundle ID (from step 8); SKU
    `straightbussing-ios` (letters, numbers, hyphens, periods, underscores); User Access Full. If the name is taken, an
    error appears now: pick a variant (for example "Straight Bussing Shuttles") and tell Claude to update
    `CFBundleDisplayName` if it should match.
15. **[N+C] App Information** (sidebar > General > App Information; Claude drafts all text):
    - Subtitle `Unofficial shuttle tracker`; Category Primary **Navigation**, Secondary **Travel** (matches
      `LSApplicationCategoryType`).
    - **Content Rights**: "Does your app contain, show, or access third-party content?" Answer Yes (Passio feed data,
      OpenStreetMap places) and only confirm you have the necessary rights once step 1 has an answer
      ([rule](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)).
    - **Age Rating** > Set Up Age Ratings: no in-app controls; no capabilities (no web view, so "Unrestricted Web
      Access" is No; links open Safari; no user-generated content, chat, ads); every content item None. Expected result
      **4+** ([values](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/)).
      The new 4+/9+/13+/16+/18+ system applies since 2026-01-31.
    - App Store Regulations and Permits > Digital Services Act: not a trader (D5).
    - Accessibility Nutrition Labels: voluntary for now; declare only features that pass Apple's criteria after the
      VoiceOver and Dynamic Type pass ([overview](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/)).
16. **[N] Pricing and Availability**: Price **Free** (0 USD); Availability **United States** only (D5); no pre-order.
17. **[N+C] App Privacy** (sidebar > App Privacy): Privacy Policy URL from step 4, then Get Started > "Do you or your
    third-party partners collect data from this app?" **No**. The label becomes **Data Not Collected**. Why this is
    correct today: "Data that is processed only on device is not 'collected'", and "collect" means sending data off the
    device so that you or your third-party partners (SDKs and vendors "whose code you've added to your app") can keep it
    longer than the request needs ([app privacy details](https://developer.apple.com/app-store/app-privacy-details/)).
    Location, search and settings stay on the phone; the Passio and MapKit requests carry no user data and no third-party
    code is in the app. Must change when: server push ships (push token + watched stop leave the device, see
    `conversion to appstore.md` section 8); Photon search is ported (typed text leaves the device; declare Search History,
    App Functionality, not linked, no tracking, the conservative reading); analytics or crash SDKs are added. Answers
    can be updated without a new build. Keep `PrivacyInfo.xcprivacy` consistent.
18. **[N+C] Version page "1.0 Prepare for Submission"** (Claude drafts; Nathan pastes):
    - Screenshots: step 19. App icon: taken from the build (the 1024 px opaque PNG `make_icon.py` renders).
    - Promotional text (170 max): "Live shuttle arrivals, trip directions and a Lock Screen countdown for your ride.
      Free, no account, no tracking. Unofficial: times are estimates." (145)
    - Description (4000 max, plain text): what it does, native features, how times work ("est.", stale warning),
      privacy summary, and "Straight Bussing is an unofficial student project, not affiliated with or endorsed by the
      University of Chicago or Passio. For official service call 773.702.8181." (wording subject to step 1 answers).
    - Keywords (100 bytes, each over two characters):
      `shuttle,bus,campus,tracker,transit,hyde park,arrivals,stops,routes,eta,live,commute,schedule` (92 bytes).
    - Support URL and Marketing URL (optional, the Pages site); Version `1.0.0`; Copyright `2026 Your Legal Name`.
    - **App Review Information**: no sign-in required; contact name, email, phone in "+1 ..." format (private); Notes
      (4000 bytes) from the template below; **Attachment**: the permission PDF(s) from step 1 and a short screen
      recording of real service (the CI walk-through or one recorded on your iPhone).
    - Release: **Manually release this version** (so launch day is your choice).
    - Review notes template (Claude fills the hours from `web/data/service.json`; drop the simulated-bus sentence if D7
      is not built):
      ```
      Straight Bussing is a free, unofficial tracker for the campus shuttles in Hyde Park, Chicago. No login.
      Live data: shuttles run about [hours] Central Time. Outside those hours, or far from Chicago, the map
      correctly shows no buses and the app says so. To see every feature at any time: Settings > Preview with
      simulated buses (off by default; every screen is labeled "Simulated").
      Try: Directions > search "Regenstein" > choose an option > Start. This starts a Live Activity (Lock Screen
      and Dynamic Island) and the trip timeline. Settings > Bus alerts > choose a Station: local notifications
      while the app is open.
      Location is optional, asked only when you tap "Use my location", and never leaves the device.
      Data: the public GTFS and GTFS-Realtime feeds Passio publishes for this shuttle system. See the attached
      [permission email]. The app uses no university trademarks; About links to the official service (773.702.8181).
      Native features: MapKit map, Live Activity + Dynamic Island, local notifications, on-device place search,
      offline schedules, favorites and custom routes. Recording of real service: [link].
      ```
19. **[C] Screenshots.** Required: one set (1 to 10, PNG or JPEG, **no alpha channel**) for **iPhone with Dynamic Island
    (large display)**: 1320 x 2868, 1290 x 2796 or 1260 x 2736 portrait (iPhone 17/16 Pro Max class, the old "6.9 inch").
    Only if those are missing, 1284 x 2778 or 1242 x 2688 ("6.5 inch") become required. Smaller sizes are scaled down
    automatically ([specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/)).
    So **one 6.9 inch set is enough**; 6.5 inch is not needed. Claude adds a CI step that boots an iPhone 17 Pro Max (or
    16 Pro Max) simulator, captures 4 to 6 screens (map with buses, arrivals, Directions options, trip timeline, Live
    Activity preview, Routes) in light mode, and flattens alpha with Pillow. Show "est." and "Unofficial" in frame; if
    the shots use simulated buses, they must still reflect the real app. Note for later: "iPhone Duo" screenshots
    become required from April 2027 for apps built with the iOS 27.1 SDK.
20. **[done] Export compliance.** `ITSAppUsesNonExemptEncryption = NO` is already in `project.yml`, which is right
    because the app only uses HTTPS through `URLSession`: "the use of encryption that's built into the operating system
    ... is exempt from export documentation upload requirements"
    ([encryption export](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)).
    App Store Connect therefore won't ask per build. Apple adds that some exempt apps "might" owe a year-end
    self-classification report; for OS-only HTTPS this is generally not needed (unverified).

### Phase F: TestFlight

21. **[N then C] Upload the first build.** Nathan approves the `appstore` environment run (Actions > iOS release > Run
    workflow, then Review deployments). Apple emails when processing is done; the build then shows in the TestFlight tab
    ([upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)).
22. **[N] Internal testing (no review).** TestFlight > Internal Testing > (+) group > add yourself. Install the
    **TestFlight** app on your iPhone and accept. Up to 100 internal testers, all App Store Connect users on your team;
    builds expire after 90 days ([TestFlight](https://developer.apple.com/testflight/)). Run the real-iPhone QA from
    `CLAUDE.md`: sheet detents and drag, safe areas, keyboard, location prompt and "denied" path, stale banner (toggle
    Airplane Mode), Live Activity on the Lock Screen and Dynamic Island (iPhone 14 Pro or later), bus alerts, VoiceOver,
    Dynamic Type, dark mode. Report bugs to Claude; each fix is a new build.
23. **[N] External testing (optional).** Needs a Beta App Description (required) and a feedback email; the first build
    goes to Beta App Review, later builds of the same version may not; up to 10,000 testers by email or public link;
    max six review submissions per 24 hours
    ([invite external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/)).
    A public link is effectively public distribution, so wait for step 1 or invite a few friends by email only.

### Phase G: submit and launch

24. **[N+C] Pre-submit check.** Claude ticks the `CLAUDE.md` ship checklist (stale-data honesty, "est." labels, no
    "official" claims, 44 pt targets, privacy) on the TestFlight build. Nathan confirms: permission PDF attached, D7
    switch works, privacy and support URLs load, screenshots match the build, Content Rights answered truthfully.
25. **[N] Submit.** Version page > select the build > Add for Review > Submit to App Review. Status goes Waiting for
    Review > In Review > Pending Developer Release (manual release) or Rejected. Typical time: section 3.
26. **[N+C] If rejected:** read the message under App Review, Claude prepares the fix or reply (section 4), resubmit. Use
    the appeal or the Webex appointment only when the rejection looks like a misunderstanding.
27. **[N] Release.** Pending Developer Release > Release This Version. Then [C] adds the App Store link to the web About
    page and `CLAUDE.md`, and records the launch.

### Phase H: after launch

28. **Updates [C, N submits].** Bump `MARKETING_VERSION` (1.0.1, 1.1.0); the build number comes from the run number.
    "What's New" is required for every version after the first. For updates, choose **phased release**: automatic
    updates go to 1%, 2%, 5%, 10%, 20%, 50%, 100% over 7 days, pausable for 30 days in total; anyone can still download
    manually ([phased release](https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases/)).
    Apple won't delay a bug fix of a live app over guideline issues "except for those related to legal or safety issues".
    Each April Apple usually raises the minimum Xcode/SDK: check the
    [upcoming requirements](https://developer.apple.com/news/upcoming-requirements/) page before each release.
29. **Yearly [N].** Membership renews automatically if Auto-renew is on; manual renewal opens 30 days before expiry.
    If it lapses: "your apps will no longer be available for download and you won't be able to submit new apps or
    updates or access Certificates, Identifiers & Profiles", but installed copies keep working; after renewing, free apps
    "become available again within 24 hours" with no resubmission
    ([renewal](https://developer.apple.com/help/account/membership/renewal/)). Before the certificate expires, repeat
    steps 9, 10 and 12 (new `.p12` and profiles); the live app is not affected by the certificate expiring (unverified).
30. **Takedown plan [N].** If the University or Passio objects: Pricing and Availability > remove the app from sale in
    all countries, reply to them in writing, and keep the web app as the fallback.

## 6. Summary: who does what

| Only Nathan | Claude in this repo |
|---|---|
| Permission emails (send), Apple Account + 2FA, enrollment + ID photo + payment, license and App Store Connect agreements, DSA declaration, App IDs, CSR upload and certificate download, profiles, API key, GitHub secrets and environment approval, app record, Content Rights / age rating / privacy answers (truthfulness is his), submit, reply to App Review, release, renewal | Email drafts, privacy and support pages, in-app privacy link, D7 simulated-bus switch, `project.yml` signing and versions, `macos-26` move, `ios-release.yml` + `ExportOptions.plist`, App Store screenshot job, all metadata text and review notes, fixes from TestFlight QA and review, docs and `CLAUDE.md` status |

## Sources (all checked 2026-10-10)

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
[TestFlight](https://developer.apple.com/testflight/) ·
[TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/) ·
[Invite external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/) ·
[Phased release](https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases/) ·
[DSA trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/) ·
[Accessibility Nutrition Labels](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/) ·
[Encryption export](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations) ·
[Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) ·
[Xcode Cloud](https://developer.apple.com/xcode-cloud/) ·
[First Xcode Cloud workflow](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow) ·
[App transfer](https://developer.apple.com/help/app-store-connect/transfer-an-app/overview-of-app-transfer/).
Other: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) ·
[GitHub runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) ·
[GitHub: sign Xcode apps](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications) ·
[macos-15 image](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md) ·
[macos-26 image](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md) ·
[fastlane API key](https://docs.fastlane.tools/app-store-connect-api/) ·
[Codemagic pricing](https://docs.codemagic.io/billing/pricing/) ·
[Scaleway Mac mini](https://www.scaleway.com/en/mac-mini-m2/) ·
[AWS EC2 Mac](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-mac-instances.html) ·
[UChicago Shuttle Services](https://safety-security.uchicago.edu/transportation/shuttle-services/).
