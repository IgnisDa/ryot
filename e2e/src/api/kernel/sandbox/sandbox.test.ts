import { Effect } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	installSandboxScriptScoped,
	observabilitySandboxSource,
	processFailureSandboxSource,
	pollSandboxResult,
} from "~/fixtures/kernel";
import { assertCompleted, assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox result observability", () => {
	it.live("completed result includes host observability logs and timing", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const slug = `observability-check-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				client,
				name: "Observability check",
				capabilities: ["log", "span"],
				source: observabilitySandboxSource({ slug, name: "Observability check" }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, lane: "interactive" });

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

describe("sandbox native failures", () => {
	it.live("returns a structured script failure with bounded UTF-8 diagnostics", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const slug = `process-failure-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				client,
				name: "Process failure",
				source: processFailureSandboxSource({ slug, name: "Process failure" }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, lane: "interactive" });

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "sandbox job");
			assertPresent(result.error, "Expected a structured sandbox failure");
			expect(result.value).toBeNull();
			expect(result.error.kind).toBe("script-failure");
			expect(result.error.phase).toBe("execute");
			expect(result.error.message).toMatch(/^native sandbox failure: 診断/);
			expect(result.error.message).not.toContain(":diagnostic-end");
			expect(result.error.message).not.toContain("\uFFFD");
			const encoder = new TextEncoder();
			expect(encoder.encode(result.error.message).byteLength).toBeLessThanOrEqual(32 * 1024);
			expect(encoder.encode(result.error.message).byteLength).toBeGreaterThan(31 * 1024);
			assertPresent(result.error.stack, "Expected authored diagnostic frames");
			expect(encoder.encode(result.error.stack).byteLength).toBeLessThanOrEqual(32 * 1024);
			expect(result.logs).toEqual(["before sandbox failure"]);
			assertPresent(result.timing, "Expected failure timing to be present");
			expect(result.timing.totalMs).toBeGreaterThan(0);
			expect(result.timing.executionMs).toBeGreaterThanOrEqual(0);
		}),
	);
});
