import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { Cause, Effect, ManagedRuntime } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Network from "expo-network";
import { useEffect, useEffectEvent, useLayoutEffect, useReducer, useRef } from "react";
import { AppState } from "react-native";

import { executeRyotQL } from "@/api/queries";
import { type ApiScope, keyedRequestFamily, scopedRequestKey } from "@/api/request-key";
import { useApiScope } from "@/api/scope";
import { useEntityUpdates } from "@/modules/entity-interest/use-entity-updates";

import { withSavedViewCursor } from "./atom-requests";
import { managedAssetResolutionAtom, savedViewRecordAtom } from "./atoms";
import {
	createSavedViewControllerState,
	executeSavedViewRequest,
	fetchSavedViewPages,
	isSavedViewLoadingMore,
	isSavedViewOperationCurrent,
	savedViewControllerReducer,
	savedViewControllerResult,
	type SavedViewOperationToken,
	type SavedViewRequestFailure,
} from "./controller";
import type { collectManagedAssets } from "./display-data";
import { buildSavedViewHydrationDocument } from "./hydration";
import { createSavedViewRefreshEvents } from "./refresh-events";
import { useSavedViewLayout, type SavedViewLayout } from "./saved-view-layout-selector";
import {
	mapManagedAssetResolution,
	mapSavedViewRecord,
	mapSavedViewResult,
	type SavedViewManagedAssetsState,
	type SavedViewNormalizedState,
	type SavedViewReadyState,
} from "./state";
import { SavedViewStructuralRefresh, type SavedViewStructuralRequest } from "./structural-refresh";

type ManagedAssetsRequest = ApiScope & {
	readonly assets: ReturnType<typeof collectManagedAssets>;
};

type StructuralRuntime = {
	readonly identity: string;
	readonly runtime: ManagedRuntime.ManagedRuntime<SavedViewStructuralRefresh, never>;
};

const savedViewRecordStateAtom = keyedRequestFamily(
	(request: ApiScope & { readonly slug: string }) => scopedRequestKey(request, request.slug),
	(request) => savedViewRecordAtom(request).pipe(Atom.map(mapSavedViewRecord)),
);

const savedViewManagedAssetsStateAtom = keyedRequestFamily(
	(request: ManagedAssetsRequest) => scopedRequestKey(request, request.assets),
	(request) =>
		managedAssetResolutionAtom(request).pipe(
			Atom.map((result) => mapManagedAssetResolution(result, request.serverUrl)),
		),
);

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
	const atom = savedViewRecordStateAtom({ ...scope, slug });
	const state = useAtomValue(atom);
	useSavedViewFailureLogging("saved-view record", state);
	return { state, refresh: useAtomRefresh(atom) };
};

export const useSavedViewResult = (record: SavedViewRecord) => {
	const scope = useApiScope();
	const [layout] = useSavedViewLayout(record.slug);
	const identity = scopedRequestKey(scope, record.id, record.updatedAt);
	const [controller, dispatch] = useReducer(savedViewControllerReducer, undefined, () =>
		createSavedViewControllerState(identity, layout),
	);
	const controllerRef = useRef(controller);
	const operationSequence = useRef(controller.generation);
	const activeRequest = useRef<SavedViewOperationToken | undefined>(undefined);
	const structuralRuntimeRef = useRef<StructuralRuntime>(undefined);
	controllerRef.current = controller;

	useLayoutEffect(() => {
		dispatch({ type: "identity-changed", identity, layout });
	}, [identity, layout]);
	useLayoutEffect(() => {
		dispatch({ type: "layout-changed", layout });
	}, [layout]);

	const executePages = async (input: {
		readonly layout: SavedViewLayout;
		readonly phase: "initial" | "load-more" | "structural";
		readonly pagesToLoad: number;
		readonly queryDocument: RyotQLDocument;
		readonly initialData?: SavedViewNormalizedState;
	}) => {
		const current = controllerRef.current;
		if (
			current.identity !== identity ||
			current.activeLayout !== input.layout ||
			(activeRequest.current?.identity === identity &&
				activeRequest.current.layout === input.layout)
		) {
			return false;
		}
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
				execute: (queryDocument) => executeRyotQL(scope.serverUrl, queryDocument),
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
			return false;
		}
		dispatch({ type: "request-succeeded", token, data: result.data });
		return true;
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
	}, [identity, layout, record]);

	useEffect(() => {
		const managedRuntime = ManagedRuntime.make(SavedViewStructuralRefresh.layer);
		const structuralRuntime = { identity, runtime: managedRuntime };
		structuralRuntimeRef.current = structuralRuntime;
		return () => {
			if (structuralRuntimeRef.current === structuralRuntime) {
				structuralRuntimeRef.current = undefined;
			}
			void managedRuntime.dispose();
		};
	}, [identity]);

	const runStructural = (effect: Effect.Effect<void, never, SavedViewStructuralRefresh>) => {
		const structuralRuntime = structuralRuntimeRef.current;
		if (structuralRuntime?.identity === identity) {
			structuralRuntime.runtime.runFork(effect);
		}
	};

	const makeStructuralRequest = (targetLayout: SavedViewLayout): SavedViewStructuralRequest => {
		const structuralToken = { identity, layout: targetLayout };
		return {
			key: `${identity}:${targetLayout}`,
			canStart: () => {
				const current = controllerRef.current;
				const target = current.layouts[targetLayout];
				return (
					current.identity === identity &&
					current.activeLayout === targetLayout &&
					!!target &&
					target.data.pages.length > 0 &&
					!target.operation &&
					!activeRequest.current
				);
			},
			onEnd: Effect.sync(() => dispatch({ type: "manual-ended", token: structuralToken })),
			onStart: (manual) =>
				Effect.sync(() => {
					if (manual) {
						dispatch({ type: "manual-started", token: structuralToken });
					}
				}),
			run: Effect.promise(() => {
				const current = controllerRef.current;
				const target = current.layouts[targetLayout];
				if (current.identity !== identity || current.activeLayout !== targetLayout || !target) {
					return Promise.resolve(true);
				}
				return executePages({
					layout: targetLayout,
					phase: "structural",
					pagesToLoad: target.data.pages.length,
					queryDocument: record.layouts[targetLayout].queryDocument,
				});
			}),
		};
	};

	const triggerStructural = (manual: boolean) => {
		const targetLayout = controllerRef.current.activeLayout;
		runStructural(
			Effect.flatMap(SavedViewStructuralRefresh, (service) =>
				service.refresh(makeStructuralRequest(targetLayout), manual),
			),
		);
	};

	const markStructuralDirty = (targetLayout: SavedViewLayout) => {
		runStructural(
			Effect.flatMap(SavedViewStructuralRefresh, (service) =>
				service.markDirty(makeStructuralRequest(targetLayout)),
			),
		);
	};

	const activateStructural = useEffectEvent(() => {
		const targetLayout = controllerRef.current.activeLayout;
		runStructural(
			Effect.flatMap(SavedViewStructuralRefresh, (service) =>
				service.activate(makeStructuralRequest(targetLayout)),
			),
		);
	});

	useSavedViewFailureLogging("saved-view result", runtime?.failure);
	useEntityUpdates({
		blocked: !!runtime?.operation || !!runtime?.manual,
		entityIds: state.status === "ready" ? state.entityIds : [],
		owner: `saved-view:${identity}`,
		onDrain: () => triggerStructural(false),
		onBatch: (updates) =>
			Effect.gen(function* () {
				const current = controllerRef.current;
				const targetLayout = current.activeLayout;
				const target = current.layouts[targetLayout];
				if (!target || target.data.pages.length === 0) {
					return;
				}
				const loaded = new Set(target.data.pages.flatMap((page) => page.entityIds));
				const entityIds = [...new Set(updates.map((update) => update.entityId))].filter(
					(entityId) => loaded.has(entityId),
				);
				if (entityIds.length === 0) {
					return;
				}
				const token = {
					identity: current.identity,
					layout: targetLayout,
					generation: current.generation,
				};
				markStructuralDirty(targetLayout);
				const queryDocument = buildSavedViewHydrationDocument({
					entityIds,
					queryDocument: record.layouts[targetLayout].queryDocument,
					entityIdField: record.layouts[targetLayout].entityIdField,
				});
				const decoded = yield* executeSavedViewRequest({
					queryDocument,
					decode: (response) => decodeSavedViewResponse(response, record, targetLayout),
					execute: (document) => executeRyotQL(scope.serverUrl, document),
				});
				const latest = controllerRef.current;
				if (!isSavedViewOperationCurrent(token, latest)) {
					if (latest.identity === token.identity && latest.activeLayout === token.layout) {
						markStructuralDirty(targetLayout);
					}
					return;
				}
				dispatch({
					token,
					entityIds,
					type: "hydration-succeeded",
					items: decoded.data.items,
				});
			}),
	});

	useEffect(() => {
		if (!runtime?.operation) {
			activateStructural();
		}
	}, [identity, layout, runtime?.operation]);

	const triggerStructuralFromEffect = useEffectEvent(() => triggerStructural(false));
	useEffect(() => {
		const events = createSavedViewRefreshEvents(triggerStructuralFromEffect);
		const appStateSubscription = AppState.addEventListener("change", events.onAppStateChange);
		const networkSubscription = Network.addNetworkStateListener(events.onNetworkStateChange);
		return () => {
			appStateSubscription.remove();
			networkSubscription.remove();
		};
	}, [identity]);

	const refresh = () => {
		const current = controllerRef.current;
		const active = current.layouts[current.activeLayout];
		if (active?.data.pages.length || active?.operation) {
			triggerStructural(true);
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

function useSavedViewFailureLogging(
	label: string,
	state: { readonly status?: string; readonly cause?: unknown } | undefined,
) {
	const status = state?.status;
	const cause = state?.cause;
	useEffect(() => {
		if ((status !== "transport-error" && status !== "malformed") || cause === undefined) {
			return;
		}
		const detail = Cause.isCause(cause) ? Cause.pretty(cause) : cause;
		Effect.runSync(Effect.logWarning(`${label} ${status}`, detail));
	}, [cause, label, status]);
}

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
	const state = useAtomValue(savedViewManagedAssetsStateAtom({ ...scope, assets: props.assets }));
	useSavedViewFailureLogging("saved-view managed asset resolution", state);
	return <>{props.children(state)}</>;
}
