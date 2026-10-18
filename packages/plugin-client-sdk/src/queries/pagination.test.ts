import { assert, expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import { RyotClientError } from "../client/errors";
import { createPagination, nextPageCursor, PaginationError, paginationItems } from "./pagination";

type Item = { readonly id: string; readonly value: string };
type Page = { readonly next: null | string; readonly items: readonly Item[] };
type Request<Param> = {
	readonly param: Param;
	readonly refresh: boolean;
	readonly resume: (result: Effect.Effect<Page, unknown>) => void;
};

const page = (items: readonly Item[], next: null | string): Page => ({ next, items });
const getNextPageParam = (loaded: Page) => loaded.next;

const controlledLoad = <Param>() => {
	const requests: Request<Param>[] = [];
	const load = (param: Param, refresh: boolean): Effect.Effect<Page, unknown> =>
		Effect.callback<Page, unknown>((resume) => {
			requests.push({ param, resume, refresh });
		});
	return { load, requests };
};

const resume = <Param>(
	requests: readonly Request<Param>[],
	index: number,
	result: Effect.Effect<Page, unknown>,
) => {
	const request = requests[index];
	assert(request !== undefined, `Expected request ${index}`);
	request.resume(result);
};

it.effect("supplies all loaded pages when computing numbered continuations", () =>
	Effect.gen(function* () {
		const pagination = createPagination({
			initialPageParam: 1,
			getNextPageParam: (_page, param, pages) => (pages.length < 3 ? param + 1 : null),
			load: (param: number) => Effect.succeed(page([{ id: `${param}`, value: `${param}` }], null)),
		});
		yield* pagination.start();
		yield* pagination.fetchNextPage();
		yield* pagination.fetchNextPage();
		expect(pagination.snapshot().pageParams).toEqual([1, 2, 3]);
		expect(pagination.hasNextPage()).toBe(false);
	}),
);

it.effect("loads pages once, preserves pending data, and merges duplicate items last-wins", () =>
	Effect.gen(function* () {
		const { load, requests } = controlledLoad<string>();
		const pagination = createPagination({ load, getNextPageParam, initialPageParam: "first" });
		const starting = yield* Effect.forkChild(pagination.start(), { startImmediately: true });
		expect(requests.map(({ param, refresh }) => ({ param, refresh }))).toEqual([
			{ param: "first", refresh: false },
		]);
		resume(
			requests,
			0,
			Effect.succeed(
				page(
					[
						{ id: "a", value: "first" },
						{ id: "b", value: "kept" },
					],
					"second",
				),
			),
		);
		yield* Fiber.join(starting);

		const originalPages = pagination.snapshot().pages;
		const appending = yield* Effect.forkChild(pagination.fetchNextPage(), {
			startImmediately: true,
		});
		expect(pagination.snapshot().operation).toBe("append");
		expect(pagination.snapshot().pages).toEqual(originalPages);
		yield* pagination.fetchNextPage();
		expect(requests).toHaveLength(2);
		expect(pagination.snapshot().pages).toEqual(originalPages);
		resume(
			requests,
			1,
			Effect.succeed(
				page(
					[
						{ id: "a", value: "last" },
						{ id: "c", value: "new" },
					],
					null,
				),
			),
		);
		yield* Fiber.join(appending);
		expect(pagination.snapshot().pages).toEqual([
			page(
				[
					{ id: "a", value: "first" },
					{ id: "b", value: "kept" },
				],
				"second",
			),
			page(
				[
					{ id: "a", value: "last" },
					{ id: "c", value: "new" },
				],
				null,
			),
		]);
		expect(
			paginationItems(
				pagination.snapshot().pages,
				(loaded) => loaded.items,
				(item) => item.id,
			),
		).toEqual([
			{ id: "a", value: "last" },
			{ id: "b", value: "kept" },
			{ id: "c", value: "new" },
		]);
	}),
);

it.effect("refreshes loaded pages atomically and follows each new cursor", () =>
	Effect.gen(function* () {
		const { load, requests } = controlledLoad<string>();
		const pagination = createPagination({ load, getNextPageParam, initialPageParam: "first" });
		const starting = yield* Effect.forkChild(pagination.start(), { startImmediately: true });
		resume(requests, 0, Effect.succeed(page([{ id: "old-1", value: "old-1" }], "old-second")));
		yield* Fiber.join(starting);
		const appending = yield* Effect.forkChild(pagination.fetchNextPage(), {
			startImmediately: true,
		});
		resume(requests, 1, Effect.succeed(page([{ id: "old-2", value: "old-2" }], "old-third")));
		yield* Fiber.join(appending);
		const previous = pagination.snapshot();

		const refreshing = yield* Effect.forkChild(pagination.refresh(), { startImmediately: true });
		expect(requests[2]).toMatchObject({ refresh: true, param: "first" });
		expect(pagination.snapshot().pages).toEqual(previous.pages);
		resume(requests, 2, Effect.succeed(page([{ id: "new-1", value: "new-1" }], "new-second")));
		yield* Effect.yieldNow;
		expect(requests[3]).toMatchObject({ refresh: true, param: "new-second" });
		expect(pagination.snapshot().pages).toEqual(previous.pages);
		resume(requests, 3, Effect.succeed(page([{ id: "new-2", value: "new-2" }], "new-third")));
		yield* Fiber.join(refreshing);
		expect(pagination.snapshot().pages).toEqual([
			page([{ id: "new-1", value: "new-1" }], "new-second"),
			page([{ id: "new-2", value: "new-2" }], "new-third"),
		]);
		expect(pagination.snapshot().nextPageParam).toBe("new-third");
		expect(pagination.hasNextPage()).toBe(true);
	}),
);

it.effect("keeps all prior pages and continuation when a refresh fails part-way", () =>
	Effect.gen(function* () {
		const { load, requests } = controlledLoad<string>();
		const pagination = createPagination({ load, getNextPageParam, initialPageParam: "first" });
		const starting = yield* Effect.forkChild(pagination.start(), { startImmediately: true });
		resume(requests, 0, Effect.succeed(page([{ id: "old-1", value: "old-1" }], "old-second")));
		yield* Fiber.join(starting);
		const appending = yield* Effect.forkChild(pagination.fetchNextPage(), {
			startImmediately: true,
		});
		resume(requests, 1, Effect.succeed(page([{ id: "old-2", value: "old-2" }], "old-third")));
		yield* Fiber.join(appending);
		const previous = pagination.snapshot();

		const refreshing = yield* Effect.forkChild(pagination.refresh(), { startImmediately: true });
		resume(
			requests,
			2,
			Effect.succeed(page([{ value: "new", id: "replacement-1" }], "new-second")),
		);
		yield* Effect.yieldNow;
		expect(requests[3]).toMatchObject({ refresh: true, param: "new-second" });
		resume(requests, 3, Effect.fail(new RyotClientError("transport")));
		yield* Fiber.join(refreshing);

		expect(pagination.snapshot().pages).toEqual(previous.pages);
		expect(pagination.snapshot().pageParams).toEqual(previous.pageParams);
		expect(pagination.snapshot().nextPageParam).toBe(previous.nextPageParam);
		expect(pagination.snapshot().errorOperation).toBe("refresh");
		expect(pagination.snapshot().cause).not.toBeNull();
	}),
);

it.effect("retries a failed append with its saved continuation and refresh flag", () =>
	Effect.gen(function* () {
		const { load, requests } = controlledLoad<string>();
		const pagination = createPagination({ load, getNextPageParam, initialPageParam: "first" });
		const starting = yield* Effect.forkChild(pagination.start(), { startImmediately: true });
		resume(requests, 0, Effect.succeed(page([{ id: "first", value: "first" }], "next")));
		yield* Fiber.join(starting);
		const previous = pagination.snapshot();

		const appending = yield* Effect.forkChild(pagination.fetchNextPage(), {
			startImmediately: true,
		});
		expect(requests[1]).toMatchObject({ param: "next", refresh: false });
		resume(requests, 1, Effect.fail(new RyotClientError("transport")));
		yield* Fiber.join(appending);
		expect(pagination.snapshot().pages).toEqual(previous.pages);
		expect(pagination.snapshot().nextPageParam).toBe("next");
		expect(pagination.snapshot().errorOperation).toBe("append");

		const retrying = yield* Effect.forkChild(pagination.retry(), { startImmediately: true });
		expect(requests[2]).toMatchObject({ param: "next", refresh: true });
		expect(pagination.snapshot().pages).toEqual(previous.pages);
		resume(requests, 2, Effect.succeed(page([{ id: "second", value: "second" }], null)));
		yield* Fiber.join(retrying);
		expect(pagination.snapshot().pages).toEqual([
			page([{ id: "first", value: "first" }], "next"),
			page([{ id: "second", value: "second" }], null),
		]);
		expect(pagination.snapshot().errorOperation).toBeNull();
	}),
);

it.effect("coalesces refresh hints during append and refreshes the updated depth", () =>
	Effect.gen(function* () {
		const { load, requests } = controlledLoad<string>();
		const pagination = createPagination({ load, getNextPageParam, initialPageParam: "first" });
		const starting = yield* Effect.forkChild(pagination.start(), { startImmediately: true });
		resume(requests, 0, Effect.succeed(page([{ id: "first", value: "first" }], "second")));
		yield* Fiber.join(starting);
		const appending = yield* Effect.forkChild(pagination.fetchNextPage(), {
			startImmediately: true,
		});
		const refreshOne = yield* Effect.forkChild(pagination.refresh(), { startImmediately: true });
		const refreshTwo = yield* Effect.forkChild(pagination.refresh(), { startImmediately: true });
		expect(requests).toHaveLength(2);
		expect(pagination.snapshot().operation).toBe("append");

		resume(requests, 1, Effect.succeed(page([{ id: "second", value: "second" }], "third")));
		yield* Effect.yieldNow;
		expect(requests).toHaveLength(3);
		expect(requests[2]).toMatchObject({ refresh: true, param: "first" });
		expect(pagination.snapshot().pages).toEqual([
			page([{ id: "first", value: "first" }], "second"),
			page([{ id: "second", value: "second" }], "third"),
		]);
		resume(
			requests,
			2,
			Effect.succeed(page([{ id: "fresh-1", value: "fresh-1" }], "fresh-second")),
		);
		yield* Effect.yieldNow;
		expect(requests).toHaveLength(4);
		expect(requests[3]).toMatchObject({ refresh: true, param: "fresh-second" });
		resume(requests, 3, Effect.succeed(page([{ id: "fresh-2", value: "fresh-2" }], "fresh-third")));
		yield* Fiber.join(appending);
		yield* Fiber.join(refreshOne);
		yield* Fiber.join(refreshTwo);
		expect(requests).toHaveLength(4);
		expect(pagination.snapshot().pages).toEqual([
			page([{ id: "fresh-1", value: "fresh-1" }], "fresh-second"),
			page([{ id: "fresh-2", value: "fresh-2" }], "fresh-third"),
		]);
	}),
);

it.effect("ignores a completion after stop and allows a later start", () =>
	Effect.gen(function* () {
		const { load, requests } = controlledLoad<string>();
		const pagination = createPagination({ load, getNextPageParam, initialPageParam: "first" });
		const stopped = yield* Effect.forkChild(pagination.start(), { startImmediately: true });
		expect(requests).toHaveLength(1);
		pagination.stop();
		const empty = pagination.snapshot();
		expect(empty).toMatchObject({
			pages: [],
			pageParams: [],
			operation: null,
			nextPageParam: null,
		});
		resume(requests, 0, Effect.succeed(page([{ id: "late", value: "late" }], "late-next")));
		yield* Fiber.join(stopped);
		expect(pagination.snapshot()).toEqual(empty);
		expect(pagination.hasNextPage()).toBe(false);

		const starting = yield* Effect.forkChild(pagination.start(), { startImmediately: true });
		expect(requests).toHaveLength(2);
		expect(requests[1]).toMatchObject({ param: "first", refresh: false });
		resume(
			requests,
			1,
			Effect.succeed(page([{ id: "current", value: "current" }], "current-next")),
		);
		yield* Fiber.join(starting);
		expect(pagination.snapshot().pages).toEqual([
			page([{ id: "current", value: "current" }], "current-next"),
		]);
		expect(pagination.snapshot().nextPageParam).toBe("current-next");
	}),
);

it.effect("stops repeated cursors and rejects a missing cursor when more pages are promised", () =>
	Effect.gen(function* () {
		const { load, requests } = controlledLoad<string>();
		const pagination = createPagination({ load, getNextPageParam, initialPageParam: "first" });
		const starting = yield* Effect.forkChild(pagination.start(), { startImmediately: true });
		resume(requests, 0, Effect.succeed(page([{ id: "one", value: "one" }], "repeat")));
		yield* Fiber.join(starting);
		expect(requests).toHaveLength(1);
		const appending = yield* Effect.forkChild(pagination.fetchNextPage(), {
			startImmediately: true,
		});
		expect(requests[1]).toMatchObject({ refresh: false, param: "repeat" });
		resume(requests, 1, Effect.succeed(page([{ id: "two", value: "two" }], "repeat")));
		yield* Fiber.join(appending);
		expect(requests).toHaveLength(2);
		expect(pagination.snapshot().pages).toEqual([page([{ id: "one", value: "one" }], "repeat")]);
		expect(pagination.snapshot().errorOperation).toBe("append");
		expect(pagination.snapshot().cause).not.toBeNull();
		expect(pagination.snapshot().nextPageParam).toBe("repeat");
		expect(pagination.hasNextPage()).toBe(true);

		expect(() => nextPageCursor({ pageInfo: { hasMore: true, nextCursor: null } })).toThrow(
			PaginationError,
		);
		expect(() => nextPageCursor({ pageInfo: { hasMore: true, nextCursor: "" } })).toThrow(
			PaginationError,
		);
	}),
);

it.effect("uses the latest loaded parameter for replacement append and refresh", () =>
	Effect.gen(function* () {
		const { load, requests } = controlledLoad<number | string>();
		const pagination = createPagination({
			load,
			mode: "replace",
			getNextPageParam,
			initialPageParam: 20,
		});
		const starting = yield* Effect.forkChild(pagination.start(), { startImmediately: true });
		expect(requests[0]).toMatchObject({ param: 20, refresh: false });
		resume(requests, 0, Effect.succeed(page([{ id: "initial", value: "initial" }], "40")));
		yield* Fiber.join(starting);

		const appending = yield* Effect.forkChild(pagination.fetchNextPage(), {
			startImmediately: true,
		});
		expect(requests[1]).toMatchObject({ param: "40", refresh: false });
		resume(requests, 1, Effect.succeed(page([{ id: "replacement", value: "replacement" }], "60")));
		yield* Fiber.join(appending);
		expect(pagination.snapshot().pages).toEqual([
			page([{ id: "replacement", value: "replacement" }], "60"),
		]);
		expect(pagination.snapshot().pageParams).toEqual(["40"]);

		const refreshing = yield* Effect.forkChild(pagination.refresh(), { startImmediately: true });
		expect(requests[2]).toMatchObject({ param: "40", refresh: true });
		expect(pagination.snapshot().pages).toEqual([
			page([{ id: "replacement", value: "replacement" }], "60"),
		]);
		resume(requests, 2, Effect.succeed(page([{ id: "refreshed", value: "refreshed" }], "80")));
		yield* Fiber.join(refreshing);
		expect(pagination.snapshot().pages).toEqual([
			page([{ id: "refreshed", value: "refreshed" }], "80"),
		]);
	}),
);
