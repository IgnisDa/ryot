import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ServerRun } from "./server-run";

describe("ServerRun", () => {
	it("keeps one run id stable for the service lifetime", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* ServerRun;
				const second = yield* ServerRun;
				return [first.id, second.id];
			}).pipe(Effect.provide(ServerRun.layer)),
		).then((ids) => expect(ids[0]).toBe(ids[1])));
});
