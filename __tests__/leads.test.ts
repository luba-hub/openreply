import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockCreateContext } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findFirst: vi.fn() },
    lead: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    dmLog: { upsert: vi.fn() },
  },
  mockCreateContext: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/instagram/context", () => ({ createInstagramContext: mockCreateContext }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: vi.fn() }), MESSAGE_JOB_NAME: "process-message" }));

import { parseLeadReply, redactEmails, redactEmailsDeep } from "@/lib/leads/parse";
import { nicheFor, blueprintUrl, allNicheWords, resetNichesForTests } from "@/lib/leads/niches";
import { upsertSubscriber, MailerLiteError } from "@/lib/leads/mailerlite";
import { handleLeadMessage, nextLeadStep, openLead, LEAD_TTL_MS, type LeadDeps } from "@/lib/leads/handle";

describe("es-funnel: reading the reply", () => {
  it.each([
    ["Ann ann@example.com", "ann@example.com", "Ann"],
    ["hi! my name is maria, maria.lopez+ig@Mail.Co.", "maria.lopez+ig@mail.co", "Maria"],
    ["ann@example.com", "ann@example.com", null],
    ["I'm José — jose@example.org", "jose@example.org", "José"],
    ["Ann here, no email sorry", null, "Ann"],
    ["Маша masha@example.ru", "masha@example.ru", "Маша"],
  ])("%s", (text, email, firstName) => {
    expect(parseLeadReply(text)).toEqual({ email, firstName });
  });

  it("emails are redacted everywhere they'd be stored", () => {
    expect(redactEmails("Ann ann@example.com and bo@x.io")).toBe("Ann [email] and [email]");
    expect(redactEmailsDeep({ entry: [{ messaging: [{ message: { text: "a@b.co", mid: "m" } }] }], n: 3 })).toEqual({ entry: [{ messaging: [{ message: { text: "[email]", mid: "m" } }] }], n: 3 });
  });
});

describe("es-funnel: niches", () => {
  beforeEach(() => { resetNichesForTests(); process.env.BLUEPRINT_BASE_URL = "https://es.example/blueprint/"; });

  it("all 60 comment words, each with a slug and a label", () => {
    expect(allNicheWords()).toHaveLength(60);
    expect(nicheFor("roofing")).toMatchObject({ word: "ROOFING", slug: "roofing" });
    expect(nicheFor("REALTOR")?.slug).toBe("real-estate");
    expect(nicheFor("NOPE")).toBeNull();
    expect(nicheFor(null)).toBeNull();
  });

  it("the blueprint link is the base plus the slug", () => {
    expect(blueprintUrl(nicheFor("CONSULTANT")!)).toBe("https://es.example/blueprint/consultants");
    delete process.env.BLUEPRINT_BASE_URL;
    expect(() => blueprintUrl(nicheFor("CONSULTANT")!)).toThrow(/BLUEPRINT_BASE_URL/);
  });
});

describe("es-funnel: MailerLite", () => {
  beforeEach(() => { process.env.MAILERLITE_API_KEY = "k_test"; process.env.MAILERLITE_GROUP_ID = "g1"; });

  it("one upsert into the group with the first name and the niche", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    await upsertSubscriber({ email: "ann@example.com", firstName: "Ann", niche: "roofing" }, f);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://connect.mailerlite.com/api/subscribers");
    expect(init.headers.Authorization).toBe("Bearer k_test");
    expect(JSON.parse(init.body)).toEqual({ email: "ann@example.com", fields: { niche: "roofing", name: "Ann" }, groups: ["g1"] });
  });

  it("a refusal says the status only (never the address); 422 isn't retried, 429 and 5xx are", async () => {
    for (const [status, retryable] of [[422, false], [429, true], [503, true]] as const) {
      const err = await upsertSubscriber({ email: "ann@example.com", firstName: null, niche: "x" }, vi.fn().mockResolvedValue(new Response("{}", { status }))).catch((e) => e);
      expect(err).toBeInstanceOf(MailerLiteError);
      expect(err.retryable).toBe(retryable);
      expect(String(err.message)).not.toContain("ann@");
    }
  });

  it("no key or group: refuses before any call", async () => {
    delete process.env.MAILERLITE_API_KEY;
    const f = vi.fn();
    await expect(upsertSubscriber({ email: "a@b.co", firstName: null, niche: "x" }, f)).rejects.toThrow(/MAILERLITE_API_KEY/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("es-funnel: the lead step", () => {
  const account = { id: "acc_1", instagramId: "ig_1", workspaceId: "ws_1", provider: "META", accessToken: "enc" };
  const lead = (over: Record<string, unknown> = {}) => ({ id: "lead_1", workspaceId: "ws_1", automationId: "auto_1", instagramAccountId: "acc_1", igUserId: "u_1", keyword: "ROOFING", state: "ASKED", askedAt: new Date(), ...over });
  const job = (text: string) => ({ instagramAccountId: "ig_1", messageId: "mid_1", messageText: text, senderId: "u_1" });
  let deps: LeadDeps & { send: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn>; reserve: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; requeue: ReturnType<typeof vi.fn> };
  const states = () => mockPrisma.lead.update.mock.calls.map((c) => c[0].data.state);
  const logged = () => JSON.stringify(mockPrisma.dmLog.upsert.mock.calls);

  beforeEach(() => {
    vi.clearAllMocks(); resetNichesForTests();
    process.env.BLUEPRINT_BASE_URL = "https://es.example/blueprint";
    delete process.env.LEAD_BLUEPRINT_MESSAGE; delete process.env.LEAD_REASK_MESSAGE;
    mockPrisma.instagramAccount.findFirst.mockResolvedValue(account);
    mockPrisma.lead.findUnique.mockResolvedValue(lead());
    mockCreateContext.mockResolvedValue({ provider: "META", accessToken: "tok" });
    deps = {
      send: vi.fn().mockResolvedValue({}), upsert: vi.fn().mockResolvedValue(undefined),
      reserve: vi.fn().mockResolvedValue({ allowed: true, reserved: true, shouldRequeue: false, requeueDelayMs: 0 }),
      release: vi.fn(), requeue: vi.fn(), now: () => new Date(),
    } as never;
  });

  it("the steps: email → sync, none → re-ask once then stop, synced → send, done → not ours", () => {
    const withEmail = { email: "a@b.co", firstName: null }, none = { email: null, firstName: "Ann" };
    expect(nextLeadStep("ASKED", withEmail)).toBe("sync");
    expect(nextLeadStep("REASKED", withEmail)).toBe("sync");
    expect(nextLeadStep("ASKED", none)).toBe("reask");
    expect(nextLeadStep("REASKED", none)).toBe("stop");
    expect(nextLeadStep("SYNCED", none)).toBe("send");
    expect(nextLeadStep("DONE", withEmail)).toBe("ignore");
    expect(nextLeadStep("STOPPED", withEmail)).toBe("ignore");
  });

  it("name + email: into MailerLite with the niche, then the niche's blueprint link; logged without the address", async () => {
    expect(await handleLeadMessage(job("Ann ann@example.com"), deps)).toBe(true);
    expect(deps.upsert).toHaveBeenCalledWith({ email: "ann@example.com", firstName: "Ann", niche: "roofing" });
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ userId: "u_1", message: expect.stringContaining("https://es.example/blueprint/roofing") }));
    expect(deps.send.mock.calls[0][0].message).toContain("Ann");
    expect(states()).toEqual(["SYNCED", "DONE"]);
    expect(logged()).toContain('"status":"SENT"');
    expect(logged()).not.toContain("ann@example.com");
  });

  it("the texts come from the environment when set (her approved words)", async () => {
    process.env.LEAD_BLUEPRINT_MESSAGE = "Here you go {name}: {link}";
    await handleLeadMessage(job("Ann ann@example.com"), deps);
    expect(deps.send.mock.calls[0][0].message).toBe("Here you go Ann: https://es.example/blueprint/roofing");
  });

  it("no email: one re-ask, then nothing more", async () => {
    await handleLeadMessage(job("Ann"), deps);
    expect(deps.upsert).not.toHaveBeenCalled();
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(states()).toEqual(["REASKED"]);
    vi.clearAllMocks(); mockPrisma.instagramAccount.findFirst.mockResolvedValue(account); mockPrisma.lead.findUnique.mockResolvedValue(lead({ state: "REASKED" }));
    expect(await handleLeadMessage(job("still no"), deps)).toBe(true);
    expect(deps.send).not.toHaveBeenCalled();
    expect(states()).toEqual(["STOPPED"]);
  });

  it("MailerLite down: nothing sent, the slot given back, the job retried; the retry of a synced lead only sends", async () => {
    deps.upsert.mockRejectedValue(new MailerLiteError(503, true));
    await expect(handleLeadMessage(job("Ann ann@example.com"), deps)).rejects.toThrow(/503/);
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.release).toHaveBeenCalled();
    vi.clearAllMocks(); mockPrisma.instagramAccount.findFirst.mockResolvedValue(account); mockPrisma.lead.findUnique.mockResolvedValue(lead({ state: "SYNCED" }));
    await handleLeadMessage(job("Ann ann@example.com"), deps);
    expect(deps.upsert).not.toHaveBeenCalled();
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it("MailerLite refuses the address: asks again the first time, stops the second", async () => {
    deps.upsert.mockRejectedValue(new MailerLiteError(422, false));
    await handleLeadMessage(job("Ann ann@bad"), deps); // not an address: parsed as no email → re-ask
    await handleLeadMessage(job("Ann ann@example.com"), deps);
    expect(states()).toEqual(["REASKED", "REASKED"]);
    vi.clearAllMocks(); mockPrisma.instagramAccount.findFirst.mockResolvedValue(account); mockPrisma.lead.findUnique.mockResolvedValue(lead({ state: "REASKED" }));
    await handleLeadMessage(job("Ann ann@example.com"), deps);
    expect(deps.send).not.toHaveBeenCalled();
    expect(states()).toEqual(["STOPPED"]);
  });

  it("over the hourly cap: nothing sent, requeued, logged", async () => {
    deps.reserve.mockResolvedValue({ allowed: false, reserved: false, shouldRequeue: true, requeueDelayMs: 1800000 });
    expect(await handleLeadMessage(job("Ann ann@example.com"), deps)).toBe(true);
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.upsert).not.toHaveBeenCalled();
    expect(deps.requeue).toHaveBeenCalledWith(expect.objectContaining({ messageId: "mid_1" }), 1800000);
    expect(logged()).toContain("SKIPPED_RATE_LIMIT");
  });

  it("not ours: no open lead, a finished one, or an ask over a week old → the keyword triggers get it", async () => {
    mockPrisma.lead.findUnique.mockResolvedValue(null);
    expect(await handleLeadMessage(job("LINK"), deps)).toBe(false);
    mockPrisma.lead.findUnique.mockResolvedValue(lead({ state: "DONE" }));
    expect(await handleLeadMessage(job("a@b.co"), deps)).toBe(false);
    mockPrisma.lead.findUnique.mockResolvedValue(lead({ askedAt: new Date(Date.now() - LEAD_TTL_MS - 1000) }));
    expect(await handleLeadMessage(job("a@b.co"), deps)).toBe(false);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("a lead opens only for a word with a niche; a new comment restarts it", async () => {
    expect(await openLead({ workspaceId: "ws_1", automationId: "auto_1", instagramAccountId: "acc_1", igUserId: "u_1", keyword: "NOPE" })).toBeNull();
    expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
    await openLead({ workspaceId: "ws_1", automationId: "auto_1", instagramAccountId: "acc_1", igUserId: "u_1", keyword: "roofing" });
    expect(mockPrisma.lead.upsert.mock.calls[0][0].update).toMatchObject({ state: "ASKED", keyword: "ROOFING", syncedAt: null });
  });
});
