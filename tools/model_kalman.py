"""(e) 1-D constant-velocity Kalman filter for a LIVE bus on its route (position s along route, speed v).

State x = [s, v]. Each dt seconds:   x' = F x + w,  F = [[1,dt],[0,1]],  w ~ N(0,Q) (random acceleration q)
  Q = q * [[dt^3/3, dt^2/2],[dt^2/2, dt]]       measurement  z = s + e,  e ~ N(0, R)  (GPS along-route)
Optional speed measurement (vehicle 'speed' field) and a PRIOR speed pseudo-measurement from the
learned segment model (v_prior, var) which pulls v toward typical speed when the GPS is noisy/stopped.
ETA to along-route distance D:  tau = (D - s)/v,   Var(tau) ~ ((D-s)^2 Pvv + v^2 Pss)/v^4 (delta method).
Run: python tools/model_kalman.py   (synthetic demo, no data needed)
"""
import math, random


class Kalman2:
    def __init__(self, s0=0.0, v0=5.0, p_s=25.0 ** 2, p_v=4.0 ** 2, q=0.5, r=15.0 ** 2):
        self.s, self.v = s0, v0
        self.P = [[p_s, 0.0], [0.0, p_v]]
        self.q, self.r = q, r

    def predict(self, dt):
        s, v, P, q = self.s, self.v, self.P, self.q
        self.s = s + v * dt
        a, b, c, d = P[0][0], P[0][1], P[1][0], P[1][1]
        n00 = a + dt * (b + c) + dt * dt * d + q * dt ** 3 / 3
        n01 = b + dt * d + q * dt ** 2 / 2
        n10 = c + dt * d + q * dt ** 2 / 2
        n11 = d + q * dt
        self.P = [[n00, n01], [n10, n11]]

    def _update(self, h, z, r):
        """Scalar measurement z = h.x + e, h = (h0, h1); Joseph-free form, fine for 2 states."""
        P = self.P
        y = z - (h[0] * self.s + h[1] * self.v)
        Ph = [P[0][0] * h[0] + P[0][1] * h[1], P[1][0] * h[0] + P[1][1] * h[1]]
        S = h[0] * Ph[0] + h[1] * Ph[1] + r
        K = [Ph[0] / S, Ph[1] / S]
        self.s += K[0] * y
        self.v += K[1] * y
        for i in range(2):
            for j in range(2):
                P[i][j] -= K[i] * Ph[j]
        self.v = max(0.0, self.v)          # buses do not reverse along the route
        return y * y / S                   # normalised innovation^2 (use for outlier gating)

    def update_pos(self, z, r=None):
        return self._update((1, 0), z, self.r if r is None else r)

    def update_speed(self, z, r=1.0):
        return self._update((0, 1), z, r)

    def update_prior(self, v_prior, sd=2.0):
        """Pseudo-measurement 'v is about the learned segment speed' (model_segments, harmonic speed).
        Weak (sd ~2 m/s): it only matters while GPS is sparse or the bus is dwelling."""
        return self._update((0, 1), v_prior, sd * sd)

    def step(self, dt, z_pos, gate=9.0, v_prior=None):
        """predict + gated position update (+ optional prior). Innovations with NIS > gate
        (chi^2_1 99.7%) are rejected as GPS jumps. Returns True if the fix was used."""
        self.predict(dt)
        P, r = self.P, self.r
        y = z_pos - self.s
        used = y * y / (P[0][0] + r) <= gate or getattr(self, "_rej", 0) >= 3   # re-sync after 3 rejects
        if used:
            self.update_pos(z_pos)
        self._rej = 0 if used else getattr(self, "_rej", 0) + 1
        if v_prior is not None:
            self.update_prior(v_prior)
        return used

    def eta(self, D, v_prior=None, tau=90.0):
        """(seconds, sd) to reach along-route distance D.
        Without v_prior: constant-velocity extrapolation (only good for the next ~minute; a dwelling
        bus has v ~ 0). With v_prior (learned typical speed incl. dwell): blend
        v_eff = w*v + (1-w)*v_prior, w = exp(-(rem/v_prior)/tau): near stops trust the live speed,
        far away trust the learned speed. sd by the delta method on the position/speed variances."""
        rem = D - self.s
        if rem <= 0:
            return 0.0, 0.0
        v = max(self.v, 0.3)
        pvv = self.P[1][1]
        if v_prior:
            w = math.exp(-(rem / v_prior) / tau)
            v = max(0.3, w * v + (1 - w) * v_prior)
            pvv = w * w * pvv + (1 - w) ** 2 * (0.25 * v_prior) ** 2
        var = (rem * rem * pvv + v * v * self.P[0][0]) / v ** 4
        return rem / v, math.sqrt(var)


def simulate(rnd, D=3000.0, dt=5.0, stops=((900, 20), (1900, 15))):
    """Ground-truth bus: mean-reverting speed around 7 m/s, two dwells, GPS sd 15 m + 3% 250 m jumps.
    -> list of (t, true s, gps z) every dt seconds until the bus reaches D."""
    s, v, t, dwell_left, out = 0.0, 6.0, 0.0, 0.0, []
    while s < D:
        if dwell_left > 0:
            dwell_left -= dt
        else:
            v = max(0.5, v + rnd.gauss(0, 0.5) + 0.2 * (7 - v))
            nxt = s + v * dt
            for pos, dw in stops:
                if s < pos <= nxt:
                    nxt, dwell_left = pos, dw
            s = nxt
        t += dt
        z = s + rnd.gauss(0, 15) if rnd.random() > 0.03 else s + rnd.choice((-1, 1)) * 250
        out.append((t, s, z))
    return out


def demo(seeds=range(20), D=3000.0, dt=5.0, quiet=False):
    """Average over several simulated trips. The 'learned' speed is the mean trip speed (incl. dwell)
    over a separate set of simulated trips, i.e. what model_segments would learn."""
    import statistics
    v_learn = statistics.mean(D / simulate(random.Random(1000 + i), D, dt)[-1][0] for i in range(30))
    e_cv, e_bl, e_raw, p_f, p_r = [], [], [], [], []
    for sd in seeds:
        rnd = random.Random(sd)
        trace = simulate(rnd, D, dt)
        T = trace[-1][0]
        kf = Kalman2(s0=0.0, v0=v_learn)
        for t, s, z in trace:
            kf.step(dt, z)
            p_f.append(abs(kf.s - s)); p_r.append(abs(z - s))
            if T - t < 30:
                continue
            e_cv.append(kf.eta(D)[0] - (T - t))
            e_bl.append(kf.eta(D, v_prior=v_learn)[0] - (T - t))
            e_raw.append((D - z) / v_learn - (T - t))
    mae = lambda e: sum(abs(x) for x in e) / len(e)
    res = {"kalman_cv": mae(e_cv), "kalman_learned": mae(e_bl), "raw_learned": mae(e_raw),
           "pos_filtered": mae(p_f), "pos_raw": mae(p_r), "n": len(e_cv), "v_learned": v_learn}
    if not quiet:
        print(f"demo: {len(list(seeds))} simulated trips of {D:.0f} m, GPS sd 15 m + 3% 250 m jumps, two dwells")
        print(f"  ETA MAE  Kalman constant-velocity {res['kalman_cv']:6.1f}s | Kalman + learned speed "
              f"{res['kalman_learned']:6.1f}s | raw GPS / learned speed {res['raw_learned']:6.1f}s  (n={res['n']})")
        print(f"  position MAE  filtered {res['pos_filtered']:.1f} m vs raw GPS {res['pos_raw']:.1f} m")
    return res


if __name__ == "__main__":
    demo()
