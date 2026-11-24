import { manifest as notificationManifest } from "./kernel-scripts/notification.sandbox";

export const kernelScripts = [
	{ ...notificationManifest, entry: "notification.sandbox.ts" },
] as const;
