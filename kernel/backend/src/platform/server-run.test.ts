import { describe, expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { ServerRun } from "./server-run";

describe("ServerRun", () => {
	layer(ServerRun.layer)((test) => {
		test.effect(
			"keeps one run id stable for the service lifetime",
			() =>
				Effect.gen(function* () {
					const first = yield* ServerRun;
					const second = yield* ServerRun;
					expect(first.id).toBe(second.id);
				}),
			testTimeout,
		);
	});
});
