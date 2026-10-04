import { Effect, FileSystem } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	httpCallFailureSandboxSource,
	installSandboxScriptScoped,
	pollSandboxResult,
	requireCompletedSandboxValue,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

const runHttpCall = (url: string) =>
	Effect.gen(function* () {
		const { client, userId } = yield* createAuthenticatedClient();
		const slug = `egress-scheme-${crypto.randomUUID()}`;
		const { scriptId } = yield* installSandboxScriptScoped({
			slug,
			client,
			name: "egress-scheme",
			capabilities: ["httpCall"],
			source: httpCallFailureSandboxSource({ url, slug, name: "egress-scheme" }),
		});
		const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, lane: "interactive" });
		return requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId));
	});

describe("sandbox httpCall egress schemes", () => {
	it.live("denies file: URLs on the host", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const marker = `egress-file-${crypto.randomUUID()}`;
			const path = yield* fs.makeTempFileScoped();
			yield* fs.writeFileString(path, marker);

			expect(yield* runHttpCall(`file://${path}`)).toMatchObject({
				success: false,
				data: { code: "destination-denied" },
			});
		}),
	);

	it.live("denies data: URLs", () =>
		Effect.gen(function* () {
			const marker = `egress-data-${crypto.randomUUID()}`;

			expect(yield* runHttpCall(`data:text/plain,${marker}`)).toMatchObject({
				success: false,
				data: { code: "destination-denied" },
			});
		}),
	);
});
