"use client";
import { useEffect, useState } from "react";
import type { MetricsReport } from "@/server/metrics";
import { useApp } from "../app-context";
import { api, ApiError } from "../api-client";
import { errorText } from "../i18n";
import { modelLabel } from "../format";
import { MenuButton } from "./AppShell";

const PERIODS = [7, 14, 30];

export function MetricsView() {
  const { t, locale, isAdmin } = useApp();
  const [days, setDays] = useState(14);
  const [report, setReport] = useState<MetricsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    api<MetricsReport>(`admin/metrics?days=${days}`)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(locale, (e as ApiError).code));
      });
    return () => {
      cancelled = true;
    };
  }, [days, locale, isAdmin]);

  const n = (v: number) => v.toLocaleString(locale);
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  const ms = (v: number | null) => (v === null ? "—" : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`);
  const usd = (v: number | null) => (v === null ? "—" : `$${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)}`);

  const header = (
    <header className="topbar">
      <MenuButton />
      <div className="topbar-title">
        <div className="t">{t("metrics.title")}</div>
      </div>
      {isAdmin && (
        <div className="segmented" role="group" aria-label={t("metrics.period")}>
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)}>
              {p} {t("metrics.days")}
            </button>
          ))}
        </div>
      )}
    </header>
  );

  if (!isAdmin) {
    return (
      <>
        {header}
        <div className="page">
          <p className="empty">{t("metrics.forbidden")}</p>
        </div>
      </>
    );
  }

  const r = report;
  return (
    <>
      {header}
      <div className="page">
        <div className="page-inner" style={{ maxWidth: 1000 }}>
          <p className="small muted">
            {t("metrics.note")}
            {r ? ` ${r.period.from} — ${r.period.to}.` : ""}
          </p>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {!r && !error && <p className="empty">{t("common.loading")}</p>}
          {r && (
            <>
              <div className="kpi-grid" data-testid="kpis">
                <Kpi label={t("metrics.users")} value={n(r.totals.users)} sub={`+${n(r.totals.newUsers)} ${t("metrics.newUsers")}`} />
                <Kpi label={t("metrics.active")} value={n(r.totals.activeUsers)} sub={`${t("metrics.returning")}: ${n(r.retention.returningUsers)}`} />
                <Kpi
                  label={t("metrics.requests")}
                  value={n(r.totals.requests)}
                  sub={`${r.totals.requestsPerActiveUser === null ? "—" : r.totals.requestsPerActiveUser.toFixed(1)} ${t("metrics.perUser")}`}
                />
                <Kpi
                  label={t("metrics.success")}
                  value={pct(r.totals.successRate)}
                  sub={`${pct(r.totals.errorRate)} ${t("metrics.errors")} · ${pct(r.totals.cancelledRate)} ${t("metrics.cancelled")}`}
                />
                <Kpi label={t("metrics.ttft")} value={ms(r.totals.ttftP50)} sub={`p95 ${ms(r.totals.ttftP95)}`} />
                <Kpi label={t("metrics.latency")} value={ms(r.totals.latencyP50)} sub={`p95 ${ms(r.totals.latencyP95)}`} />
                <Kpi label={t("metrics.satisfaction")} value={pct(r.totals.satisfaction)} sub={`👍 ${r.totals.feedbackUp} · 👎 ${r.totals.feedbackDown}`} />
                <Kpi label={t("metrics.cost")} value={usd(r.totals.cost)} sub={`${usd(r.totals.costPerAnswer)} ${t("metrics.perAnswer")}`} />
                <Kpi
                  label={t("metrics.tokens")}
                  value={n(r.totals.inputTokens + r.totals.outputTokens)}
                  sub={`in ${n(r.totals.inputTokens)} · out ${n(r.totals.outputTokens)}`}
                />
              </div>

              <section className="section">
                <h2 className="section-title">{t("metrics.retention")}</h2>
                <div className="card list-card" data-testid="retention">
                  {(
                    [
                      ["metrics.d1", r.retention.d1],
                      ["metrics.d7", r.retention.d7],
                    ] as const
                  ).map(([key, v]) => (
                    <div key={key} className="row spread">
                      <span>{t(key)}</span>
                      <span className="serif" style={{ fontSize: 18 }}>
                        {pct(v.rate)}{" "}
                        <span className="small muted">
                          ({v.retained} {t("metrics.of")} {v.eligible})
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <Table
                title={t("metrics.daily")}
                head={[t("metrics.date"), t("metrics.requests"), t("metrics.active"), t("metrics.new"), t("metrics.errors"), "p50", "p95", "👍", "👎"]}
                rows={[...r.daily].reverse().map((d) => [d.date, n(d.requests), n(d.activeUsers), n(d.newUsers), n(d.errors), ms(d.latencyP50), ms(d.latencyP95), n(d.up), n(d.down)])}
                empty={t("metrics.noData")}
                testId="daily"
              />
              <Table
                title={t("metrics.byModel")}
                head={[t("metrics.model"), t("metrics.requests"), t("metrics.success"), "p50", "👍", "👎"]}
                rows={r.byModel.map((m) => [modelLabel(m.provider, m.model) || m.model, n(m.requests), pct(m.successRate), ms(m.latencyP50), n(m.up), n(m.down)])}
                empty={t("metrics.noData")}
                testId="by-model"
              />
              <Table
                title={t("metrics.byMode")}
                head={[t("metrics.mode"), t("metrics.requests"), t("metrics.success")]}
                rows={r.byMode.map((m) => [m.mode, n(m.requests), pct(m.successRate)])}
                empty={t("metrics.noData")}
              />
              <Table
                title={t("metrics.errorsTitle")}
                head={[t("metrics.code"), t("metrics.count")]}
                rows={r.errors.map((e) => [e.code, n(e.count)])}
                empty={t("metrics.noData")}
                testId="errors"
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Table({ title, head, rows, empty, testId }: { title: string; head: string[]; rows: string[][]; empty: string; testId?: string }) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      <div className="card table-wrap" data-testid={testId}>
        {rows.length === 0 ? (
          <p className="small muted" style={{ padding: "12px 16px", margin: 0 }}>
            {empty}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
