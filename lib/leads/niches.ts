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

/** BLUEPRINT_BASE_URL + slug, e.g. https://efficiencysprint.com/blueprint/consultants */
export function blueprintUrl(niche: Niche): string {
  const base = (process.env.BLUEPRINT_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("BLUEPRINT_BASE_URL is not set");
  return `${base}/${encodeURIComponent(niche.slug)}`;
}

export function resetNichesForTests() {
  cache = null;
}
