import { prisma } from "@/lib/prisma";
import { sendPushNotification } from "@/lib/pushNotifications";

// Notifications are best-effort, same reasoning as activity logging: never let
// a notification failure break the mutation that triggered it.
export async function createNotification(params: {
  userId: number;
  type: string;
  title: string;
  message: string;
  link?: string;
}) {
  let notification;
  try {
    notification = await prisma.notification.create({ data: params });
  } catch (err) {
    console.error("Failed to create notification:", err);
    return;
  }

  try {
    await sendPushNotification(params.userId, { title: notification.title });
  } catch (err) {
    console.error("Failed to send push notification:", err);
  }
}

// Overdue tasks are checked both when a user fetches notifications and through
// the scheduled endpoint. The link includes the task so separate overdue tasks
// for the same client are not mistaken for duplicates.
export async function notifyOverdueTasksForUser(userId: number) {
  const overdueTasks = await prisma.task.findMany({
    where: {
      assigneeId: userId,
      status: { not: "DONE" },
      dueDate: { lt: new Date() },
    },
    select: { id: true, title: true, dueDate: true, clientId: true },
  });

  for (const task of overdueTasks) {
    const link = `clients:${task.clientId}:task:${task.id}`;

    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type: "TASK_OVERDUE",
        link,
        createdAt: { gte: task.dueDate! },
      },
    });

    if (!existing) {
      await createNotification({
        userId,
        type: "TASK_OVERDUE",
        title: "Task overdue",
        message: `"${task.title}" was due on ${task.dueDate!.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`,
        link,
      });
    }
  }
}

export async function notifyOverdueTasksForAllUsers() {
  const assignees = await prisma.task.findMany({
    where: {
      assigneeId: { not: null },
      status: { not: "DONE" },
      dueDate: { lt: new Date() },
    },
    select: { assigneeId: true },
    distinct: ["assigneeId"],
  });

  for (const { assigneeId } of assignees) {
    if (assigneeId !== null) await notifyOverdueTasksForUser(assigneeId);
  }

  return assignees.length;
}
