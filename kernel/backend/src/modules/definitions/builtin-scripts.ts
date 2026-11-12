import type { PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import { kernelNotificationHookSlug } from "@ryot-app/definitions/kernel-definitions";

import { manifest as notificationManifest } from "./kernel-scripts/notification.sandbox";

export const kernelNotificationHook = {
	stage: "after",
	delivery: "async",
	name: "Signal Notification",
	slug: kernelNotificationHookSlug,
	scriptSlug: notificationManifest.slug,
	targets: ["integration.disabled", "reminder.due"].map((signalSchemaSlug) => ({
		signalSchemaSlug,
		operation: "emit",
		resource: "signal",
	})),
} as const satisfies PluginHook;

export const kernelScripts = [
	{
		...notificationManifest,
		entry: "src/modules/definitions/kernel-scripts/notification.sandbox.ts",
	},
] as const;
