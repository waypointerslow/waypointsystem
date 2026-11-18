"use client";

import { useEffect, useState } from "react";

type PushState =
  | "loading"
  | "enabled"
  | "disabled"
  | "blocked"
  | "unsupported"
  | "unavailable"
  | "unconfigured"
  | "error";

function applicationServerKeyToBytes(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return bytes;
}

export function PushNotificationControl() {
  const [state, setState] = useState<PushState>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadPushState() {
      if (process.env.NODE_ENV !== "production") {
        setState("unavailable");
        return;
      }

      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported");
        return;
      }

      try {
        const response = await fetch("/api/push-subscriptions");
        const configuration = await response.json();
        if (!response.ok) throw new Error(configuration.error || "Could not load push settings");
        if (!active) return;

        if (!configuration.configured || !configuration.publicKey) {
          setState("unconfigured");
          return;
        }

        setPublicKey(configuration.publicKey);
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!active) return;

        if (subscription) {
          const saveResponse = await fetch("/api/push-subscriptions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(subscription),
          });
          if (!saveResponse.ok) throw new Error("Could not sync this device's push subscription");
          setState("enabled");
        } else if (Notification.permission === "denied") {
          setState("blocked");
        } else {
          setState("disabled");
        }
      } catch (error) {
        console.error("Load push notification settings error:", error);
        if (active) setState("error");
      }
    }

    void loadPushState();
    return () => {
      active = false;
    };
  }, []);

  const toggleSubscription = async () => {
    if (busy) return;
    setBusy(true);

    try {
      if (state === "enabled") {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          setState("disabled");
          return;
        }
        const endpoint = subscription.endpoint;
        const unsubscribed = await subscription.unsubscribe();
        if (!unsubscribed) throw new Error("The browser could not disable push notifications");

        const response = await fetch("/api/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
        if (!response.ok) throw new Error("Could not remove this device from push notifications");
        setState("disabled");
        return;
      }

      if (!publicKey) throw new Error("Push notifications are not configured");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "disabled");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const newSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKeyToBytes(publicKey),
      });
      const response = await fetch("/api/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSubscription),
      });
      if (!response.ok) {
        await newSubscription.unsubscribe();
        throw new Error("Could not save this device's push subscription");
      }

      setState("enabled");
    } catch (error) {
      console.error("Update push notification settings error:", error);
      setState("error");
    } finally {
      setBusy(false);
    }
  };

  const message: Record<PushState, string> = {
    loading: "Loading push settings…",
    enabled: "Push notifications are on for this device.",
    disabled: "Push notifications are off for this device.",
    blocked: "Notifications are blocked in your browser settings.",
    unsupported: "This browser does not support push notifications.",
    unavailable: "Push notifications are available in the deployed app.",
    unconfigured: "Push notifications are not configured on the server.",
    error: "Could not update push settings. Please try again.",
  };

  const isToggleAvailable = state === "enabled" || state === "disabled";

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-foreground">Browser push</p>
        <p className="text-[10px] text-muted-foreground" role="status">{message[state]}</p>
      </div>
      {isToggleAvailable && (
        <button
          type="button"
          onClick={toggleSubscription}
          disabled={busy}
          aria-label={state === "enabled" ? "Disable push notifications" : "Enable push notifications"}
          className="shrink-0 rounded-lg bg-primary/10 px-3 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
        >
          {busy ? "Saving…" : state === "enabled" ? "Turn off" : "Turn on"}
        </button>
      )}
    </div>
  );
}
