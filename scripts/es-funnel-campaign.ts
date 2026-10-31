// es-funnel: the one niche campaign on a connected Instagram account. Any post or reel, all the comment words
// in config/niches.json, the DM asks for a first name and email and a public reply says so (lib/leads/texts.ts, as approved), collectLead on. Run it again
// after niches.json changes: it updates the same campaign (by name) and creates nothing twice.
//   npx tsx scripts/es-funnel-campaign.ts <instagram username> [--off]
import { prisma } from "@/lib/db/client";
import { allNicheWords } from "@/lib/leads/niches";
import { PUBLIC_REPLIES, TEXTS } from "@/lib/leads/texts";

const NAME = "Niche blueprint (name + email)";
const username = process.argv[2]?.replace(/^@/, "");
const off = process.argv.includes("--off");
if (!username) { console.error("usage: npx tsx scripts/es-funnel-campaign.ts <instagram username> [--off]"); process.exit(2); }
const ask = process.env.LEAD_ASK_MESSAGE || TEXTS.ask; // {niche} is filled per comment by the worker

async function main() {
  const account = await prisma.instagramAccount.findFirst({ where: { username } });
  if (!account) { console.error(`no connected account @${username}; connect it in Settings first`); process.exit(1); }
  const data = {
    matchAnyPost: true, postId: null, keywords: allNicheWords(), matchAnyWord: false, wholeWordMatch: true,
    dmMessage: ask, collectLead: true, dmTriggerEnabled: false, openingDmEnabled: false, requireFollow: false,
    publicReplyEnabled: true, publicReplyMessages: PUBLIC_REPLIES, followUpEnabled: false, isActive: !off,
  };
  const found = await prisma.automation.findFirst({ where: { instagramAccountId: account.id, name: NAME } });
  const saved = found
    ? await prisma.automation.update({ where: { id: found.id }, data })
    : await prisma.automation.create({ data: { ...data, name: NAME, workspaceId: account.workspaceId, instagramAccountId: account.id } });
  console.log(`${found ? "updated" : "created"} "${NAME}" on @${username}: ${saved.keywords.length} words, ${saved.isActive ? "on" : "off"}`);
  await prisma.$disconnect();
}

// No top-level await: tsx runs this as CommonJS inside the image.
main().catch((error) => { console.error(error); process.exit(1); });
