import { City, State } from "country-state-city";
import { COUNTRY_CODES, type CountryCode } from "./phone";

export type CityHit = { name: string; state: string };
type Row = CityHit & { key: string };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const index = new Map<CountryCode, Row[]>();
/** Built lazily per country, so start-up stays fast and unused countries cost nothing. */
function rows(country: CountryCode): Row[] {
  let r = index.get(country);
  if (r) return r;
  const states = new Map((State.getStatesOfCountry(country) ?? []).map((s) => [s.isoCode, s.name]));
  const seen = new Set<string>();
  r = [];
  for (const c of City.getCitiesOfCountry(country) ?? []) {
    const state = states.get(c.stateCode) ?? c.stateCode ?? "";
    const k = `${fold(c.name)}|${state}`;
    if (seen.has(k)) continue;
    seen.add(k);
    r.push({ name: c.name, state, key: fold(c.name) });
  }
  r.sort((a, b) => a.name.localeCompare(b.name));
  index.set(country, r);
  return r;
}

export const supportedCountries = COUNTRY_CODES;

/** Suggestions for a typed prefix: names that start with the text first, then names that contain it. */
export function searchCities(country: CountryCode, q: string, limit = 10): CityHit[] {
  const needle = fold(q);
  if (needle.length < 2) return [];
  const all = rows(country);
  const starts: Row[] = [], contains: Row[] = [];
  for (const r of all) {
    if (r.key.startsWith(needle)) { starts.push(r); if (starts.length >= limit) break; }
    else if (contains.length < limit && r.key.includes(needle)) contains.push(r);
  }
  return [...starts, ...contains].slice(0, limit).map(({ name, state }) => ({ name, state }));
}

/** Returns the canonical city (and its state) when `city` really exists in `country`, otherwise null. */
export function verifyCity(country: CountryCode, city: string, state?: string): CityHit | null {
  const k = fold(city);
  if (!k) return null;
  const hits = rows(country).filter((r) => r.key === k);
  if (!hits.length) return null;
  const s = state ? fold(state) : "";
  const best = (s && hits.find((h) => fold(h.state) === s)) || hits[0];
  return { name: best.name, state: best.state };
}
