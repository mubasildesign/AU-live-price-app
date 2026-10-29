export async function fetchWorldPrices() {
  const res = await fetch("/api/world-prices");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

export async function checkHealth() {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error("API unreachable");
  return res.json();
}
