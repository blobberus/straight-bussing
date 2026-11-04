/*
 * One system prompt per location tap, in the real app (owner 2026-11-02: "There are two requests for locations when
 * the user decides to press share location/use my location in the app. If this is not absolutely needed and can be
 * completed with one notification to the user, do so."). iOS Safari showed the location prompt AND "Motion &
 * Orientation Access" (the compass for the heading cone, ui/compass.js) from the same tap. Now the compass is asked
 * only in a tap where location already works (main.js askCompass, compass.js mayAskCompass), and since 2026-11-04 the
 * first tap anywhere once location works asks too (main.js askCompassOnTap), so the heading cone appears without a
 * second locate tap.
 * e2e.js registers these with its helpers; the test opens its own app iframe (e2e stubs), so the shared one is untouched.
 * The browser is modeled like Safari: a location request is a prompt until location is granted; the compass
 * permission prompts once, then answers without a prompt.
 */

/**
 * Register the location prompt test.
 * @param {{test:Function, ok:Function, eq:Function, waitFor:Function, openApp:(style:string)=>Promise<HTMLIFrameElement>}} h
 */
export function locPromptE2E({ test, ok, eq, waitFor, openApp }) {
  test("location taps: at most one system prompt per tap (location first; the compass only once location works)", async () => {
    const f = await openApp("width:393px;height:852px");
    try {
      const w = f.contentWindow, d = w.document;
      await waitFor(() => w.__sb && w.__e2e && w.__sb.store.get().staticLoaded && d.getElementById("locateBtn"), "app booted", 15000);
      const st = () => w.__sb.store.get();
      const log = [];
      let granted = false, motionAnswered = false;
      const geo = w.navigator.geolocation, realGet = geo.getCurrentPosition;
      geo.getCurrentPosition = function (ok2, err, o) {
        log.push(granted ? "location (no prompt)" : "location prompt");
        return realGet.call(this, (p) => { granted = true; ok2(p); }, err, o);
      };
      w.DeviceOrientationEvent = { requestPermission() {
        log.push(motionAnswered ? "motion (no prompt)" : "motion prompt");
        motionAnswered = true;
        return Promise.resolve("granted");
      } };
      const prompts = () => log.filter((x) => / prompt$/.test(x));
      const e2eStop = w.__e2e.stops[Object.keys(w.__e2e.stops)[0]];
      w.__e2e.geo = { lat: e2eStop.lat, lon: e2eStop.lon };   // the rider will allow location
      eq(st().locState, "unknown", "launch: location never asked (the stub's Permissions API says prompt)");
      eq(log, [], "launch: no prompt at all");

      // 1. the first tap ("Use my location" on Current trip): the location prompt alone
      const use = await waitFor(() => d.querySelector('#content [data-action="nearby:locate"]'), "Use my location");
      use.click();
      eq(log, ["location prompt"], "first tap: only the location prompt, no motion prompt");
      await waitFor(() => st().locState === "granted" && st().user, "position");

      // 2. the next tap ANYWHERE (owner 2026-11-04: "The build no longer shows the user heading": riders rarely tap the
      //    locate button again): location already works, so the compass asks, alone
      log.length = 0;
      d.querySelector('#tabs button[data-tab="routes"]').click();
      eq(prompts(), ["motion prompt"], "next tap anywhere: the motion prompt alone (log " + JSON.stringify(log) + ")");
      eq(log.filter((x) => x.startsWith("motion")).length, 1, "asked once");
      await new Promise((r) => setTimeout(r, 50));   // the answer settles
      log.length = 0;
      d.querySelector('#tabs button[data-tab="nearby"]').click();
      eq(log.filter((x) => x.startsWith("motion")), [], "the tap after: no second ask from a plain tap (once per page load)");

      // 2b. the locate button: location already works, at most one motion request in the tap, never a prompt now
      log.length = 0;
      d.getElementById("locateBtn").click();
      eq(prompts(), [], "locate tap after the motion answer: no prompt (log " + JSON.stringify(log) + ")");
      ok(log.filter((x) => x.startsWith("motion")).length <= 1, "at most one motion request, though the locate button and locate() both try");
      await waitFor(() => d.getElementById("locateBtn").getAttribute("aria-busy") !== "true", "locate finished");

      // 3. Settings > Stop sharing, then Share my location: location only (sharing was off, so no compass in that tap)
      log.length = 0;
      d.getElementById("settingsBtn").click();
      const off = await waitFor(() => d.querySelector('[data-st="loc-off"]'), "Stop sharing my location");
      off.click();
      await waitFor(() => st().locState === "off", "sharing off");
      const on = await waitFor(() => d.querySelector('[data-st="loc-on"]'), "Share my location");
      on.click();
      eq(log.filter((x) => x.startsWith("motion")), [], "Share my location while sharing is off: no motion request");
      ok(prompts().length <= 1, "at most one prompt: " + JSON.stringify(log));
      await waitFor(() => st().locState === "granted", "sharing again");
      d.querySelector('[data-sto="done"]').click();
      await waitFor(() => !d.querySelector('[data-st="loc-off"]') || null, "Settings closed");

      // 4. a blocked site: a tap never reaches the compass
      log.length = 0;
      w.__sb.store.set({ user: null, locState: "denied" });
      w.__e2e.geo = "denied";
      granted = false;
      d.getElementById("locateBtn").click();
      eq(log.filter((x) => x.startsWith("motion")), [], "blocked location: no motion request either");
      await waitFor(() => d.getElementById("locateBtn").getAttribute("aria-busy") !== "true", "locate finished");
      eq(w.__e2e.errors, [], "no console errors");
    } finally {
      f.remove();
    }
  });
}
