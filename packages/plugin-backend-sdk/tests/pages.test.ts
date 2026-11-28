import { describe, expect, it } from "bun:test";

import { continuationCursor, readAllPages } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

const pageOf = (items: number[], nextCursor: null | string) =>
	Effect.succeed({ items, pageInfo: { nextCursor, hasMore: nextCursor !== null } });

describe("readAllPages", () => {
	it("concatenates pages until the cursor ends", () => {
		const afters: Array<string | undefined> = [];
		const pages = new Map([
			["a", pageOf([2], "b")],
			["b", pageOf([3], null)],
			[undefined, pageOf([1], "a")],
		]);
		return expect(
			Effect.runPromise(
				readAllPages((after) => {
					afters.push(after);
					return pages.get(after) ?? Effect.die("unexpected cursor");
				}),
			).then((items) => ({ items, afters })),
		).resolves.toEqual({ items: [1, 2, 3], afters: [undefined, "a", "b"] });
	});

	it("dies when a cursor repeats", () =>
		expect(
			Effect.runPromiseExit(readAllPages(() => pageOf([1], "a"))).then(({ _tag }) => _tag),
		).resolves.toBe("Failure"));

	it("dies when a continuing page has no cursor", () =>
		expect(
			Effect.runPromiseExit(
				readAllPages(() =>
					Effect.succeed({ items: [1], pageInfo: { hasMore: true, nextCursor: null } }),
				),
			).then(({ _tag }) => _tag),
		).resolves.toBe("Failure"));
});

const continueFrom = (
	pageInfo: { hasMore: boolean; nextCursor: null | string },
	previous?: string,
) =>
	Effect.runPromise(
		continuationCursor(pageInfo, previous).pipe(
			Effect.catchTag("PaginationError", () => Effect.succeed("failed")),
		),
	);

describe("continuationCursor", () => {
	it("ends on the last page and advances otherwise", () =>
		expect(
			Promise.all([
				continueFrom({ hasMore: false, nextCursor: "ignored" }),
				continueFrom({ hasMore: true, nextCursor: "b" }, "a"),
			]),
		).resolves.toEqual([undefined, "b"]));

	it("fails when a continuing page has no cursor or repeats the previous one", () =>
		expect(
			Promise.all([
				continueFrom({ hasMore: true, nextCursor: null }),
				continueFrom({ hasMore: true, nextCursor: "" }),
				continueFrom({ hasMore: true, nextCursor: "a" }, "a"),
			]),
		).resolves.toEqual(["failed", "failed", "failed"]));
});
