import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { savedViewRecipe } from "@ryot/ryotql-recipes/saved-views";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useLayoutEffect, useReducer, useRef } from "react";

import { appClient, appRevalidationSignal } from "@/api/client";
import { scopedRequestKey } from "@/api/request-key";
import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useEntityUpdates } from "@/modules/entity-interest/use-entity-updates";

import { savedViewRecordAtom } from "./atoms";
import {
	canRefreshSavedView,
	createSavedViewControllerState,
	fetchSavedViewPages,
	isSavedViewLoadingMore,
	isSavedViewLayoutChanging,
	isSavedViewRequestActiveFor,
	isSavedViewSearching,
	savedViewControllerReducer,
	savedViewControllerResult,
	savedViewControllerQueryDocument,
	type SavedViewOperationToken,
	withSavedViewCursor,
	withSavedViewSearch,
} from "./controller";
import { useSavedViewLayout } from "./saved-view-layout-selector";
import { savedViewReadyState, type SavedViewNormalizedState } from "./state";
import type { SavedViewLayout } from "./storage";

const REFRESH_RETRY_MS = 30_000;

export const useSavedViewRecord = (slug: string) => {
	const scope = useApiScope();
	const atom = savedViewRecordAtom({ scope, slug });
	const state = useAtomValue(atom);
	useInternalRequestFailureLogging(
		`saved-view record ${state.status}`,
		"cause" in state ? state.cause : undefined,
	);
	return { state, refresh: useAtomRefresh(atom) };
};

export const useSavedViewResult = (record: SavedViewRecord, searchQuery = "") => {
	const scope = useApiScope();
	const revalidationVersion = useAtomValue(appRevalidationSignal);
	const [layout] = useSavedViewLayout(record.slug);
	const normalizedSearchQuery = searchQuery.trim();
	const identity = scopedRequestKey(scope, record.id, record.updatedAt, normalizedSearchQuery);
	const queryDocument = withSavedViewSearch(
		record.layouts[layout].queryDocument,
		record.layouts[layout],
		normalizedSearchQuery,
	);
	const [controller, dispatch] = useReducer(savedViewControllerReducer, undefined, () =>
		createSavedViewControllerState(identity, layout),
	);
	const controllerRef = useRef(controller);
	const operationSequence = useRef(controller.generation);
	const activeRequest = useRef<SavedViewOperationToken | undefined>(undefined);
	const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const previousRevalidation = useRef(revalidationVersion);
	controllerRef.current = controller;

	const clearRetryTimer = () => {
		if (retryTimer.current !== undefined) {
			clearTimeout(retryTimer.current);
			retryTimer.current = undefined;
		}
	};

	useLayoutEffect(() => {
		clearRetryTimer();
		dispatch({ type: "identity-changed", identity, layout });
	}, [identity, layout]);
	useLayoutEffect(() => {
		clearRetryTimer();
		dispatch({ type: "layout-changed", layout });
	}, [layout]);
	useEffect(() => {
		clearRetryTimer();
		if (!controller.retryRefresh) {
			return undefined;
		}
		retryTimer.current = setTimeout(
			() => dispatch({ type: "refresh-retry-elapsed" }),
			REFRESH_RETRY_MS,
		);
		return clearRetryTimer;
	}, [controller.retryRefresh, identity, layout]);

	const executePages = async (input: {
		readonly pagesToLoad: number;
		readonly layout: SavedViewLayout;
		readonly queryDocument: RyotQLDocument;
		readonly initialData?: SavedViewNormalizedState;
		readonly phase: "initial" | "load-more" | "refresh";
	}) => {
		const current = controllerRef.current;
		if (
			current.identity !== identity ||
			current.activeLayout !== input.layout ||
			isSavedViewRequestActiveFor(activeRequest.current, identity, input.layout)
		) {
			return;
		}
		clearRetryTimer();
		operationSequence.current = Math.max(operationSequence.current, current.generation) + 1;
		const token = { identity, layout: input.layout, generation: operationSequence.current };
		activeRequest.current = token;
		dispatch({ type: "request-started", token, phase: input.phase });
		const result = await Effect.runPromise(
			fetchSavedViewPages({
				...input,
				execute: (requestDocument) => {
					const source = { type: "persisted", queryDocument: requestDocument } as const;
					if (input.layout === "table") {
						return appClient(scope)
							.ryotql.execute(
								savedViewRecipe({
									source,
									layout: { type: "table", mapping: record.layouts.table },
								}),
							)
							.pipe(Effect.map((data) => savedViewReadyState(data, input.layout)));
					}
					return appClient(scope)
						.ryotql.execute(
							savedViewRecipe({
								source,
								layout: { type: "card", mapping: record.layouts[input.layout] },
							}),
						)
						.pipe(Effect.map((data) => savedViewReadyState(data, input.layout)));
				},
			}).pipe(
				Effect.match({
					onFailure: (failure) => ({ failure }) as const,
					onSuccess: (data) => ({ data }) as const,
				}),
			),
		);
		if (activeRequest.current === token) {
			activeRequest.current = undefined;
		}
		if ("failure" in result) {
			dispatch({ type: "request-failed", token, failure: result.failure });
			return;
		}
		dispatch({ type: "request-succeeded", token, data: result.data });
	};

	const effectiveController =
		controller.identity === identity
			? controller
			: createSavedViewControllerState(identity, layout);
	const runtime = effectiveController.layouts[layout];
	const state = savedViewControllerResult(effectiveController);
	const isLoadingMore = isSavedViewLoadingMore(effectiveController);
	const visibleQueryDocument =
		savedViewControllerQueryDocument(effectiveController) ?? queryDocument;

	const loadInitial = useEffectEvent(() => {
		const current = controllerRef.current;
		const active = current.layouts[current.activeLayout];
		if (
			current.identity === identity &&
			current.activeLayout === layout &&
			active?.data.pages.length === 0 &&
			!active.failure &&
			!active.operation
		) {
			void executePages({ layout, queryDocument, pagesToLoad: 1, phase: "initial" });
		}
	});
	useEffect(() => {
		loadInitial();
	}, [controller.activeLayout, controller.identity, identity, layout, record]);

	const startPendingRefresh = useEffectEvent(() => {
		const current = controllerRef.current;
		if (!canRefreshSavedView(current)) {
			return;
		}
		const targetLayout = current.activeLayout;
		const target = current.layouts[targetLayout];
		if (!target) {
			return;
		}
		void executePages({
			phase: "refresh",
			layout: targetLayout,
			pagesToLoad: target.data.pages.length,
			queryDocument: withSavedViewSearch(
				record.layouts[targetLayout].queryDocument,
				record.layouts[targetLayout],
				normalizedSearchQuery,
			),
		});
	});
	useEffect(() => {
		startPendingRefresh();
	}, [controller.pendingRefresh, runtime?.operation]);

	useInternalRequestFailureLogging(
		`saved-view result ${runtime?.failure?.status}`,
		runtime?.failure?.cause,
	);
	useEntityUpdates({
		priority: "visible",
		blocked: !!runtime?.operation,
		owner: `saved-view:${identity}`,
		entityIds: state.status === "ready" ? state.entityIds : [],
		onBatch: () => Effect.sync(() => dispatch({ type: "refresh-requested" })),
	});

	useEffect(() => {
		if (previousRevalidation.current !== revalidationVersion) {
			previousRevalidation.current = revalidationVersion;
			dispatch({ type: "refresh-requested" });
		}
	}, [revalidationVersion]);

	const refresh = () => {
		const current = controllerRef.current;
		const active = current.layouts[current.activeLayout];
		if (active?.data.pages.length || active?.operation) {
			dispatch({ type: "refresh-requested" });
			return;
		}
		void executePages({ layout, queryDocument, pagesToLoad: 1, phase: "initial" });
	};
	const loadMore = () => {
		const current = controllerRef.current;
		const active = current.layouts[current.activeLayout];
		if (!active || active.operation || active.data.pages.length === 0) {
			return;
		}
		const ready = savedViewControllerResult(current);
		if (ready.status !== "ready" || !ready.data.pageInfo.hasMore) {
			return;
		}
		const cursor = ready.data.pageInfo.nextCursor;
		if (!cursor) {
			return;
		}
		void executePages({
			layout,
			pagesToLoad: 1,
			phase: "load-more",
			initialData: active.data,
			queryDocument: withSavedViewCursor(queryDocument, cursor),
		});
	};

	return {
		state,
		refresh,
		loadMore,
		isLoadingMore,
		queryDocument: visibleQueryDocument,
		isSearching: isSavedViewSearching(effectiveController),
		isLayoutChanging: isSavedViewLayoutChanging(effectiveController),
	};
};
