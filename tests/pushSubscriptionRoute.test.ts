import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  upsertSubscription: vi.fn(),
  deleteSubscriptions: vi.fn(),
  notifyOverdueTasks: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUserFromCookies: mocks.currentUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: {
      upsert: mocks.upsertSubscription,
      deleteMany: mocks.deleteSubscriptions,
    },
  },
}));

vi.mock("@/lib/pushNotifications", () => ({
  getPushPublicConfiguration: () => ({ publicKey: "public-key", configured: true }),
}));

vi.mock("@/lib/notifications", () => ({
  notifyOverdueTasksForAllUsers: mocks.notifyOverdueTasks,
}));

import { DELETE, GET, POST } from "@/app/api/push-subscriptions/route";
import { GET as GETOverdue } from "@/app/api/notifications/overdue/route";

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/device-id",
  keys: { p256dh: "public-key", auth: "auth-key" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: 42 });
  mocks.upsertSubscription.mockResolvedValue({});
  mocks.deleteSubscriptions.mockResolvedValue({ count: 1 });
  mocks.notifyOverdueTasks.mockResolvedValue(3);
});

describe("push subscription API", () => {
  it("only returns push configuration to authenticated users", async () => {
    mocks.currentUser.mockResolvedValueOnce(null);
    const unauthorized = await GET();
    expect(unauthorized.status).toBe(401);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ publicKey: "public-key", configured: true });
  });

  it("saves a valid browser subscription for the signed-in user", async () => {
    const response = await POST(
      new Request("https://waypoint.example/api/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.upsertSubscription).toHaveBeenCalledWith({
      where: { endpoint: subscription.endpoint },
      create: {
        userId: 42,
        endpoint: subscription.endpoint,
        p256dh: "public-key",
        auth: "auth-key",
      },
      update: { userId: 42, p256dh: "public-key", auth: "auth-key" },
    });
  });

  it("rejects arbitrary HTTPS endpoints to prevent server-side requests to untrusted hosts", async () => {
    const response = await POST(
      new Request("https://waypoint.example/api/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...subscription,
          endpoint: "https://internal.example/admin",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.upsertSubscription).not.toHaveBeenCalled();
  });

  it("removes only the signed-in user's matching subscription", async () => {
    const response = await DELETE(
      new Request("https://waypoint.example/api/push-subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteSubscriptions).toHaveBeenCalledWith({
      where: { userId: 42, endpoint: subscription.endpoint },
    });
  });

  it("protects the scheduled overdue check with its configured secret", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const unauthorized = await GETOverdue(
      new Request("https://waypoint.example/api/notifications/overdue")
    );
    expect(unauthorized.status).toBe(401);
    expect(mocks.notifyOverdueTasks).not.toHaveBeenCalled();

    const authorized = await GETOverdue(
      new Request("https://waypoint.example/api/notifications/overdue", {
        headers: { authorization: "Bearer test-secret" },
      })
    );
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ success: true, assigneeCount: 3 });
  });
});
