import { expect } from "bun:test";

import { captureTestProcess } from "@ryot-app/testing/process";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { testFileDatabaseEnvironment } from "#testing/database";

it.live.each([1_000, 5_000])(
	"exports and restores backup data with %i entities below the fixed memory limit",
	(count) =>
		Effect.gen(function* () {
			const result = yield* captureTestProcess({
				env: yield* testFileDatabaseEnvironment,
				args: [
					Bun.fileURLToPath(new URL("./streaming-memory.workload.ts", import.meta.url)),
					String(count),
				],
			});
			expect(result.exitCode, result.output).toBe(0);
		}),
	600_000,
);
