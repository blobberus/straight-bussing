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

    def eta(self, D):
        """(seconds, sd) to reach along-route distance D (None if v ~ 0)."""
        rem = D - self.s
        if rem <= 0:
            return 0.0, 0.0
        v = max(self.v, 0.3)
        var = (rem * rem * self.P[1][1] + v * v * self.P[0][0]) / v ** 4
        return rem / v, math.sqrt(var)


def demo(seed=3):
    rnd = random.Random(seed)
    D, dt = 3000.0, 5.0
    s, v, t = 0.0, 6.0, 0.0
    kf = Kalman2(s0=0.0, v0=5.0)
    stops = [(900, 20), (1900, 15)]        # (position m, dwell s)
    dwell_left, rows, arr = 0.0, [], None
    errs_naive, errs_kf = [], []
    last_z = 0.0
    while s < D:
        if dwell_left > 0:
            v, dwell_left = 0.0, dwell_left - dt
        else:
            v = max(0.5, v + rnd.gauss(0, 0.5) + 0.2 * (7 - v))
            for pos, dw in stops:
                if s < pos <= s + v * dt:
                    s, dwell_left = pos, dw
        s += v * dt if dwell_left <= 0 else 0
        t += dt
        z = s + rnd.gauss(0, 15)
        kf.predict(dt)
        kf.update_pos(z)
        rows.append((t, s, z, kf.s, kf.v, kf.eta(D)))
        last_z = z
    T = t
    for tt, ss, z, ks, kv, (eta, sd) in rows:
        truth = T - tt
        if truth < 30:
            continue
        errs_kf.append(eta - truth)
        errs_naive.append((D - z) / 7.0 - truth)     # 'distance / fixed typical speed' baseline
    mae = lambda e: sum(abs(x) for x in e) / len(e)
    print(f"demo: trip {T:.0f}s over {D:.0f} m, GPS sd 15 m, two dwells")
    print(f"  ETA MAE  Kalman {mae(errs_kf):6.1f}s | distance/7 m/s {mae(errs_naive):6.1f}s | n={len(errs_kf)}")
    pos_err = [abs(r[3] - r[1]) for r in rows]
    raw_err = [abs(r[2] - r[1]) for r in rows]
    print(f"  position MAE  filtered {sum(pos_err)/len(pos_err):.1f} m vs raw GPS {sum(raw_err)/len(raw_err):.1f} m")
    return mae(errs_kf), mae(errs_naive)


if __name__ == "__main__":
    demo()
