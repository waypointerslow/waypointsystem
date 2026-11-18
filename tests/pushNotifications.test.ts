import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findSubscriptions: vi.fn(),
  deleteSubscription: vi.fn(),
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: {
      findMany: mocks.findSubscriptions,
      delete: mocks.deleteSubscription,
    },
  },
}));

vi.mock("web-push", () => ({
  setVapidDetails: mocks.setVapidDetails,
  sendNotification: mocks.sendNotification,
}));

import { getPushPublicConfiguration, sendPushNotification } from "@/lib/pushNotifications";

describe("push notification delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:admin@example.com");
    mocks.findSubscriptions.mockResolvedValue([
      { id: 12, endpoint: "https://push.example/subscription", p256dh: "key", auth: "auth" },
    ]);
    mocks.deleteSubscription.mockResolvedValue({});
    mocks.sendNotification.mockResolvedValue({});
  });

  it("only exposes the public key when all VAPID settings are present", () => {
    expect(getPushPublicConfiguration()).toEqual({
      configured: true,
      publicKey: "public-key",
    });

    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(getPushPublicConfiguration()).toEqual({
      configured: false,
      publicKey: null,
    });
  });

  it("sends a generic payload without client-specific details", async () => {
    await sendPushNotification(7, { title: "Application stage changed" });

    expect(mocks.findSubscriptions).toHaveBeenCalledWith({
      where: { userId: 7 },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    expect(mocks.setVapidDetails).toHaveBeenCalledWith(
      "mailto:admin@example.com",
      "public-key",
      "private-key"
    );
    const [subscription, serializedPayload] = mocks.sendNotification.mock.calls[0];
    expect(subscription.endpoint).toBe("https://push.example/subscription");
    expect(JSON.parse(serializedPayload)).toEqual({
      title: "Application stage changed",
      body: "You have a new update. Open Way Point to view it.",
      url: "/",
    });
  });

  it("removes expired browser subscriptions", async () => {
    mocks.sendNotification.mockRejectedValue({ statusCode: 410 });

    await sendPushNotification(7, { title: "New task assigned" });

    expect(mocks.deleteSubscription).toHaveBeenCalledWith({ where: { id: 12 } });
  });
});
