import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPushPublicConfiguration } from "@/lib/pushNotifications";

export async function GET() {
  const currentUser = await getCurrentUserFromCookies();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  return NextResponse.json(getPushPublicConfiguration());
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUserFromCookies();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { configured } = getPushPublicConfiguration();
    if (!configured) {
      return NextResponse.json(
        { error: "Push notifications are not configured on this server" },
        { status: 503 }
      );
    }

    const body: unknown = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    const subscription = body as Record<string, unknown>;
    const keys =
      subscription.keys && typeof subscription.keys === "object"
        ? subscription.keys as Record<string, unknown>
        : {};
    const endpoint = subscription.endpoint;
    const p256dh = keys.p256dh;
    const auth = keys.auth;

    if (
      typeof endpoint !== "string" ||
      endpoint.length > 2048 ||
      typeof p256dh !== "string" ||
      typeof auth !== "string" ||
      !p256dh ||
      !auth ||
      p256dh.length > 256 ||
      auth.length > 256
    ) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    try {
      const endpointUrl = new URL(endpoint);
      const hostname = endpointUrl.hostname.toLowerCase();
      const isPushService =
        hostname === "fcm.googleapis.com" ||
        hostname === "web.push.apple.com" ||
        hostname === "push.services.mozilla.com" ||
        hostname.endsWith(".push.services.mozilla.com") ||
        hostname === "notify.windows.com" ||
        hostname.endsWith(".notify.windows.com");

      if (endpointUrl.protocol !== "https:" || endpointUrl.port || !isPushService) {
        return NextResponse.json({ error: "Invalid subscription endpoint" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid subscription endpoint" }, { status: 400 });
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: currentUser.id, endpoint, p256dh, auth },
      update: { userId: currentUser.id, p256dh, auth },
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Save push subscription error:", error);
    return NextResponse.json(
      { error: "Failed to save push subscription" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUserFromCookies();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body: unknown = await request.json();
    const endpoint =
      body && typeof body === "object" && "endpoint" in body
        ? body.endpoint
        : undefined;

    if (typeof endpoint !== "string" || !endpoint) {
      return NextResponse.json({ error: "Subscription endpoint is required" }, { status: 400 });
    }

    await prisma.pushSubscription.deleteMany({
      where: { userId: currentUser.id, endpoint },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete push subscription error:", error);
    return NextResponse.json(
      { error: "Failed to remove push subscription" },
      { status: 500 }
    );
  }
}
