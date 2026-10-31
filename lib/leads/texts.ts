/**
 * es-funnel: the DM texts, as approved (es-operations content/instagram/marketing-dept-reels/dm-flow.md
 * 69b303c1: Vault PASS, Luba's OK 10-31 via the Chief). Pasted as is; LEAD_*_MESSAGE in the environment
 * overrides one. {niche} is the niche in plain words ("plumbing companies"), {first_name} theirs, {link} the blueprint.
 */
import type { Niche } from "@/lib/leads/niches";

export const TEXTS = {
  // 1 · reply to the comment word
  ask: "Hey, so glad you asked! The blueprint for {niche} is ready for you.\n\nTell me your first name and where to email it, and it's yours.",
  // 1b · they gave their name and no email
  askEmail: "Nice to meet you, {first_name}! And where do I email it?",
  // 2 · the email doesn't look like an email
  reask: "Oops, I think a letter went missing there. Can you type the email once more? Like name@company.com.",
  // 3 · after the email
  blueprint: "Here you go, {first_name}: {link}\n\nFind yourself at the top. Right under you is the Marketing Lead, then the 8 teams, and every box says what it does alone and what waits for your yes. I sent a copy to your inbox too.",
};

const ENV: Record<keyof typeof TEXTS, string> = { ask: "LEAD_ASK_MESSAGE", askEmail: "LEAD_ASK_EMAIL_MESSAGE", reask: "LEAD_REASK_MESSAGE", blueprint: "LEAD_BLUEPRINT_MESSAGE" };

export function nichePlain(niche: Niche): string {
  return niche.label.charAt(0).toLowerCase() + niche.label.slice(1);
}

/** The text with its fields filled. No first name: ", {first_name}" goes, so "Here you go: <link>". */
export function text(kind: keyof typeof TEXTS, v: { niche?: Niche | null; firstName?: string | null; link?: string }): string {
  let t = process.env[ENV[kind]] || TEXTS[kind];
  if (!v.firstName) t = t.replace(/,? \{first_name\}/g, "");
  return t.replace(/\{(\w+)\}/g, (m, k) =>
    k === "niche" && v.niche ? nichePlain(v.niche) : k === "first_name" && v.firstName ? v.firstName : k === "link" && v.link ? v.link : m);
}
