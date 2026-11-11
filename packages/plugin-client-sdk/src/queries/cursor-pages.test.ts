import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { readCursorPages } from "./cursor-pages";

const page = (items: readonly number[], nextCursor: null | string) => ({
	items,
	pageInfo: { nextCursor, hasMore: nextCursor !== null },
});

it.effect(
	"reads every page and passes each cursor to the next read",
	() =>
		Effect.gen(function* () {
			const requests: (string | undefined)[] = [];
			const result = yield* readCursorPages((after) =>
				Effect.sync(() => {
					requests.push(after);
					return after === undefined
						? page(
								Array.from({ length: 100 }, (_, index) => index),
								"next-page",
							)
						: page([100], null);
				}),
			);
			expect(requests).toEqual([undefined, "next-page"]);
			expect(result.hasMore).toBe(false);
			expect(result.items).toEqual(Array.from({ length: 101 }, (_, index) => index));
		}),
	testTimeout,
);

it.effect(
	"stops at maxPages and reports remaining rows",
	() =>
		Effect.gen(function* () {
			const requests: (string | undefined)[] = [];
			const result = yield* readCursorPages(
				(after) =>
					Effect.sync(() => {
						requests.push(after);
						return page([requests.length], `cursor-${requests.length}`);
					}),
				{ maxPages: 2 },
			);
			expect(requests).toEqual([undefined, "cursor-1"]);
			expect(result).toEqual({ items: [1, 2], hasMore: true });
		}),
	testTimeout,
);

it.effect(
	"fails repeated or missing cursors instead of looping",
	() =>
		Effect.gen(function* () {
			const requests: (string | undefined)[] = [];
			const repeated = yield* readCursorPages((after) =>
				Effect.sync(() => {
					requests.push(after);
					return page([requests.length], "repeated");
				}),
			).pipe(Effect.flip);
			expect(repeated.reason).toBe("malformed-result");
			expect(requests).toEqual([undefined, "repeated"]);
			const missing = yield* readCursorPages(() =>
				Effect.succeed({ items: [1], pageInfo: { hasMore: true, nextCursor: null } }),
			).pipe(Effect.flip);
			expect(missing.reason).toBe("malformed-result");
		}),
	testTimeout,
);

it.effect(
	"rejects stale and changed revisions before returning a selection",
	() =>
		Effect.gen(function* () {
			for (const stale of [false, true]) {
				const result = yield* readCursorPages((after) =>
					Effect.succeed({
						...page([after === undefined ? 1 : 2], after === undefined ? "next" : null),
						pageInfo: {
							hasMore: after === undefined,
							stale: after !== undefined && stale,
							nextCursor: after === undefined ? "next" : null,
							sourceRevisions: { source: after === undefined ? 1 : 2 },
						},
					}),
				).pipe(Effect.flip);
				expect(result.reason).toBe("malformed-result");
			}
			const initial = yield* readCursorPages(() =>
				Effect.succeed({
					...page([], null),
					pageInfo: { stale: true, hasMore: false, nextCursor: null },
				}),
			).pipe(Effect.flip);
			expect(initial.reason).toBe("malformed-result");
		}),
	testTimeout,
);
