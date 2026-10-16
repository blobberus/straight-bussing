# A custom domain for Straight Bussing (research only, 2026-10-16)

Owner: "Look into, but do not execute on the possibility of making a custom domain." Nothing below has been done:
no domain bought, no DNS or Pages setting changed. Today the site is https://blobberus.github.io/straight-bussing/.

## Short answer
Possible, cheap and low-risk: about $10 to $16 a year, about an hour of setup, and no change to the web app's code
(every path is relative). Two things need a plan first: **riders' saved settings** do not move to a new domain by
themselves, and the **poster QR code** should point to the final address. Recommended: `straightbussing.com`
(easiest to type from a poster), set up **before the posters are printed** and before the App Store listing.

## Names checked (registry lookups, 2026-10-16; none registered)
| Name | Notes | Price per year (approx., check before buying) |
|---|---|---|
| `straightbussing.com` | most familiar; best for a poster | about $10.44 at cost (Cloudflare); the .com wholesale fee rises about 7% on Nov 1, 2026 |
| `straightbussing.app` | says "app"; HTTPS only (built into browsers) | about $14 to $16 |
| `straightbussing.org` / `.net` / `.dev` | fine alternatives | about $10 to $15 |
| `straightbuss.ing` | reads as the name; cute but unusual and costlier | check |
`.io` could not be checked this way (its registry has no public lookup). Never use a university or UGo name in the
domain (the app is unofficial).

## What changes
- **Web app code: nothing required.** `manifest.webmanifest` uses `./`, the service worker and every link are
  relative. Display text that names the old address should be updated: `web/js/core/lochelp.js` (location help
  steps), `web/privacy.html`, `web/support.html`, About.
- **Old links keep working.** With a custom domain on this repo, GitHub redirects
  `blobberus.github.io/straight-bussing/...` to the new domain, as long as the domain stays configured and renewed.
- **iPhone app:** `SiteLinks.privacy` / `support` (`ios/App/Sources/Views/Components.swift`) and the daily
  schedule download base (`ScheduleUpdate.defaultBase` in the Kit) should point to the new domain in the next build.
  Builds already out keep working through the redirect. App Store Connect's privacy policy and support URLs should
  use the new domain.
- **Docs and tooling:** `docs/APPSTORE-SUBMIT.md`, `docs/POSTER-BRIEF.md` (the QR target), `ios/README.md`,
  `.github/workflows/ios.yml` and `ios/scripts/gallery.py` (the simulator gallery under `/ios/`).
- **A bonus later:** with its own domain the site can serve `/.well-known/apple-app-site-association`, which
  Universal Links need (a link that opens the iPhone app). That is impossible under `blobberus.github.io/...`.

## The one real catch: riders' saved settings
Browsers keep saved data per address. Favorites, custom routes, hidden routes and settings (`sb:` keys in
localStorage) stay with `blobberus.github.io` and would be empty on the new domain, and a Home Screen icon added
before the move opens the old address (which then redirects). Options:
1. **Accept a reset** (it is a beta with few users). Simplest.
2. **One-time hand-over** (about half a day of work, before switching): a last release on the old address that,
   when the redirect starts, opens the new domain with the saved settings in the link's `#` part (it never reaches
   a server), and the new site saves them once. Works for anyone whose app is installed or cached.

## Steps (not done; for when Nathan decides)
1. Buy the domain under Nathan's own account (Cloudflare or Porkbun; keep the public contact details hidden, the
   default there). Turn on **auto-renew**.
2. GitHub: verify the domain for the account (Settings > Pages > Add a domain: a TXT record), which stops anyone
   else from claiming it on GitHub.
3. Repository Settings > Pages > Custom domain: enter it and save. The site deploys through a GitHub Actions
   workflow (`pages.yml`), so no CNAME file is needed.
4. DNS at the registrar: for `straightbussing.com`, A records to 185.199.108.153, .109.153, .110.153, .111.153 (and
   the AAAA records GitHub lists), plus `www` as a CNAME to `blobberus.github.io`. Check the numbers on GitHub's
   page at the time.
5. Wait for the check and the HTTPS certificate (up to about an hour), then tick **Enforce HTTPS**.
6. Update the addresses listed under "What changes", bump the service worker cache name, run the tests, and update
   the poster and App Store Connect.

## Risks
- **The domain must be renewed.** If it lapses while still set on the repo, the old address redirects to a dead
  domain, and someone else could buy it and receive the traffic. Auto-renew and the GitHub domain verification
  cover both.
- **A short gap** while the certificate is issued (mostly for `.app`, which browsers only open over HTTPS).
- **Cost creep:** first-year deals can renew higher; the at-cost registrars renew at the same price.

Sources: GitHub Docs, "Managing a custom domain for your GitHub Pages site" and "About custom domains and GitHub
Pages" (docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site); Cloudflare Registrar
pricing (pricing.registrar.cloudflare.com); Porkbun domain pricing (porkbun.com/products/domains).
