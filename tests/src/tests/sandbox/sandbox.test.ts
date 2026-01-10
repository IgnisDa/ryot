import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createSandboxScript,
	enqueueSandboxScript,
	literalSandboxSource,
	pollSandboxResult,
} from "~/fixtures";
import { assertCompleted, assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox result observability", () => {
	it.live("completed result includes timing with totalMs and executionMs", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const slug = `observability-check-${crypto.randomUUID()}`;
			const { id: scriptId } = yield* createSandboxScript(client, {
				source: literalSandboxSource({ name: "Observability check", slug, value: true }),
			});
			const { jobId } = yield* enqueueSandboxScript(client, { scriptId, driverName: "main" });

			const result = yield* pollSandboxResult(client, jobId);
			assertCompleted(result, "sandbox job");

			assertPresent(result.timing, "Expected timing to be present");
			expect(result.timing.totalMs).toBeGreaterThan(0);
			expect(result.timing.executionMs).toBeGreaterThanOrEqual(0);
		}),
	);
});
