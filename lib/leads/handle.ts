/**
 * es-funnel: the person's reply to the name+email ask. With an email: MailerLite
 * (one group, their first name, the niche of the word they commented), then the
 * niche's blueprint link. Without one: one re-ask, then nothing more. Every DM it
 * sends takes a slot from the account's hourly cap and is logged; the reply's
 * name and email are never stored or logged.
 */
import { prisma } from "@/lib/db/client";
import { createInstagramContext } from "@/lib/instagram/context";
import { sendDirectMessage } from "@/lib/instagram/send-messages";
import { reserveDMSlot, releaseDMSlot } from "@/lib/utils/rate-limiter";
import { getDMQueue, MESSAGE_JOB_NAME, type ProcessMessageJob } from "@/lib/queue/client";
import { parseLeadReply, redactEmails, type LeadReply } from "@/lib/leads/parse";
import { nicheFor, blueprintUrl } from "@/lib/leads/niches";
import { upsertSubscriber, MailerLiteError } from "@/lib/leads/mailerlite";
import type { LeadState } from "@/app/generated/prisma/client";

/** A reply this long after the ask isn't an answer to it any more. */
export const LEAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type LeadStep = "sync" | "send" | "reask" | "stop" | "ignore";

export function nextLeadStep(state: LeadState, reply: LeadReply): LeadStep {
  if (state === "SYNCED") return "send"; // in MailerLite already; the link didn't go out yet
  if (state !== "ASKED" && state !== "REASKED") return "ignore";
  if (reply.email) return "sync";
  return state === "ASKED" ? "reask" : "stop";
}

// Placeholders until Luba's approved texts are set in the environment.
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
export function blueprintText(name: string | null, link: string, niche: string) {
  return fill(process.env.LEAD_BLUEPRINT_MESSAGE || "Thanks{comma_name}! Here's your blueprint for {niche}: {link}", {
    comma_name: name ? `, ${name}` : "", name: name ?? "", link, niche,
  });
}
export function reaskText() {
  return process.env.LEAD_REASK_MESSAGE || "Reply with your first name and email and I'll send the blueprint over.";
}

export interface LeadDeps {
  send: typeof sendDirectMessage;
  upsert: typeof upsertSubscriber;
  reserve: typeof reserveDMSlot;
  release: typeof releaseDMSlot;
  requeue: (data: ProcessMessageJob, delayMs: number) => Promise<unknown>;
  now: () => Date;
}

const defaultDeps: LeadDeps = {
  send: sendDirectMessage,
  upsert: upsertSubscriber,
  reserve: reserveDMSlot,
  release: releaseDMSlot,
  requeue: (data, delayMs) =>
    getDMQueue().add(MESSAGE_JOB_NAME, { ...data, requeueAttempt: (data.requeueAttempt ?? 0) + 1 }, {
      delay: delayMs,
      jobId: `message_${data.instagramAccountId}_${Buffer.from(data.messageId).toString("base64url")}_rq${(data.requeueAttempt ?? 0) + 1}`,
    }),
  now: () => new Date(),
};

/**
 * True when the message was a reply to an open ask (handled here, so the
 * keyword triggers don't see it); false otherwise.
 */
export async function handleLeadMessage(data: ProcessMessageJob, deps: LeadDeps = defaultDeps): Promise<boolean> {
  const { instagramAccountId, accountConnectionId, senderId, messageId, messageText } = data;
  const account = await prisma.instagramAccount.findFirst({
    where: { instagramId: instagramAccountId, ...(accountConnectionId ? { id: accountConnectionId } : {}) },
  });
  if (!account) return false;
  const lead = await prisma.lead.findUnique({
    where: { instagramAccountId_igUserId: { instagramAccountId: account.id, igUserId: senderId } },
  });
  if (!lead || deps.now().getTime() - lead.askedAt.getTime() > LEAD_TTL_MS) return false;

  const reply = parseLeadReply(messageText);
  const step = nextLeadStep(lead.state, reply);
  if (step === "ignore") return false;

  const logId = `lead:${messageId}`;
  const log = (status: "SENT" | "FAILED" | "SKIPPED_NO_MATCH" | "SKIPPED_RATE_LIMIT", errorMessage: string | null) =>
    prisma.dmLog.upsert({
      where: { automationId_commentId: { automationId: lead.automationId, commentId: logId } },
      create: {
        workspaceId: lead.workspaceId, automationId: lead.automationId, instagramAccountId: account.id,
        commenterId: senderId, commentText: `[lead reply: ${step}]`, commentId: logId, matchedKeyword: lead.keyword,
        status, errorMessage, ...(status === "SENT" ? { dmSentAt: deps.now() } : {}),
      },
      update: { status, errorMessage, ...(status === "SENT" ? { dmSentAt: deps.now() } : {}) },
    });
  const setState = (state: LeadState, extra: Record<string, Date> = {}) =>
    prisma.lead.update({ where: { id: lead.id }, data: { state, ...extra } });

  const niche = nicheFor(lead.keyword);
  if (!niche) {
    await setState("STOPPED");
    await log("SKIPPED_NO_MATCH", `no niche for the word ${lead.keyword}`);
    return true;
  }
  if (step === "stop") {
    await setState("STOPPED");
    await log("SKIPPED_NO_MATCH", "no email after the re-ask");
    return true;
  }

  const slot = await deps.reserve(instagramAccountId, data.requeueAttempt ?? 0);
  if (!slot.allowed) {
    if (slot.shouldRequeue) await deps.requeue(data, slot.requeueDelayMs);
    await log("SKIPPED_RATE_LIMIT", slot.shouldRequeue ? "hourly cap reached; requeued" : "hourly cap reached");
    return true;
  }
  let sent = false;
  try {
    const context = await createInstagramContext(account, `lead:${lead.id}:${messageId}`);
    if (step === "reask") {
      await deps.send({ context, instagramAccountId, userId: senderId, message: reaskText() });
      sent = true;
      await setState("REASKED");
      await log("SENT", null);
      return true;
    }
    if (step === "sync") {
      try {
        await deps.upsert({ email: reply.email as string, firstName: reply.firstName, niche: niche.slug });
      } catch (error) {
        if (error instanceof MailerLiteError && !error.retryable) {
          // MailerLite refused the address: ask once more if this was the first try, else stop.
          if (lead.state === "ASKED") {
            await deps.send({ context, instagramAccountId, userId: senderId, message: reaskText() });
            sent = true;
            await setState("REASKED");
            await log("SENT", `${error.message}; asked again`);
          } else {
            await deps.release(instagramAccountId);
            await setState("STOPPED");
            await log("FAILED", error.message);
          }
          return true;
        }
        throw error;
      }
      await setState("SYNCED", { syncedAt: deps.now() });
    }
    await deps.send({ context, instagramAccountId, userId: senderId, message: blueprintText(reply.firstName, blueprintUrl(niche), niche.label) });
    sent = true;
    await setState("DONE", { blueprintSentAt: deps.now() });
    await log("SENT", null);
    return true;
  } catch (error) {
    if (!sent) await deps.release(instagramAccountId);
    await log("FAILED", redactEmails(error instanceof Error ? error.message : String(error)).slice(0, 300));
    throw error; // BullMQ retries; a SYNCED lead skips MailerLite on the retry
  }
}

/** After the name+email ask went out on a comment: the person's open lead (a new comment restarts it). */
export async function openLead(a: { workspaceId: string; automationId: string; instagramAccountId: string; igUserId: string; keyword: string | null }) {
  if (!a.keyword || !nicheFor(a.keyword)) return null;
  const data = { workspaceId: a.workspaceId, automationId: a.automationId, keyword: a.keyword.toUpperCase(), state: "ASKED" as const, askedAt: new Date(), syncedAt: null, blueprintSentAt: null };
  return prisma.lead.upsert({
    where: { instagramAccountId_igUserId: { instagramAccountId: a.instagramAccountId, igUserId: a.igUserId } },
    create: { ...data, instagramAccountId: a.instagramAccountId, igUserId: a.igUserId },
    update: data,
  });
}
