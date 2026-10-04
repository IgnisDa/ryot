import { expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";

import { loadAllPages } from "./load-all-pages";

it.effect("fails a repeated continuation instead of looping through the same page", () =>
	Effect.gen(function* () {
		const requests: Array<string | undefined> = [];
		const result = yield* Effect.result(
			loadAllPages((after) =>
				Effect.sync(() => {
					requests.push(after);
					return { items: [requests.length], pageInfo: { hasMore: true, nextCursor: "repeated" } };
				}),
			),
		);
		expect(Result.isFailure(result)).toBe(true);
		expect(requests).toEqual([undefined, "repeated"]);
	}),
);
