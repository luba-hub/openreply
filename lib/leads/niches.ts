/**
 * es-funnel: the comment word → its niche (MailerLite's `niche` field) and the
 * niche's blueprint link. config/niches.json, built from es-operations
 * content/instagram/marketing-dept-reels/niches-60.md (scripts/build-niches.mjs).
 */
import fs from "node:fs";
import path from "node:path";

export interface Niche {
  word: string;
  slug: string;
  label: string;
}

let cache: Map<string, Niche> | null = null;

function load(): Map<string, Niche> {
  if (cache) return cache;
  const file = process.env.NICHES_FILE || path.join(process.cwd(), "config", "niches.json");
  const list = JSON.parse(fs.readFileSync(file, "utf8")) as Niche[];
  cache = new Map(list.map((n) => [n.word.toUpperCase(), n]));
  return cache;
}

export function nicheFor(word: string | null | undefined): Niche | null {
  if (!word) return null;
  return load().get(word.trim().toUpperCase()) ?? null;
}

export function allNicheWords(): string[] {
  return [...load().keys()];
}

/**
 * The niche's blueprint page (BLUEPRINT_BASE_URL/<slug>) while it's there; until the Website Lead builds it,
 * the general one (BLUEPRINT_BASE_URL itself; the Chief 10-31). Each answer is kept 10 minutes.
 */
const pages = new Map<string, { ok: boolean; at: number }>();
export async function blueprintLink(niche: Niche, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<string> {
  const base = (process.env.BLUEPRINT_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("BLUEPRINT_BASE_URL is not set");
  const url = `${base}/${encodeURIComponent(niche.slug)}`;
  const seen = pages.get(url);
  if (seen && now - seen.at < 10 * 60_000) return seen.ok ? url : base;
  let ok = false;
  try {
    const res = await fetchImpl(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
    ok = res.status >= 200 && res.status < 300;
  } catch { /* the site didn't answer: the general page */ }
  pages.set(url, { ok, at: now });
  return ok ? url : base;
}

export function resetNichesForTests() {
  cache = null;
  pages.clear();
}
