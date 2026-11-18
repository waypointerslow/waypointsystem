import { NextResponse } from "next/server";
import { notifyOverdueTasksForAllUsers } from "@/lib/notifications";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Overdue notification job is not configured" },
      { status: 503 }
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const assigneeCount = await notifyOverdueTasksForAllUsers();
    return NextResponse.json({ success: true, assigneeCount });
  } catch (error) {
    console.error("Overdue notification job failed:", error);
    return NextResponse.json(
      { error: "Failed to process overdue notifications" },
      { status: 500 }
    );
  }
}
