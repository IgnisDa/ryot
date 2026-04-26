import { Effect } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	installSandboxScriptScoped,
	observabilitySandboxSource,
	pollSandboxResult,
} from "~/fixtures";
import { assertCompleted, assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox result observability", () => {
	it.live("completed result includes host observability logs and timing", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `observability-check-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Observability check",
				capabilities: ["log", "span"],
				source: observabilitySandboxSource({ name: "Observability check", slug }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "sandbox job");

			expect(result.error).toBeNull();
			expect(result.value).toBe(true);
			expect(result.logs).toEqual([
				"console before batch",
				"[warn] console warning",
				'{"attributes":{"nested":{"a":"value","z":1},"scriptId":"attempted-override"},"kind":"log","level":"info","message":"batch started"}',
				'{"attributes":{"items":[{"a":true,"b":2},"done"]},"kind":"log","level":"warning","message":"batch continuing"}',
				'{"attributes":{"executionId":"attempted-override","nested":{"a":{"c":3,"d":4},"z":false}},"kind":"span","name":"provider.batch"}',
				'{"kind":"span","name":"provider.complete"}',
			]);
			assertPresent(result.timing, "Expected timing to be present");
			expect(result.timing.totalMs).toBeGreaterThan(0);
			expect(result.timing.executionMs).toBeGreaterThanOrEqual(0);
		}),
	);
});
