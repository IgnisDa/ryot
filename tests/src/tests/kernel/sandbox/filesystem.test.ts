import { Effect } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	installSandboxScriptScoped,
	pollSandboxResult,
	scratchEntryLimitSandboxSource,
} from "~/fixtures";
import { assertCompleted } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox filesystem grants", () => {
	it.live("fails bounded retries when scratch entry count exceeds kernel limits", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `scratch-entry-limit-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				capabilities: ["scratch"],
				name: "Scratch entry limit",
				source: scratchEntryLimitSandboxSource({
					slug,
					chunkCount: 4_097,
					name: "Scratch entry limit",
				}),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const result = yield* pollSandboxResult(userId, jobId);

			expect(result.status).toBe("failed");
			expect(result.error).toContain("Sandbox scratch directory exceeds 4096 entries");
		}),
	);

	it.live("does not expose harvested storage metadata in public sandbox results", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `scratch-result-boundary-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				capabilities: ["scratch"],
				name: "Scratch result boundary",
				source: scratchEntryLimitSandboxSource({
					slug,
					chunkCount: 1,
					name: "Scratch result boundary",
				}),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });
			const result = yield* pollSandboxResult(userId, jobId);

			assertCompleted(result, "scratch result boundary");
			expect(result.value).toEqual({ chunkFiles: ["chunk-0.json"] });
			expect(result).not.toHaveProperty("harvest");
		}),
	);
});
