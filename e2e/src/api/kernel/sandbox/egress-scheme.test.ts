import { randomUuid } from "@ryot-app/testing/random";
import { Effect, FileSystem } from "effect";

import { runSandboxHttpCall } from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox httpCall egress schemes", () => {
	it.live("denies file: URLs on the host", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const marker = `egress-file-${yield* randomUuid}`;
			const path = yield* fs.makeTempFileScoped();
			yield* fs.writeFileString(path, marker);

			expect(yield* runSandboxHttpCall("egress-scheme", `file://${path}`)).toMatchObject({
				success: false,
				data: { code: "destination-denied" },
			});
		}),
	);

	it.live("denies data: URLs", () =>
		Effect.gen(function* () {
			const marker = `egress-data-${yield* randomUuid}`;

			expect(yield* runSandboxHttpCall("egress-scheme", `data:text/plain,${marker}`)).toMatchObject(
				{ success: false, data: { code: "destination-denied" } },
			);
		}),
	);
});
