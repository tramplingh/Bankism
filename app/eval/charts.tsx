/**
 * Server-rendered bar charts for the eval page: plain HTML and CSS, no chart library and no
 * client JavaScript. Every bar carries a direct value label; the full numbers are also in the
 * table view on the page, so nothing depends on colour or hover alone.
 */

export interface Series {
  key: string;
  label: string;
  /** CSS class that sets the fill colour (see `.fill-*` in globals.css). */
  fill: string;
}

export interface Row {
  label: string;
  note?: string;
  values: Record<string, number>;
}

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="legend" aria-hidden="true">
      {series.map((s) => (
        <li key={s.key}>
          <span className={`swatch ${s.fill}`} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Horizontal bars, one track per series per row, on a shared 0..max scale. */
export function BarChart({
  rows,
  series,
  max,
  format,
}: {
  rows: Row[];
  series: Series[];
  max: number;
  format: (v: number) => string;
}) {
  return (
    <div className="chart">
      {series.length > 1 && <Legend series={series} />}
      <ul className="bars">
        {rows.map((r) => (
          <li key={r.label} className="bar-row">
            <span className="bar-label">
              {r.label}
              {r.note && <span className="bar-note">{r.note}</span>}
            </span>
            <span className="bar-tracks">
              {series.map((s) => {
                const v = r.values[s.key] ?? 0;
                const text = format(v);
                return (
                  <span key={s.key} className="bar-track" data-tip={`${s.label}: ${text}`}>
                    <span className={`bar ${s.fill}`} style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
                    <span className="bar-value">
                      {series.length > 1 && <span className="sr-only">{s.label}: </span>}
                      {text}
                    </span>
                  </span>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One 100% bar per row, split into segments that are labelled underneath in words. */
export function StackedChart({ rows, series }: { rows: Row[]; series: Series[] }) {
  return (
    <div className="chart">
      <Legend series={series} />
      <ul className="bars">
        {rows.map((r) => (
          <li key={r.label} className="bar-row">
            <span className="bar-label">
              {r.label}
              {r.note && <span className="bar-note">{r.note}</span>}
            </span>
            <span className="bar-tracks">
              <span className="stack" aria-hidden="true">
                {series.map((s) =>
                  (r.values[s.key] ?? 0) > 0 ? (
                    <span
                      key={s.key}
                      className={`seg ${s.fill}`}
                      style={{ width: `${r.values[s.key]}%` }}
                      data-tip={`${s.label}: ${r.values[s.key]}%`}
                    />
                  ) : null,
                )}
              </span>
              <span className="stack-values">
                {series.map((s) => `${r.values[s.key] ?? 0}% ${s.label.charAt(0).toLowerCase()}${s.label.slice(1)}`).join(" · ")}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
