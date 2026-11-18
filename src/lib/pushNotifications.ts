import { sendNotification, setVapidDetails } from "web-push";
import { prisma } from "@/lib/prisma";

type PushPayload = {
  title: string;
  body: string;
  url: string;
};

function getVapidConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    return { configured: false as const };
  }

  return { configured: true as const, publicKey, privateKey, subject };
}

export function getPushPublicConfiguration() {
  const configuration = getVapidConfiguration();
  return configuration.configured
    ? { publicKey: configuration.publicKey, configured: true }
    : { publicKey: null, configured: false };
}

export async function sendPushNotification(
  userId: number,
  notification: { title: string }
) {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (subscriptions.length === 0) return;

  const configuration = getVapidConfiguration();
  if (!configuration.configured) {
    console.warn("Push delivery skipped: VAPID environment variables are not configured.");
    return;
  }

  setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey);

  const payload: PushPayload = {
    title: notification.title,
    body: "You have a new update. Open Way Point to view it.",
    url: "/",
  };

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload)
        );
      } catch (error) {
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error
            ? error.statusCode
            : undefined;

        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: subscription.id } });
          return;
        }

        console.error("Push notification delivery failed:", error);
      }
    })
  );
}
