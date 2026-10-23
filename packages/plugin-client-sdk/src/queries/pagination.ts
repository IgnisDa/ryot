import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

export type PaginationOperation = "initial" | "refresh" | "append";

export class PaginationError extends Schema.TaggedError<
	PaginationError,
	{ readonly brand: unique symbol }
>()("PaginationError", { reason: Schema.Literal("cursor-did-not-advance") }) {}

export type PaginationOptions<Page, Param> = {
	readonly initialPageParam: Param;
	readonly load: (param: Param, refresh: boolean) => Effect.Effect<Page, unknown>;
	readonly getNextPageParam: (page: Page, param: Param, pages: readonly Page[]) => Param | null;
	readonly mode?: "append" | "replace" | undefined;
};

export type PaginationSnapshot<Page, Param> = {
	readonly pages: readonly Page[];
	readonly pageParams: readonly Param[];
	readonly operation: PaginationOperation | null;
	readonly errorOperation: PaginationOperation | null;
	readonly cause: Cause.Cause<unknown> | null;
	readonly nextPageParam: Param | null;
};

export const nextPageCursor = (page: {
	readonly pageInfo: { readonly hasMore?: boolean; readonly nextCursor: string | null };
}) => {
	const { hasMore, nextCursor } = page.pageInfo;
	if (hasMore === false) {
		return null;
	}
	if (nextCursor === "" || (hasMore === true && nextCursor === null)) {
		throw new PaginationError({ reason: "cursor-did-not-advance" });
	}
	return nextCursor;
};

export const paginationItems = <Page, Item>(
	pages: readonly Page[],
	select: (page: Page) => readonly Item[],
	key: (item: Item) => string,
): readonly Item[] => [...new Map(pages.flatMap(select).map((item) => [key(item), item])).values()];

export const createPagination = <Page, Param>(initialOptions: PaginationOptions<Page, Param>) => {
	let options = initialOptions;
	let snapshot: PaginationSnapshot<Page, Param> = {
		pages: [],
		cause: null,
		pageParams: [],
		operation: null,
		nextPageParam: null,
		errorOperation: null,
	};
	const listeners = new Set<() => void>();
	const waiters = new Set<() => void>();
	let generation = 0;
	let running = false;
	let queuedRefresh = false;
	const publish = (next: PaginationSnapshot<Page, Param>) => {
		snapshot = next;
		for (const listener of listeners) {
			listener();
		}
	};
	const stop = () => {
		generation++;
		running = false;
		queuedRefresh = false;
		for (const complete of waiters) {
			complete();
		}
		waiters.clear();
		publish({ ...snapshot, operation: null });
	};
	const execute: (operation: PaginationOperation) => Effect.Effect<void> = Effect.fnUntraced(
		function* (operation: PaginationOperation) {
			if (running) {
				return;
			}
			const version = generation;
			const previous = snapshot;
			let param = options.initialPageParam;
			if (operation === "append") {
				const next = snapshot.nextPageParam;
				if (next === null) {
					return;
				}
				param = next;
			} else if (options.mode === "replace" && previous.pageParams.length > 0) {
				param = previous.pageParams.at(-1) ?? options.initialPageParam;
			}
			running = true;
			publish({ ...previous, operation, cause: null, errorOperation: null });
			const request = Effect.gen(function* () {
				const pages: Page[] = [];
				const params: Param[] = [];
				const seen = operation === "append" ? [...previous.pageParams] : [];
				let nextPageParam: Param | null = null;
				const depth =
					operation === "refresh" && options.mode !== "replace"
						? Math.max(1, previous.pages.length)
						: 1;
				for (let index = 0; index < depth; index++) {
					if (generation !== version) {
						break;
					}
					if (seen.some((value) => Equal.equals(value, param))) {
						return yield* new PaginationError({ reason: "cursor-did-not-advance" });
					}
					const page = yield* options.load(
						param,
						operation === "refresh" || previous.errorOperation !== null,
					);
					if (generation !== version) {
						break;
					}
					pages.push(page);
					params.push(param);
					seen.push(param);
					const loadedPages =
						operation === "append" && options.mode !== "replace"
							? [...previous.pages, ...pages]
							: pages;
					const next = yield* Effect.sync(() => options.getNextPageParam(page, param, loadedPages));
					nextPageParam = next;
					if (next !== null && seen.some((value) => Equal.equals(value, next))) {
						return yield* new PaginationError({ reason: "cursor-did-not-advance" });
					}
					if (next === null || index + 1 === depth) {
						break;
					}
					param = next;
				}
				return {
					nextPageParam,
					pages:
						operation === "append" && options.mode !== "replace"
							? [...previous.pages, ...pages]
							: pages,
					pageParams:
						operation === "append" && options.mode !== "replace"
							? [...previous.pageParams, ...params]
							: params,
				};
			});
			const result = yield* Effect.exit(request).pipe(
				Effect.onInterrupt(() =>
					Effect.sync(() => {
						if (generation === version) {
							stop();
						}
					}),
				),
			);
			if (generation !== version) {
				return;
			}
			running = false;
			if (Exit.isSuccess(result)) {
				publish({ ...result.value, cause: null, operation: null, errorOperation: null });
			} else {
				publish({ ...previous, operation: null, cause: result.cause, errorOperation: operation });
			}
			if (queuedRefresh) {
				queuedRefresh = false;
				const pending = [...waiters];
				waiters.clear();
				yield* execute("refresh").pipe(
					Effect.ensuring(
						Effect.sync(() => {
							for (const complete of pending) {
								complete();
							}
						}),
					),
				);
			}
		},
	);
	const refresh = Effect.fnUntraced(function* () {
		if (!running) {
			return yield* execute(snapshot.pages.length === 0 ? "initial" : "refresh");
		}
		return yield* Effect.callback<void>((resume) => {
			queuedRefresh = true;
			const complete = () => resume(Effect.void);
			waiters.add(complete);
			return Effect.sync(() => waiters.delete(complete));
		});
	});
	return {
		stop,
		refresh,
		snapshot: () => snapshot,
		fetchNextPage: () => execute("append"),
		hasNextPage: () => snapshot.nextPageParam !== null,
		configure: (next: PaginationOptions<Page, Param>) => {
			options = next;
		},
		retry: () => (snapshot.errorOperation === "append" ? execute("append") : refresh()),
		start: () => (snapshot.pages.length === 0 && !running ? execute("initial") : Effect.void),
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
};
