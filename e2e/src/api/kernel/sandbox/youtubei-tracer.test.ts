import { Effect } from "effect";

import {
	createAuthenticatedClient,
	deleteSandboxReplayProjection,
	enqueueSandboxScript,
	installTestPluginBundle,
	pollSandboxResult,
	pollUntil,
	requireCompletedSandboxValue,
	sampleOperationalPressure,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { requireArray, requireNumber } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

const youtubeiSource = (input: { readonly name: string; readonly slug: string }) => `
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { createYoutubeMusicClient } from "@ryot-app/sandbox-sdk/youtubei";

export const manifest = defineManifest({
  kind: "script",
  capabilities: ["httpCall"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineScript({
  manifest,
  output: Schema.Array(Schema.Number),
  input: Schema.Struct({ firstUrl: Schema.String, secondUrl: Schema.String }),
  run: (input, host) => Effect.gen(function* () {
    const clientHost: SandboxHost<readonly ["httpCall"]> = {
      httpCall: (method, url, options) => host.httpCall(
        method,
					new URL(url, "https://www.youtube.com").pathname.includes("/first")
          ? input.firstUrl
          : input.secondUrl,
        options,
      ),
    };
    const client = yield* createYoutubeMusicClient(clientHost, undefined, {
      retrievePlayer: false,
      retrieveInnertubeConfig: false,
    });
			const first = yield* Effect.tryPromise(() => client.actions.execute("/first", { value: 1 })).pipe(
				Effect.catch(() => Effect.succeed({ status_code: 599 })),
			);
    const second = yield* Effect.tryPromise(() => client.actions.execute("/second", { value: 2 }));
    return [first.status_code, second.status_code];
  }),
});
`;

describe("Youtubei durable tracer", () => {
	it.live("replays sequential internal fetches without repeating completed HTTP", () =>
		Effect.gen(function* () {
			let releaseSecondRequest!: () => void;
			const secondRequestReleased = new Promise<void>((resolve) => {
				releaseSecondRequest = resolve;
			});
			const http = yield* startFakeHttpServerScoped(async (url) => {
				if (url.pathname === "/second") {
					await secondRequestReleased;
				}
				return Response.json({ ok: true });
			});
			yield* Effect.addFinalizer(() => Effect.sync(releaseSecondRequest));
			const scriptSlug = `youtubei-tracer-${crypto.randomUUID()}`;
			const entry = "backend/scripts/youtubei-tracer.sandbox.ts";
			const plugin = yield* Effect.acquireRelease(
				installTestPluginBundle({
					scope: "system",
					pluginSlug: `e2e-youtubei-tracer-${crypto.randomUUID()}`,
					files: { [entry]: youtubeiSource({ slug: scriptSlug, name: "Youtubei tracer" }) },
					httpRateLimits: [
						{
							requests: 1,
							intervalMs: 1_000,
							origins: [new URL(http.url).origin],
							key: `e2e.youtubei-tracer.${crypto.randomUUID()}`,
						},
					],
					scripts: [
						{
							entry,
							kind: "script",
							slug: scriptSlug,
							name: "Youtubei tracer",
							capabilities: ["httpCall"],
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
						},
					],
				}),
				uninstallTestPlugin,
			);
			const { userId } = yield* createAuthenticatedClient();
			const { jobId, executionId } = yield* enqueueSandboxScript(userId, {
				scriptId: plugin.scriptIds[scriptSlug] ?? plugin.scriptId,
				context: { firstUrl: `${http.url}/first`, secondUrl: `${http.url}/second` },
			});

			yield* pollUntil(
				"Youtubei tracer first durable request",
				sampleOperationalPressure([executionId]).pipe(
					Effect.map((pressure) => (pressure.redis.maxHighWater >= 1 ? true : null)),
				),
			);
			expect((yield* deleteSandboxReplayProjection(executionId)).deleted).toBe(true);
			yield* Effect.sync(releaseSecondRequest);

			const value = requireArray(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId), "Youtubei tracer"),
				"Youtubei tracer output must be an array",
			);
			expect(value.map((status) => requireNumber(status, "Youtubei status"))).toEqual([200, 200]);
			expect(http.requests.map(({ path }) => path)).toEqual(["/first", "/second"]);
		}),
	);
});
