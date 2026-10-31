import { describe, it, expect, vi } from "vitest";

const { mockPrisma, mockAdd } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findMany: vi.fn().mockResolvedValue([{ id: "acc_1", instagramId: "ig_1", workspaceId: "ws_1" }]) },
    webhookEvent: { create: vi.fn().mockResolvedValue({ id: "we_1" }), update: vi.fn().mockResolvedValue({}) },
    dmLog: { findMany: vi.fn().mockResolvedValue([]) },
  },
  mockAdd: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: mockAdd }), MESSAGE_JOB_NAME: "process-message", POSTBACK_JOB_NAME: "process-postback" }));

import { processInstagramWebhook } from "@/lib/queue/process-webhook";

describe("es-funnel: a lead's reply in the webhook", () => {
  it("the worker gets the text as sent; the stored webhook event never holds the email", async () => {
    await processInstagramWebhook({
      provider: "META",
      payload: { object: "instagram", entry: [{ id: "ig_1", time: 1, messaging: [{ sender: { id: "u_1" }, recipient: { id: "ig_1" }, timestamp: 1, message: { mid: "m_1", text: "Ann ann@example.com" } }] }] } as never,
    });
    expect(mockAdd).toHaveBeenCalledWith("process-message", expect.objectContaining({ messageText: "Ann ann@example.com" }), expect.anything());
    const stored = JSON.stringify(mockPrisma.webhookEvent.create.mock.calls[0][0].data.payload);
    expect(stored).not.toContain("ann@example.com");
    expect(stored).toContain("Ann [email]");
  });
});
