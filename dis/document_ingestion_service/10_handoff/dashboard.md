# DIS Admin Dashboard — Panel Specification

**Ticket:** DIS-158
**Data source:** `GET /admin/metrics` (DIS-099) — Prometheus-style exposition scraped by Grafana, or rendered directly by the admin UI for POC.
**Scope:** Panel spec only. Grafana dashboard JSON is deliberately out of scope; it will be authored against the panel contract below.

All metric names below correspond to the Prometheus counters/gauges/histograms defined in DIS-148 (metrics catalog). The admin UI reads them via the Prometheus HTTP API proxied through `/admin/metrics`.

---

### Queue Depth

- **Metric source (DIS-148):** `dis_queue_depth{queue="<preprocess|ocr|structuring|verify>"}` (gauge)
- **Chart type:** Multi-series gauge (one dial per queue) + small companion sparkline of last 60 min.
- **Alert threshold:**
  - WARN when any queue depth > 50 for > 5 min.
  - CRIT when any queue depth > 200 for > 2 min, or growth rate > 20/min sustained.
- **Purpose:** Surface backpressure before SLO breach. Operators redirect capacity or pause intake.

### Throughput

- **Metric source (DIS-148):** `dis_documents_total{outcome="approved|rejected|auto_approved|escalated"}` (counter) — displayed as `rate(...[1h])`.
- **Chart type:** Stacked-bar per hour (last 24 h) + headline counters (approved/hr, rejected/hr, net).
- **Alert threshold:**
  - WARN if `approved/hr` drops below 60 % of trailing 7-day median for 2 consecutive hours during business window.
  - INFO banner if `rejected/hr` > `approved/hr`.
- **Purpose:** Tracks business-level document flow and catch sudden regressions after deploys.

### OCR Latency

- **Metric source (DIS-148):** `dis_ocr_duration_seconds_bucket` (histogram) — derive p50 and p95 via `histogram_quantile`.
- **Chart type:** Time-series (dual line: p50 and p95) over the last 6 h, with a step overlay for model/version changes if annotated.
- **Alert threshold:**
  - WARN when p95 > 8 s for 10 min.
  - CRIT when p95 > 15 s for 5 min (breaches pipeline SLO).
- **Purpose:** Primary perf indicator for the OCR stage (Chandra / Datalab).

### Cost Today

- **Metric source (DIS-148):** `dis_cost_micro_inr_total` (counter, monotonic, resets daily at 00:00 IST) vs the environment variable `DIS_DAILY_BUDGET_INR` exposed as `dis_daily_budget_inr` (gauge).
- **Chart type:** Running-total gauge with budget arc (0 → `DIS_DAILY_BUDGET_INR`) + a burn-down line-chart for the current day.
- **Alert threshold:**
  - WARN at 70 % of daily budget.
  - CRIT at 90 % — triggers auto-throttle hook (out of scope for this panel, but the threshold is the same).
- **Purpose:** Keeps LLM/OCR spend inside the daily envelope; visible to ops and finance.

### Error Rate

- **Metric source (DIS-148):** `dis_stage_errors_total{stage="preprocess|ocr|structuring",kind="<error_class>"}` (counter) over `dis_stage_attempts_total{stage=...}` → ratio.
- **Chart type:** Stacked-bar of error % by stage (preprocess / ocr / structuring) per 5-min bucket over last 2 h; drill-down table underneath with top `kind` labels.
- **Alert threshold:**
  - WARN when any stage error rate > 2 % for 15 min.
  - CRIT when any stage error rate > 10 % for 5 min, or total pipeline error rate > 5 % for 15 min.
- **Purpose:** Localises failure to a pipeline stage without digging through logs.

### Operator SLO

- **Metric source (DIS-148):** `dis_verify_latency_seconds_bucket` (histogram of operator verify-turnaround) — p95 computed via `histogram_quantile`.
- **SLO target:** from DIS-159 — p95 verify latency ≤ 4 min during staffed hours.
- **Chart type:** Time-series p95 line with a horizontal SLO threshold band; sidebar counter shows "minutes of burn" (error-budget consumption today).
- **Alert threshold:**
  - WARN when p95 > target for 30 min during staffed hours.
  - CRIT when daily error-budget burn > 50 % before 12:00 IST.
- **Purpose:** Operator-experience SLO tied to staffing decisions.

---

## Layout notes (non-binding)

- Recommended grid: 2 × 3 (Queue Depth + Throughput on top, OCR Latency + Cost Today in the middle, Error Rate + Operator SLO at the bottom).
- All panels default to `now-6h` range except Throughput (24 h) and Cost Today (since 00:00 IST).
- Auto-refresh 30 s; manual refresh button on the admin page.

## Contract with DIS-099 / DIS-148

- The admin UI does **not** compute aggregates client-side beyond trivial sums. All `rate()`, `histogram_quantile()`, and ratio math runs in Prometheus (or the `/admin/metrics` proxy).
- Panel names in this spec are the canonical titles; a later Grafana JSON ticket will mirror them 1-to-1.
