// es-funnel: the one niche campaign on a connected Instagram account. Any post or reel, all the comment words
// in config/niches.json, the DM asks for a first name and email (LEAD_ASK_MESSAGE), collectLead on. Run it again
// after niches.json changes: it updates the same campaign (by name) and creates nothing twice.
//   npx tsx scripts/es-funnel-campaign.ts <instagram username> [--off]
import { prisma } from "@/lib/db/client";
import { allNicheWords } from "@/lib/leads/niches";

const NAME = "Niche blueprint (name + email)";
const username = process.argv[2]?.replace(/^@/, "");
const off = process.argv.includes("--off");
if (!username) { console.error("usage: npx tsx scripts/es-funnel-campaign.ts <instagram username> [--off]"); process.exit(2); }
const ask = process.env.LEAD_ASK_MESSAGE || "Hi {username}! Reply with your first name and email and I'll send you the blueprint.";

const account = await prisma.instagramAccount.findFirst({ where: { username } });
if (!account) { console.error(`no connected account @${username}; connect it in Settings first`); process.exit(1); }
const data = {
  matchAnyPost: true, postId: null, keywords: allNicheWords(), matchAnyWord: false, wholeWordMatch: true,
  dmMessage: ask, collectLead: true, dmTriggerEnabled: false, openingDmEnabled: false, requireFollow: false,
  publicReplyEnabled: false, followUpEnabled: false, isActive: !off,
};
const found = await prisma.automation.findFirst({ where: { instagramAccountId: account.id, name: NAME } });
const saved = found
  ? await prisma.automation.update({ where: { id: found.id }, data })
  : await prisma.automation.create({ data: { ...data, name: NAME, workspaceId: account.workspaceId, instagramAccountId: account.id } });
console.log(`${found ? "updated" : "created"} "${NAME}" on @${username}: ${saved.keywords.length} words, ${saved.isActive ? "on" : "off"}`);
await prisma.$disconnect();
