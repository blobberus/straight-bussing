# Algorithms: true bus speed, segment times and arrival predictions

What this solves: given logged **arrival times at each stop**, the **distance between stops**, the
**time of day/week** and the **stop address**, estimate how fast a bus really moves on each stretch
of road, how long it will take to reach a stop, and how sure we are. Everything is stdlib Python in
`tools/model_*.py`; results feed `web/data/learned.json`, which `web/js/core/predict.js` reads.
Measured accuracy lives in `docs/BACKTEST.md` (regenerate with `python tools/backtest.py`).

## 1. Notation

| symbol | meaning |
|---|---|
| route r, segment s = (r, a -> b) | consecutive stops a, b of route r (`route_stops.json` order) |
| A_b | observed arrival time at stop b (unix s, `epoch`) |
| T = A_b - A_a | segment time, arrival to arrival (`segment_s`); includes the dwell at a |
| w_a | dwell (door-open time) at stop a (`dwell_s` of the row for stop a) |
| x = T - w_a | run time (bus actually moving) |
| d | along-road distance a -> b (`dist_prev_m`, from the route shape) |
| v = d / x | true moving speed on the segment (`speed_mps`) |
| h | hour-of-week bucket = 24*dow + hour, Monday 00:00 = 0 (0..167), America/Chicago |
| p | daypart: weekday/weekend x {night <6, am 6-10, mid 10-15, pm 15-19, eve 19-24} (10 buckets) |
| n, k | samples in a bucket; shrinkage strength |
| mu, sigma | mean and sd of log x (log-normal model) |

**DST safety.** h is computed from the logger's local wall-clock string (`local_time`), not from
UTC + fixed offset, so "Monday 8 am" is the same bucket in March and November
(`model_core.parse_local`; fallback `model_core.chicago` uses the tz database, or the US rule).

## 2. From arrivals to clean segment observations (`model_core.load_rows`)

For each row with a previous stop: x = T - w_a, where w_a is joined from the same trip's row at
stop a (or recovered as T - d/v when the logger already computed v). Rows are **dropped** if
T > 1800 s (layover, detour, parked bus), x < 3 s, or v > 30 m/s (GPS glitch). Unknown dwell
falls back to the route's median dwell. Rows are sorted by A_b: time order is sacred (section 9).

Why remove dwell: dwell depends on riders (class change, rain), run time on traffic and lights.
Mixing them hides both signals. A rider's ride time is x_1 + w_2 + x_2 + ... + x_m, so we model
x and w separately and add them back (`predict.js` adds the learned `dw` at intermediate stops).

## 3. Baselines (what we must beat)

1. **Schedule**: GTFS seconds per segment (`web/data/segments.json`). Only timepoints are real;
   intermediate stops are interpolated, so short segments are often wrong by a factor of 2+.
2. **Passio**: the live ETA in tripUpdates. The logger stores, for each arrival, the latest Passio
   prediction made at least a minute before, as (`passio_pred_epoch`, lead L = A_b - time made).
3. **Global median**: one number for every segment. A sanity floor; any model must crush it.

## 4. Speed: use the harmonic (space-mean) speed

Average speed over many traversals of length d_i in times x_i is **V = sum d_i / sum x_i**. For
one segment this equals d / mean(x): the **harmonic mean** of the individual speeds. The
arithmetic mean of v_i = d/x_i is biased high (Jensen): 100 m in 10 s and 100 m in 40 s average
4 m/s, not (10 + 2.5)/2 = 6.25 m/s. The time-mean vs space-mean distinction is classic traffic
theory (Wardrop 1952). `model_core.harmonic_speed` implements it; the global and route-daypart
levels below are harmonic speeds turned into times with t = d / V, so an unseen segment still gets
a physically sensible time from its length.

## 5. Hierarchical medians with empirical-Bayes shrinkage (`model_segments.SegmentModel`)

Five levels, from coarse to fine, all on log run time:

```
global speed -> route x daypart speed -> segment -> segment x daypart -> segment x hour-of-week
```

Each child level replaces the running estimate with a precision-weighted blend:

    mu_level = w * m_child + (1 - w) * mu_parent,     w = n / (n + k)

where m_child = median(log x) in that bucket (median: robust to the occasional stuck bus). This is
the empirical-Bayes / James-Stein idea (Efron & Morris 1975): a bucket with n = 3 noisy samples
is pulled most of the way to its parent; with n = 200 it speaks for itself. k is the number of
samples at which a bucket gets half the weight. Spread is blended the same way:
sigma_level = w * s_child + (1 - w) * sigma_parent, with s = 1.4826 * MAD(log x) (robust sd).

**Choosing k.** `tune_k` tries k in {0.5, 1, 2, 5, 10, 20, 50} by rolling-origin cross-validation
(section 9) on the training data only and keeps the k with the lowest out-of-sample MAE.

**Minimum data and fallback.** Shrinkage is the fallback: an empty bucket simply contributes
nothing and the parent estimate stands. For reporting, the "hierarchy level" of a prediction is
the deepest level with n >= 20 (`min_n`); the web export only writes hour buckets with n >= 5 that
differ from the all-hours median by >= 3 %, otherwise the reader's fallback is as good.

## 6. Same-day correction: EWMA + bus-to-bus carry-over (`model_segments.Corrector`)

Historical medians miss today's weather, events and incidents. Let e = log x_observed - mu (the
log residual of a bus that just finished a segment). Three residual memories, all updated only
with arrivals that already happened:

- s_seg: EWMA of residuals of earlier buses on this segment, s <- s + alpha (e - s), alpha = 0.5,
  and decayed with elapsed time: s(t) = s * exp(-(t - t_last)/tau), tau = 30 min. A bus that
  struggled 5 minutes ago is informative, one from 3 hours ago is not.
- s_route: same over the whole route (a route-wide slowdown).
- s_trip: EWMA of THIS bus's residuals on its previous segments. Running late tends to persist:
  for a segment j hops ahead the carry-over is damped to phi^j * s_trip, where phi is the lag-1
  autocorrelation of consecutive residuals of the same trip (an AR(1) process).

Corrected prediction: mu' = mu + clamp(g1 s_seg + g2 phi^j s_trip + g3 s_route, +-0.7). The gains g
come from ridge least squares on the training period. Clamping keeps one wild bus from wrecking
the next prediction.

## 7. Live buses: 1-D Kalman filter on along-route position (`model_kalman.Kalman2`)

State z = [s, v] (metres along the route, speed). Constant-velocity model (Kalman 1960):

    predict: s <- s + v dt;  P <- F P F' + Q,  F = [[1, dt], [0, 1]],
             Q = q [[dt^3/3, dt^2/2], [dt^2/2, dt]]       (random acceleration, q = 0.5)
    update with GPS projected on the route, y = s_gps - s, S = P_ss + R (R = 15^2 m^2):
             K = P H' / S,  z <- z + K y,  P <- P - K H P;  reject if y^2 / S > 9 (a GPS jump)

ETA to a stop at distance D: tau = (D - s) / v_eff, Var(tau) ~ ((D-s)^2 Var(v) + v^2 Var(s)) / v^4
(delta method). Lesson from the simulation in `docs/BACKTEST.md`: a bus that is dwelling has
v ~ 0, so pure constant-velocity ETAs explode. We blend v_eff = w v + (1 - w) V_learned with
w = exp(-(D - s)/(V_learned * 90 s)): the live speed for the next stretch, learned speeds beyond.
Shalaby & Farhan (2004) and Cathey & Dailey (2003) use Kalman filters in the same role.

## 8. Uncertainty: log-normal intervals and propagation (`model_quantile`)

Run times are positive and right-skewed: a red light or a stuck bus adds minutes, nothing
subtracts them. Model log x ~ N(mu, sigma^2): median e^mu, mean e^(mu + sigma^2/2) > median,
quantile q_tau = exp(mu + z_tau sigma) with z_0.9 = 1.2816, so the 80 % interval is
[e^(mu - 1.28 sigma), e^(mu + 1.28 sigma)] and it is longer on the late side, as riders experience
(peak/off-peak skew is documented by Mazloumi et al. 2010). Segment interval = run quantiles + w_a.

**Calibration.** Medians and MADs of noisy buckets understate tails, so a single multiplier c on
sigma is chosen (bisection) so that out-of-sample 80 % intervals on the training period really
cover 80 % (`calibrate_scale`; split-conformal in spirit). Reported in `docs/BACKTEST.md`.

**Arrival propagation.** From the bus's last logged arrival A_j at stop j, the arrival at stop m is

    A_m = A_j + sum_{i=j+1..m} (w_{i-1} + x_i)

Means add. Variances add **with correlation** (a slow bus stays slow): for T_i with sd sd_i and
pairwise correlation rho, Var(sum T_i) = sum sd_i^2 + rho * sum_{i != l} sd_i sd_l
(rho = 0 independent, rho = 1 all errors in the same direction). The sum of log-normals is
approximated by one log-normal with the same mean and variance (Fenton 1960):
sigma_T^2 = ln(1 + Var/Mean^2), mu_T = ln Mean - sigma_T^2/2 (`sum_lognormals`; we use rho = phi).

## 9. Metrics and time-ordered backtesting (`tools/backtest.py`)

With error e_i = prediction - actual and actual y_i:
MAE = mean|e|; RMSE = sqrt(mean e^2) (punishes big misses); MAPE = mean |e|/y (only y >= 10 s);
pinball loss for quantile tau: rho_tau(u) = tau u if u >= 0 else (tau - 1) u, u = y - q, averaged
over tau = 0.1, 0.5, 0.9 (a proper score for quantiles: Koenker & Bassett 1978, Gneiting & Raftery
2007); coverage = share of y inside [p10, p90] (target 80 %).

Protocol (Tashman 2000; Hyndman & Athanasopoulos, ch. 5.10):
- **70/30 time split**: train on the earliest 70 % of arrivals, test on the latest 30 %. Never shuffle:
  shuffling leaks tomorrow's traffic into today's model.
- **Rolling origin**: 4 expanding windows; every fold refits all models and re-tunes k.
- **Same information time for Passio**: for a test arrival with Passio lead L, the query time is
  q = A - L; our forecast may use only arrivals logged before q (last stop reached + predicted
  segments), and the EWMA state is replayed event by event so nothing from after q is visible.
- Hyper-parameters (k, c, gains) are fit inside the training period only.

## 10. Export contract (`model_segments.export_learned`, `tools/refresh_model.py`)

`learned.json` v2 (format defined by the header of `web/js/core/predict.js`):
`routes[rid].s["<segIdx>"] = {a:[medianRunSec, n, p10RunSec, p90RunSec, sigma], h:{"<0..167>":
[shrunkMedianRunSec, n]}, d:metres, v:m/s}`, `routes[rid].dw` = median dwell, plus `k`, `sigma`,
`kind` ("real"|"synthetic"), `bias:{rid:{m,a,n}}` (Passio ETA multiplier, median of actual/predicted
remaining time, n >= 30) and `corr` (EWMA gains, phi). p10/p90/sigma already include the calibration
multiplier c (`scale`). segIdx i is `route_stops[rid][i] -> [i+1]`.
h values are already shrunk through the hierarchy; the reader shrinks again toward the schedule
with w = n_a / (n_a + k). `refresh_model.py` is idempotent, needs >= 200 real rows, and never
writes this file from synthetic data unless `--allow-synthetic` is passed.

## 11. Later: gradient boosting and quantile regression

When months of data exist, fit gradient-boosted trees (Friedman 2001) with pinball loss at
tau = 0.1/0.5/0.9 on log x. Candidate features: segment id, d, h, daypart, academic-calendar flag
(class change minutes :50-:10), holiday, weather (rain/snow), s_trip/s_seg/s_route from section 6,
headway to the bus ahead (bunching), current schedule deviation, stop address context (a stop on
a signalised arterial vs a campus drive). Export as small lookup tables so the app stays build-free.
Only adopt it if the rolling-origin backtest beats the shrunk hierarchy.

## 12. What makes Passio wrong, and how we beat it

- **Schedule-anchored ETAs**: interpolated GTFS times ignore rush hour, class changes and the
  segment's real length. -> learned per-segment, per-hour medians with shrinkage (sections 4-5).
- **No memory of today**: a bus that has been slow for three segments is usually still slow. ->
  carry-over and EWMA residuals (section 6).
- **Dwell mixed with driving**: a long boarding at one stop distorts the speed estimate. -> x and
  w modelled separately (section 2).
- **Point estimates only**: no "could be 4-9 min". -> calibrated, right-skewed intervals (section 8).
- **Stale or jumpy GPS**: -> Kalman smoothing with jump rejection (section 7) and stale warnings in the UI.
- **Systematic bias**: if Passio is consistently optimistic on a route, `bias.m` corrects it.
We only claim a win where the time-ordered backtest on REAL data shows it (`docs/BACKTEST.md`).
Synthetic backtests prove the code recovers planted structure; they do not prove accuracy.

## 13. Reading list (verified references)

- Kalman, R. E. (1960). A New Approach to Linear Filtering and Prediction Problems. *Journal of Basic Engineering* 82(1): 35-45. doi:10.1115/1.3662552
- Wardrop, J. G. (1952). Some theoretical aspects of road traffic research. *Proc. Institution of Civil Engineers* Part II, 1(3): 325-362. doi:10.1680/ipeds.1952.11259
- Efron, B. & Morris, C. (1975). Data Analysis Using Stein's Estimator and its Generalizations. *JASA* 70(350): 311-319. doi:10.1080/01621459.1975.10479864
- Fenton, L. F. (1960). The Sum of Log-Normal Probability Distributions in Scatter Transmission Systems. *IRE Trans. Communications Systems* 8(1): 57-67. doi:10.1109/TCOM.1960.1097606
- Koenker, R. & Bassett, G. (1978). Regression Quantiles. *Econometrica* 46(1): 33-50.
- Friedman, J. H. (2001). Greedy Function Approximation: A Gradient Boosting Machine. *Annals of Statistics* 29(5): 1189-1232. doi:10.1214/aos/1013203451
- Gneiting, T. & Raftery, A. E. (2007). Strictly Proper Scoring Rules, Prediction, and Estimation. *JASA* 102(477): 359-378. doi:10.1198/016214506000001437
- Tashman, L. J. (2000). Out-of-sample tests of forecasting accuracy: an analysis and review. *Int. J. Forecasting* 16(4): 437-450. doi:10.1016/S0169-2070(00)00065-0
- Hyndman, R. J. & Athanasopoulos, G. (2021). *Forecasting: Principles and Practice*, 3rd ed. OTexts. https://otexts.com/fpp3/ (ch. 5.10 time series cross-validation)
- Cathey, F. W. & Dailey, D. J. (2003). A prescription for transit arrival/departure prediction using automatic vehicle location data. *Transportation Research Part C* 11(3-4): 241-264. doi:10.1016/S0968-090X(03)00023-8
- Shalaby, A. & Farhan, A. (2004). Prediction Model of Bus Arrival and Departure Times Using AVL and APC Data. *Journal of Public Transportation* 7(1): 41-61. doi:10.5038/2375-0901.7.1.3
- Mazloumi, E., Currie, G. & Rose, G. (2010). Using GPS Data to Gain Insight into Public Transport Travel Time Variability. *J. Transportation Engineering* 136(7): 623-631. doi:10.1061/(ASCE)TE.1943-5436.0000126
