export function fmtMoney(amount, currency, symbol) {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${symbol || currency} ${Math.round(amount).toLocaleString()}`;
  }
}

export const fmtUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export const fmtPct = new Intl.NumberFormat("en", {
  signDisplay: "always",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUpdated(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);

  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function changeHtml(pct) {
  if (pct == null) return `<span class="delta delta--flat">—</span>`;
  const cls = pct >= 0 ? "delta--up" : "delta--down";
  return `<span class="delta ${cls}">${fmtPct.format(pct)}%</span>`;
}
