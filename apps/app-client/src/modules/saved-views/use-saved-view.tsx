import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { Effect } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useEffectEvent, useLayoutEffect, useReducer, useRef } from "react";

import { appClient, appRevalidationSignal, retryQueryResponse } from "@/api/client";
import { scopedRequestKey } from "@/api/request-key";
import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useEntityUpdates } from "@/modules/entity-interest/use-entity-updates";

import { managedAssetResolutionAtom, savedViewRecordAtom } from "./atoms";
import {
	canRefreshSavedView,
	createSavedViewControllerState,
	fetchSavedViewPages,
	isSavedViewLoadingMore,
	isSavedViewRequestActiveFor,
	savedViewControllerReducer,
	savedViewControllerResult,
	type SavedViewOperationToken,
	type SavedViewRequestFailure,
	withSavedViewCursor,
} from "./controller";
import type { collectManagedAssets } from "./display-data";
import { useSavedViewLayout } from "./saved-view-layout-selector";
import {
	mapSavedViewResult,
	type SavedViewManagedAssetsState,
	type SavedViewNormalizedState,
	type SavedViewReadyState,
} from "./state";
import type { SavedViewLayout } from "./storage";

const REFRESH_RETRY_MS = 30_000;

const decodeSavedViewResponse = (
	response: unknown,
	record: SavedViewRecord,
	layout: SavedViewLayout,
): Effect.Effect<SavedViewReadyState, SavedViewRequestFailure> => {
	const decoded = mapSavedViewResult(AsyncResult.success(response), record, layout);
	return decoded.status === "ready"
		? Effect.succeed(decoded)
		: Effect.fail({
				status: "malformed",
				cause: decoded.status === "loading" ? new Error("Unexpected loading state") : decoded.cause,
			});
};

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

export const useSavedViewResult = (record: SavedViewRecord) => {
	const scope = useApiScope();
	const revalidationVersion = useAtomValue(appRevalidationSignal);
	const [layout] = useSavedViewLayout(record.slug);
	const identity = scopedRequestKey(scope, record.id, record.updatedAt);
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
		readonly layout: SavedViewLayout;
		readonly phase: "initial" | "load-more" | "refresh";
		readonly pagesToLoad: number;
		readonly queryDocument: RyotQLDocument;
		readonly initialData?: SavedViewNormalizedState;
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
		const token = {
			identity,
			layout: input.layout,
			generation: operationSequence.current,
		};
		activeRequest.current = token;
		dispatch({ type: "request-started", token, phase: input.phase });
		const result = await Effect.runPromise(
			fetchSavedViewPages({
				...input,
				decode: (response) => decodeSavedViewResponse(response, record, input.layout),
				execute: (queryDocument) =>
					appClient(scope).request.pipe(
						Effect.flatMap((client) => client.ryotql.execute({ payload: queryDocument })),
						retryQueryResponse,
					),
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
		controller.identity === identity && controller.activeLayout === layout
			? controller
			: createSavedViewControllerState(identity, layout);
	const runtime = effectiveController.layouts[layout];
	const state = savedViewControllerResult(effectiveController);
	const isLoadingMore = isSavedViewLoadingMore(effectiveController);

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
			void executePages({
				layout,
				phase: "initial",
				pagesToLoad: 1,
				queryDocument: record.layouts[layout].queryDocument,
			});
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
			layout: targetLayout,
			phase: "refresh",
			pagesToLoad: target.data.pages.length,
			queryDocument: record.layouts[targetLayout].queryDocument,
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
		blocked: !!runtime?.operation,
		entityIds: state.status === "ready" ? state.entityIds : [],
		owner: `saved-view:${identity}`,
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
		void executePages({
			layout,
			phase: "initial",
			pagesToLoad: 1,
			queryDocument: record.layouts[layout].queryDocument,
		});
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
			phase: "load-more",
			pagesToLoad: 1,
			initialData: active.data,
			queryDocument: withSavedViewCursor(record.layouts[layout].queryDocument, cursor),
		});
	};

	return { state, refresh, loadMore, isLoadingMore };
};

export function SavedViewRuntime(props: {
	readonly assets: ReturnType<typeof collectManagedAssets>;
	readonly children: (assets: SavedViewManagedAssetsState) => React.ReactNode;
}) {
	return props.assets.length === 0 ? (
		<>{props.children({ status: "ready", urls: new Map() })}</>
	) : (
		<SavedViewManagedAssets {...props} />
	);
}

function SavedViewManagedAssets(props: {
	readonly assets: ReturnType<typeof collectManagedAssets>;
	readonly children: (assets: SavedViewManagedAssetsState) => React.ReactNode;
}) {
	const scope = useApiScope();
	const state = useAtomValue(managedAssetResolutionAtom({ scope, assets: props.assets }));
	useInternalRequestFailureLogging(
		`saved-view managed asset resolution ${state.status}`,
		state.status === "unavailable" ? state.cause : undefined,
	);
	return <>{props.children(state)}</>;
}
