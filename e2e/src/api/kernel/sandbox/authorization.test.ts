import { Effect } from "effect";

import type { TestPluginScript } from "~/fixtures/kernel";
import {
	adminHeaders,
	getApiClient,
	installTestPluginBundle,
	uninstallTestPlugin,
	userPreferencesSandboxSource,
} from "~/fixtures/kernel";
import { assert, describe, expect, it } from "~/support/effect-test";

describe("sandbox capability authorization", () => {
	it.live("denies user-only host functions to system cron scripts", () =>
		Effect.gen(function* () {
			const scriptSlug = `system-denied-${crypto.randomUUID()}`;
			const installed = yield* Effect.acquireRelease(
				installTestPluginBundle({
					scope: "system",
					files: {
						"backend/scripts/denied.sandbox.ts": userPreferencesSandboxSource({
							slug: scriptSlug,
							name: "System denied capability",
						}),
					},
					crons: [
						{
							scriptSlug,
							schedule: { cron: "0 0 * * *" },
							slug: "system-denied-capability",
							description: "Verifies system capability denial",
						},
					],
					scripts: [
						{
							kind: "script",
							slug: scriptSlug,
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							name: "System denied capability",
							capabilities: ["getUserPreferences"],
							entry: "backend/scripts/denied.sandbox.ts",
						} satisfies TestPluginScript & { entry: string },
					],
				}),
				uninstallTestPlugin,
			);

			const result = yield* getApiClient().call(
				(c) =>
					c.testSupport.triggerPluginCron({
						payload: { pluginSlug: installed.pluginSlug, cronSlug: "system-denied-capability" },
					}),
				adminHeaders(),
			);
			assert(result.status === "failed", "Expected denied capability cron to fail");
			expect(result.result).toMatchObject({
				status: "completed",
				error: { phase: "execute", message: expect.stringContaining("getUserPreferences") },
			});
		}),
	);
});
