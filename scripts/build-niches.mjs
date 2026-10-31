// es-funnel: config/niches.json from es-operations content/instagram/marketing-dept-reels/niches-60.md
// (# | Niche | Comment word | …). The slug is the word in lowercase (the Chief 10-31: ROOFING → /blueprint/roofing).
//   node scripts/build-niches.mjs <marketing-dept-reels dir> > config/niches.json
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: node scripts/build-niches.mjs <marketing-dept-reels dir>"); process.exit(2); }
const out = [];
for (const line of fs.readFileSync(path.join(dir, "niches-60.md"), "utf8").split("\n")) {
  const c = line.split("|").map((s) => s.trim());
  if (!/^\d+$/.test(c[1] ?? "")) continue;
  const word = c[3];
  if (!/^[A-Z0-9]+$/.test(word)) throw new Error(`row ${c[1]}: comment word "${word}" isn't one uppercase word`);
  out.push({ word, slug: word.toLowerCase(), label: c[2] });
}
const words = out.map((n) => n.word);
if (new Set(words).size !== words.length) throw new Error("a comment word appears twice");
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
