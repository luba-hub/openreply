// es-funnel: config/niches.json from es-operations content/instagram/marketing-dept-reels:
// niches-60.md (# | Niche | Comment word | …) and data/*.yaml (`slug:` per niche file, matched by its `comment_word:`).
//   node scripts/build-niches.mjs <marketing-dept-reels dir> > config/niches.json
// A word with no data file yet gets its word in lowercase as the slug.
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: node scripts/build-niches.mjs <marketing-dept-reels dir>"); process.exit(2); }
const slugs = new Map();
for (const f of fs.existsSync(path.join(dir, "data")) ? fs.readdirSync(path.join(dir, "data")) : []) {
  if (!f.endsWith(".yaml")) continue;
  const y = fs.readFileSync(path.join(dir, "data", f), "utf8");
  const slug = y.match(/^slug:\s*([a-z0-9-]+)/m)?.[1], word = y.match(/^comment_word:\s*([A-Z0-9]+)/m)?.[1] ?? y.match(/Comment "([A-Z0-9]+)"/)?.[1];
  if (slug && word) slugs.set(word, slug);
}
const out = [];
for (const line of fs.readFileSync(path.join(dir, "niches-60.md"), "utf8").split("\n")) {
  const c = line.split("|").map((s) => s.trim());
  if (!/^\d+$/.test(c[1] ?? "")) continue;
  const word = c[3];
  if (!/^[A-Z0-9]+$/.test(word)) throw new Error(`row ${c[1]}: comment word "${word}" isn't one uppercase word`);
  out.push({ word, slug: slugs.get(word) ?? word.toLowerCase(), label: c[2] });
}
const words = out.map((n) => n.word);
if (new Set(words).size !== words.length) throw new Error("a comment word appears twice");
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
