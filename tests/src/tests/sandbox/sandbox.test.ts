import { Effect } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	installSandboxScriptScoped,
	literalSandboxSource,
	pollSandboxResult,
} from "~/fixtures";
import { assertCompleted, assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox result observability", () => {
	it.scopedLive("completed result includes timing with totalMs and executionMs", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `observability-check-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Observability check",
				source: literalSandboxSource({ name: "Observability check", slug, value: true }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, driverName: "main" });

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "sandbox job");

			assertPresent(result.timing, "Expected timing to be present");
			expect(result.timing.totalMs).toBeGreaterThan(0);
			expect(result.timing.executionMs).toBeGreaterThanOrEqual(0);
		}),
	);
});
