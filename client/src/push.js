/**
 * "Deine nächsten Karten sind bereit" on this device (#248).
 *
 * The server decides when (server/src/push.js); this module only holds the
 * device's side: whether it can receive, asking her, and handing the
 * subscription to the server.
 *
 * iOS delivers Web Push only to the app added to the home screen (16.4+), and
 * asks for permission once: a "Nicht erlauben" can only be undone in the iOS
 * settings. So the app never asks out of the blue — only when she taps a
 * button that says what for (the session summary's offer, or Settings).
 */
import { api } from "./api.js";
import { getMeta, setMeta } from "./store.js";

const DECLINED = "push.declined";

/** The server's key, as `pushManager.subscribe` wants it. */
export function keyBytes(base64url) {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Where this device stands, from what the browser reports. Pure, so each case
 * can be tested without one.
 *
 *   unsupported  no Web Push here at all
 *   install      an iPhone or iPad outside the home-screen app
 *   denied       she said no in the system dialog (only iOS settings undo it)
 *   on           permission granted and subscribed
 *   off          permission granted, not subscribed (she switched it off)
 *   declined     she said "Nein, danke" to the app's own offer
 *   ask          never asked
 */
export function pushStateFrom({ hasPush, isApple, standalone, permission, subscribed, declined }) {
  if (!hasPush) return isApple && !standalone ? "install" : "unsupported";
  if (permission === "denied") return "denied";
  if (permission === "granted") return subscribed ? "on" : "off";
  return declined ? "declined" : "ask";
}

function environment() {
  const nav = globalThis.navigator ?? {};
  return {
    hasPush: "PushManager" in globalThis && "serviceWorker" in nav && "Notification" in globalThis,
    isApple: /iPhone|iPad|iPod/.test(nav.userAgent ?? "") || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1),
    standalone: nav.standalone === true || globalThis.matchMedia?.("(display-mode: standalone)").matches === true,
    permission: globalThis.Notification?.permission,
  };
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function pushState() {
  const env = environment();
  let subscribed = false;
  if (env.hasPush && env.permission === "granted") subscribed = Boolean(await currentSubscription().catch(() => null));
  const declined = Boolean(await getMeta(DECLINED).catch(() => false));
  return pushStateFrom({ ...env, subscribed, declined });
}

/**
 * Ask (the system dialog, from her tap), subscribe, tell the server. Resolves
 * to the state afterwards: "on", "denied", or "ask" when she closed the dialog
 * without choosing.
 */
export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "ask";
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api.pushSubscribe(subscription.toJSON());
  await setMeta(DECLINED, false);
  return "on";
}

export async function disablePush() {
  const subscription = await currentSubscription();
  if (subscription) {
    await api.pushUnsubscribe(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe();
  }
  return "off";
}

/** "Nein, danke" on the offer: it is not made again; Settings still can. */
export function declinePush() {
  return setMeta(DECLINED, true);
}

/**
 * On every start: a device that is subscribed tells the server again, so its
 * time zone stays current (quiet hours) and a subscription the browser
 * renewed on its own is not lost. Quiet about failure: offline is ordinary.
 */
export async function refreshPush() {
  const env = environment();
  if (!env.hasPush || env.permission !== "granted") return;
  const subscription = await currentSubscription().catch(() => null);
  if (subscription) await api.pushSubscribe(subscription.toJSON()).catch(() => {});
}
