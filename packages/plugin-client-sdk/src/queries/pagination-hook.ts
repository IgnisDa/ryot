import { RegistryContext } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import {
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { useEntityRefresh } from "../refresh/entity-hooks";
import { usePageRefresh } from "../refresh/page-registry";
import { QueryDefinition, type RyotQuery } from "./definitions";
import { createPagination, type PaginationOptions } from "./pagination";
import { RyotContext } from "./provider";

export const usePagination = <Page, Param>(
	options: PaginationOptions<Page, Param> & {
		readonly identity: unknown;
		readonly enabled?: boolean | undefined;
	},
) => {
	const [stored, setStored] = useState(() => ({
		identity: options.identity,
		pagination: createPagination(options),
	}));
	let resource = stored;
	if (stored.identity !== options.identity) {
		resource = { identity: options.identity, pagination: createPagination(options) };
		setStored(resource);
	}
	const { pagination } = resource;
	useLayoutEffect(() => {
		pagination.configure(options);
	});
	const controller = useRef<
		undefined | { readonly lifetime: AbortController; readonly pagination: typeof pagination }
	>(undefined);
	const run = useCallback(
		(work: Effect.Effect<void>) => {
			const active = controller.current;
			if (
				options.enabled !== false &&
				active?.pagination === pagination &&
				!active.lifetime.signal.aborted
			) {
				Effect.runFork(work, { signal: active.lifetime.signal });
			}
		},
		[options.enabled, pagination],
	);
	useEffect(() => {
		const lifetime = new AbortController();
		controller.current = { lifetime, pagination };
		run(pagination.start());
		return () => {
			pagination.stop();
			lifetime.abort();
		};
	}, [pagination, run]);
	const snapshot = useSyncExternalStore(
		pagination.subscribe,
		pagination.snapshot,
		pagination.snapshot,
	);
	const retry = useCallback(() => run(pagination.retry()), [pagination, run]);
	const refetch = useCallback(() => run(pagination.refresh()), [pagination, run]);
	const fetchNextPage = useCallback(() => run(pagination.fetchNextPage()), [pagination, run]);
	const error = snapshot.cause === null ? null : Cause.squash(snapshot.cause);
	const isPending = snapshot.pages.length === 0 && snapshot.cause === null;
	const isError = snapshot.cause !== null;
	let status: "error" | "pending" | "success" = "success";
	if (isError) {
		status = "error";
	} else if (isPending) {
		status = "pending";
	}
	return {
		...snapshot,
		retry,
		status,
		refetch,
		isError,
		isPending,
		fetchNextPage,
		refresh: pagination.refresh,
		data: snapshot.pages.at(-1),
		hasNextPage: pagination.hasNextPage(),
		isFetching: snapshot.operation !== null,
		isRefreshing: snapshot.operation === "refresh",
		isSuccess: snapshot.pages.length > 0 && !isError,
		isFetchingNextPage: snapshot.operation === "append",
		error:
			error === null || error instanceof Error ? error : new Error("Pagination request failed"),
	};
};

export const useRyotInfiniteQuery = <
	QueryInput,
	Input,
	Page,
	Param,
	HostServices,
	Failure extends Error,
>(
	query: RyotQuery<QueryInput, Page, HostServices, Failure>,
	input: Input,
	options: {
		readonly initialPageParam: Param;
		readonly enabled?: boolean | undefined;
		readonly mode?: "append" | "replace" | undefined;
		readonly getPageInput: (input: Input, param: Param) => QueryInput;
		readonly getNextPageParam: PaginationOptions<Page, Param>["getNextPageParam"];
	},
) => {
	const context = useContext(RyotContext);
	const registry = useContext(RegistryContext);
	if (!context) {
		throw new Error("useRyotInfiniteQuery must be used within RyotProvider");
	}
	if (!(query instanceof QueryDefinition)) {
		throw new Error("useRyotInfiniteQuery requires createRyotQuery");
	}
	const { client, schedule, hostServices } = context;
	const inputKey = JSON.stringify(input);
	const enabled = options.enabled !== false;
	const identity = useMemo(
		() => ({
			query,
			client,
			enabled,
			registry,
			inputKey,
			mode: options.mode,
			initialPageParam: options.initialPageParam,
		}),
		[query, registry, client, enabled, inputKey, options.mode, options.initialPageParam],
	);
	const result = usePagination<Page, Param>({
		enabled,
		identity,
		mode: options.mode,
		initialPageParam: options.initialPageParam,
		getNextPageParam: options.getNextPageParam,
		load: (param, refresh) =>
			Effect.suspend(() => {
				const atom = query.atom(
					registry,
					client,
					schedule,
					hostServices,
					options.getPageInput(input, param),
					true,
				);
				return Effect.acquireUseRelease(
					Effect.sync(() => {
						if (refresh) {
							registry.refresh(atom);
						}
						return registry.mount(atom);
					}),
					() => AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }),
					(release) => Effect.sync(release),
				);
			}),
	});
	usePageRefresh(() => (enabled ? result.refresh() : Effect.void));
	const interests =
		result.pages.length === 0
			? [
					query.entityWatch?.({
						data: undefined,
						input: options.getPageInput(input, options.initialPageParam),
					}),
				]
			: result.pages.map((data, index) =>
					query.entityWatch?.({
						data,
						input: options.getPageInput(
							input,
							result.pageParams[index] ?? options.initialPageParam,
						),
					}),
				);
	useEntityRefresh({
		blocked: false,
		identity: inputKey,
		onRefresh: result.refresh,
		enabled: query.entityWatch !== undefined && enabled,
		interest: {
			visible: [...new Set(interests.flatMap((interest) => interest?.visible ?? []))],
			foreground: [...new Set(interests.flatMap((interest) => interest?.foreground ?? []))],
		},
	});
	return result;
};
