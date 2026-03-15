import { Effect } from "effect";

import type { TestPluginScript } from "~/fixtures";
import {
	adminHeaders,
	getBackendClient,
	installTestPluginBundle,
	uninstallTestPlugin,
	userPreferencesSandboxSource,
} from "~/fixtures";
import { assert, describe, expect, it } from "~/support/effect-test";

describe("sandbox capability authorization", () => {
	it.live("denies user-only host functions to system cron scripts", () =>
		Effect.gen(function* () {
			const scriptSlug = `system-denied-${crypto.randomUUID()}`;
			const installed = yield* Effect.acquireRelease(
				installTestPluginBundle({
					files: {
						"scripts/denied.sandbox.ts": userPreferencesSandboxSource({
							slug: scriptSlug,
							name: "System denied capability",
						}),
					},
					scripts: [
						{
							kind: "script",
							slug: scriptSlug,
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							name: "System denied capability",
							entry: "scripts/denied.sandbox.ts",
							capabilities: ["getUserPreferences"],
						} satisfies TestPluginScript & { entry: string },
					],
					crons: [
						{
							scriptSlug,
							lot: "script",
							schedule: { cron: "0 0 * * *" },
							slug: "system-denied-capability",
							description: "Verifies system capability denial",
						},
					],
				}),
				uninstallTestPlugin,
			);

			const result = yield* getBackendClient().call(
				(c) =>
					c.testSupport.triggerPluginCron({
						payload: { pluginSlug: installed.pluginSlug, cronSlug: "system-denied-capability" },
					}),
				adminHeaders,
			);

			assert(result.status === "executed", "Expected denied capability cron to execute");
			expect(result.result).toMatchObject({
				status: "completed",
				error: { phase: "execute", message: expect.stringContaining("getUserPreferences") },
			});
		}),
	);
});
