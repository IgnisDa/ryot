import { anyOf, stringContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	installSandboxScriptScoped,
	pollSandboxResult,
	scratchEntryLimitSandboxSource,
} from "~/fixtures/kernel";
import { assertCompleted } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox filesystem grants", () => {
	it.live("rejects scratch entry overflow at the host-call budget", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const slug = `scratch-entry-limit-${yield* randomUuid}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				client,
				capabilities: ["scratch"],
				name: "Scratch entry limit",
				source: scratchEntryLimitSandboxSource({
					slug,
					chunkCount: 4_097,
					name: "Scratch entry limit",
				}),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, lane: "interactive" });

			const result = yield* pollSandboxResult(userId, jobId);

			assertCompleted(result, "scratch entry limit");
			expect(result.value).toBeNull();
			expect(result.error).toMatchObject({
				phase: "execute",
				message: stringContaining("Sandbox execution exceeds 1000 host calls"),
			});
		}),
	);

	it.live("does not expose harvested storage metadata in public sandbox results", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const slug = `scratch-result-boundary-${yield* randomUuid}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				client,
				capabilities: ["scratch"],
				name: "Scratch result boundary",
				source: scratchEntryLimitSandboxSource({
					slug,
					chunkCount: 1,
					name: "Scratch result boundary",
				}),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, lane: "interactive" });
			const result = yield* pollSandboxResult(userId, jobId);

			assertCompleted(result, "scratch result boundary");
			expect(result.value).toEqual({ chunkHandles: [anyOf(String)] });
			expect(result).not.toHaveProperty("harvest");
		}),
	);
});
