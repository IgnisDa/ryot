import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { Cause, Effect, ManagedRuntime } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Network from "expo-network";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { executeRyotQL } from "@/api/queries";
import { keyedRequestFamily, scopedRequestKey } from "@/api/request-key";
import { useEntityUpdates } from "@/modules/entity-interest/use-entity-updates";

import { withSavedViewCursor } from "./atom-requests";
import {
	managedAssetResolutionAtom,
	savedViewLayoutAtom,
	savedViewRecordAtom,
	savedViewResultAtom,
} from "./atoms";
import { fetchSavedViewReplacement, isSavedViewOperationCurrent } from "./controller";
import type { collectManagedAssets } from "./display-data";
import { buildSavedViewHydrationDocument } from "./hydration";
import type { SavedViewLayout } from "./saved-view-layout-selector";
import {
	mapManagedAssetResolution,
	mapSavedViewRecord,
	mapSavedViewResult,
	materializeSavedViewData,
	patchSavedViewItems,
	type SavedViewManagedAssetsState,
	type SavedViewNormalizedState,
} from "./state";
import { SavedViewStructuralRefresh, type SavedViewStructuralRequest } from "./structural-refresh";

type RecordScope = Scope & { readonly slug: string };
type Scope = { readonly serverUrl: string; readonly userId: string };
type ResultScope = Scope & {
	readonly layout: SavedViewLayout;
	readonly record: SavedViewRecord;
	readonly queryDocument: RyotQLDocument;
};
type ManagedAssetsScope = Scope & {
	readonly assets: ReturnType<typeof collectManagedAssets>;
};

type ForegroundRequest = {
	readonly generation: number;
	readonly queryDocument: RyotQLDocument;
	readonly phase: "initial" | "load-more";
};

type StructuralState = {
	generation: number;
};

type LayoutRuntime = {
	manual: boolean;
	foregroundBusy: boolean;
	structural: StructuralState;
	data: SavedViewNormalizedState;
	foreground: ForegroundRequest | undefined;
};

type RuntimeCache = {
	readonly identity: string;
	activeLayout: SavedViewLayout;
	readonly layouts: Partial<Record<SavedViewLayout, LayoutRuntime>>;
};

type StructuralRuntime = {
	readonly identity: string;
	readonly runtime: ManagedRuntime.ManagedRuntime<SavedViewStructuralRefresh, never>;
};

const savedViewRecordStateAtom = keyedRequestFamily(
	(request: RecordScope) => scopedRequestKey(request, request.slug),
	(request: RecordScope) => savedViewRecordAtom(request).pipe(Atom.map(mapSavedViewRecord)),
);

const savedViewResultStateAtom = keyedRequestFamily(
	(request: ResultScope) =>
		scopedRequestKey(
			request,
			request.record.slug,
			request.layout,
			request.record.updatedAt,
			request.queryDocument,
		),
	(request: ResultScope) => {
		const source = savedViewResultAtom({
			userId: request.userId,
			serverUrl: request.serverUrl,
			queryDocument: request.queryDocument,
		});
		return source.pipe(
			Atom.map((result) => mapSavedViewResult(result, request.record, request.layout)),
		);
	},
);

const savedViewManagedAssetsStateAtom = keyedRequestFamily(
	(request: ManagedAssetsScope) => scopedRequestKey(request, request.assets),
	(request: ManagedAssetsScope) =>
		managedAssetResolutionAtom(request).pipe(
			Atom.map((result) => mapManagedAssetResolution(result, request.serverUrl)),
		),
);

const createLayoutRuntime = (queryDocument: RyotQLDocument, generation = 0): LayoutRuntime => ({
	manual: false,
	foregroundBusy: true,
	structural: { generation },
	data: { itemsById: new Map(), pages: [] },
	foreground: { generation, queryDocument, phase: "initial" },
});

const createRuntimeCache = (
	identity: string,
	layout: SavedViewLayout,
	queryDocument: RyotQLDocument,
): RuntimeCache => ({
	identity,
	activeLayout: layout,
	layouts: { [layout]: createLayoutRuntime(queryDocument) },
});

const operationToken = (cache: RuntimeCache, layout: SavedViewLayout) => ({
	layout,
	identity: cache.identity,
	generation: cache.layouts[layout]?.structural.generation ?? -1,
});

const decodeSavedViewResponse = (
	response: unknown,
	record: SavedViewRecord,
	layout: SavedViewLayout,
) => {
	const decoded = mapSavedViewResult(AsyncResult.success(response), record, layout);
	if (decoded.status === "ready") {
		return Effect.succeed(decoded);
	}
	return Effect.fail(
		decoded.status === "loading" ? new Error("Unexpected loading state") : decoded.cause,
	);
};

export const useSavedViewRecord = (scope: RecordScope) => {
	const atom = savedViewRecordStateAtom(scope);
	const state = useAtomValue(atom);
	useSavedViewFailureLogging("saved-view record", state);
	return { state, refresh: useAtomRefresh(atom) };
};

export const useSavedViewResult = (scope: Scope & { readonly record: SavedViewRecord }) => {
	const layout = useAtomValue(
		savedViewLayoutAtom({
			userId: scope.userId,
			serverUrl: scope.serverUrl,
			viewSlug: scope.record.slug,
		}),
	);
	const identity = `${scope.serverUrl}:${scope.userId}:${scope.record.id}:${scope.record.updatedAt}`;
	const layoutQueryDocument = scope.record.layouts[layout].queryDocument;
	const [initialCache] = useState(() => createRuntimeCache(identity, layout, layoutQueryDocument));
	const cacheRef = useRef(initialCache);
	const structuralRuntimeRef = useRef<StructuralRuntime>(undefined);
	const [, rerender] = useState(0);
	const renderCache = cacheRef.current;
	const runtime =
		renderCache.identity === identity
			? (renderCache.layouts[layout] ?? createLayoutRuntime(layoutQueryDocument))
			: createLayoutRuntime(layoutQueryDocument);

	useLayoutEffect(() => {
		const currentCache = cacheRef.current;
		if (currentCache.identity !== identity) {
			cacheRef.current = createRuntimeCache(identity, layout, layoutQueryDocument);
			rerender((value) => value + 1);
			return;
		}
		let currentRuntime = currentCache.layouts[layout];
		if (!currentRuntime) {
			currentRuntime = createLayoutRuntime(layoutQueryDocument);
			currentCache.layouts[layout] = currentRuntime;
		}
		if (currentCache.activeLayout === layout) {
			return;
		}
		const previous = currentCache.layouts[currentCache.activeLayout];
		if (previous) {
			previous.structural.generation += 1;
			previous.foreground = undefined;
			previous.foregroundBusy = false;
		}
		currentCache.activeLayout = layout;
		currentRuntime.structural.generation += 1;
		if (currentRuntime.data.pages.length === 0) {
			currentRuntime.foreground = {
				generation: currentRuntime.structural.generation,
				phase: "initial",
				queryDocument: layoutQueryDocument,
			};
			currentRuntime.foregroundBusy = true;
		}
		rerender((value) => value + 1);
	}, [identity, layout, layoutQueryDocument]);

	const foreground = runtime.foreground;
	const queryDocument =
		foreground?.queryDocument ??
		runtime.data.pages.at(-1)?.queryDocument ??
		scope.record.layouts[layout].queryDocument;
	const atom = savedViewResultStateAtom({ ...scope, layout, queryDocument });
	const currentState = useAtomValue(atom);
	const refreshCurrent = useAtomRefresh(atom);

	useLayoutEffect(() => {
		const currentCache = cacheRef.current;
		const currentRuntime = currentCache.layouts[layout];
		if (
			currentCache.identity !== identity ||
			currentCache.activeLayout !== layout ||
			!currentRuntime ||
			currentRuntime.foreground !== foreground
		) {
			return;
		}
		const foregroundBusy = foreground !== undefined && currentState.status === "loading";
		if (currentRuntime.foregroundBusy !== foregroundBusy) {
			currentRuntime.foregroundBusy = foregroundBusy;
			rerender((value) => value + 1);
		}
	}, [currentState.status, foreground, identity, layout]);

	useSavedViewFailureLogging("saved-view result", currentState);
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

	const makeStructuralRequest = (targetLayout: SavedViewLayout): SavedViewStructuralRequest => ({
		key: `${identity}:${targetLayout}`,
		canStart: () => {
			const currentCache = cacheRef.current;
			const targetRuntime = currentCache.layouts[targetLayout];
			return (
				currentCache.identity === identity &&
				currentCache.activeLayout === targetLayout &&
				!!targetRuntime &&
				targetRuntime.data.pages.length > 0 &&
				!targetRuntime.foregroundBusy
			);
		},
		onEnd: Effect.sync(() => {
			const currentCache = cacheRef.current;
			const targetRuntime =
				currentCache.identity === identity ? currentCache.layouts[targetLayout] : undefined;
			if (targetRuntime) {
				targetRuntime.manual = false;
				rerender((value) => value + 1);
			}
		}),
		onStart: (manual) =>
			Effect.sync(() => {
				const currentCache = cacheRef.current;
				const targetRuntime =
					currentCache.identity === identity ? currentCache.layouts[targetLayout] : undefined;
				if (targetRuntime) {
					targetRuntime.manual = manual;
					rerender((value) => value + 1);
				}
			}),
		run: Effect.suspend(() => {
			const currentCache = cacheRef.current;
			const targetRuntime = currentCache.layouts[targetLayout];
			if (
				currentCache.identity !== identity ||
				currentCache.activeLayout !== targetLayout ||
				!targetRuntime
			) {
				return Effect.succeed(false);
			}
			const token = operationToken(currentCache, targetLayout);
			return fetchSavedViewReplacement({
				pagesToLoad: targetRuntime.data.pages.length,
				queryDocument: scope.record.layouts[targetLayout].queryDocument,
				decode: (response) => decodeSavedViewResponse(response, scope.record, targetLayout),
				execute: (document) => executeRyotQL(scope.serverUrl, document),
			}).pipe(
				Effect.map((replacement) => {
					const latestCache = cacheRef.current;
					const latestRuntime = latestCache.layouts[targetLayout];
					if (
						!latestRuntime ||
						!isSavedViewOperationCurrent(
							token,
							operationToken(latestCache, latestCache.activeLayout),
						)
					) {
						return false;
					}
					latestRuntime.data = replacement;
					latestRuntime.foreground = undefined;
					latestRuntime.foregroundBusy = false;
					latestRuntime.structural.generation += 1;
					return true;
				}),
			);
		}),
	});

	const triggerStructural = (manual: boolean) => {
		const targetLayout = cacheRef.current.activeLayout;
		const request = makeStructuralRequest(targetLayout);
		runStructural(
			Effect.flatMap(SavedViewStructuralRefresh, (service) => service.refresh(request, manual)),
		);
	};

	const markStructuralDirty = (targetLayout: SavedViewLayout) => {
		const request = makeStructuralRequest(targetLayout);
		runStructural(
			Effect.flatMap(SavedViewStructuralRefresh, (service) => service.markDirty(request)),
		);
	};

	const activateStructural = useEffectEvent(() => {
		const targetLayout = cacheRef.current.activeLayout;
		const request = makeStructuralRequest(targetLayout);
		runStructural(
			Effect.flatMap(SavedViewStructuralRefresh, (service) => service.activate(request)),
		);
	});

	useEffect(() => {
		if (!foreground || currentState.status === "loading") {
			return;
		}
		const currentCache = cacheRef.current;
		const currentRuntime = currentCache.layouts[layout];
		if (
			!currentRuntime ||
			currentRuntime.foreground !== foreground ||
			!isSavedViewOperationCurrent(
				{ identity, layout, generation: foreground.generation },
				operationToken(currentCache, currentCache.activeLayout),
			)
		) {
			return;
		}
		currentRuntime.foregroundBusy = false;
		if (currentState.status !== "ready") {
			rerender((value) => value + 1);
			activateStructural();
			return;
		}
		const page = {
			entityIds: currentState.entityIds,
			pageInfo: currentState.data.pageInfo,
			queryDocument: foreground.queryDocument,
		};
		const itemsById =
			foreground.phase === "initial" ? new Map() : new Map(currentRuntime.data.itemsById);
		for (const item of currentState.data.items) {
			itemsById.set(item.entityId, item);
		}
		currentRuntime.data = {
			itemsById,
			pages: foreground.phase === "initial" ? [page] : [...currentRuntime.data.pages, page],
		};
		currentRuntime.foreground = undefined;
		rerender((value) => value + 1);
		activateStructural();
	}, [currentState, foreground, identity, layout]);

	const state =
		runtime.data.pages.length > 0 ? materializeSavedViewData(runtime.data, layout) : currentState;
	const isLoadingMore = foreground?.phase === "load-more" && currentState.status === "loading";

	useEntityUpdates({
		blocked: runtime.foregroundBusy || runtime.manual,
		entityIds: state.status === "ready" ? state.entityIds : [],
		owner: `saved-view:${scope.serverUrl}:${scope.userId}:${scope.record.slug}`,
		onDrain: () => triggerStructural(false),
		onBatch: (updates) =>
			Effect.gen(function* () {
				const currentCache = cacheRef.current;
				const targetLayout = currentCache.activeLayout;
				const targetRuntime = currentCache.layouts[targetLayout];
				if (!targetRuntime || targetRuntime.data.pages.length === 0) {
					return;
				}
				const token = operationToken(currentCache, targetLayout);
				const loaded = new Set(targetRuntime.data.pages.flatMap((page) => page.entityIds));
				const entityIds = [...new Set(updates.map((update) => update.entityId))].filter(
					(entityId) => loaded.has(entityId),
				);
				if (entityIds.length === 0) {
					return;
				}
				markStructuralDirty(targetLayout);
				const record = scope.record;
				const response = yield* executeRyotQL(
					scope.serverUrl,
					buildSavedViewHydrationDocument({
						entityIds,
						queryDocument: record.layouts[targetLayout].queryDocument,
						entityIdField: record.layouts[targetLayout].entityIdField,
					}),
				);
				const decoded = yield* decodeSavedViewResponse(response, record, targetLayout);
				const latestCache = cacheRef.current;
				const latestRuntime = latestCache.layouts[targetLayout];
				if (!latestRuntime) {
					return;
				}
				if (
					!isSavedViewOperationCurrent(token, operationToken(latestCache, latestCache.activeLayout))
				) {
					if (
						latestCache.identity === token.identity &&
						latestCache.activeLayout === token.layout
					) {
						markStructuralDirty(targetLayout);
					}
					return;
				}
				const requested = new Set(entityIds);
				latestRuntime.data = patchSavedViewItems(
					latestRuntime.data,
					decoded.data.items.filter((item) => requested.has(item.entityId)),
				);
				rerender((value) => value + 1);
			}),
	});

	useEffect(() => {
		activateStructural();
	}, [identity, layout]);

	const triggerStructuralFromEffect = useEffectEvent(() => triggerStructural(false));
	useEffect(() => {
		let wasConnected: boolean | undefined;
		const appStateSubscription = AppState.addEventListener("change", (nextState) => {
			if (nextState === "active") {
				triggerStructuralFromEffect();
			}
		});
		const networkSubscription = Network.addNetworkStateListener(({ isConnected }) => {
			if (isConnected === true && wasConnected === false) {
				triggerStructuralFromEffect();
			}
			if (isConnected !== undefined) {
				wasConnected = isConnected;
			}
		});
		return () => {
			appStateSubscription.remove();
			networkSubscription.remove();
		};
	}, [identity]);

	const refresh = () => {
		if (runtime.data.pages.length > 0) {
			triggerStructural(true);
			return;
		}
		refreshCurrent();
	};
	const loadMore = () => {
		if (foreground?.phase === "load-more") {
			if (currentState.status !== "loading") {
				refreshCurrent();
			}
			return;
		}
		if (state.status !== "ready" || !state.data.pageInfo.hasMore) {
			return;
		}
		const cursor = state.data.pageInfo.nextCursor;
		if (!cursor) {
			return;
		}
		runtime.structural.generation += 1;
		runtime.foregroundBusy = true;
		runtime.foreground = {
			generation: runtime.structural.generation,
			phase: "load-more",
			queryDocument: withSavedViewCursor(scope.record.layouts[layout].queryDocument, cursor),
		};
		rerender((value) => value + 1);
	};

	return { state, refresh, loadMore, isLoadingMore };
};

function useSavedViewFailureLogging(
	label: string,
	state: { readonly status: string; readonly cause?: unknown },
) {
	useEffect(() => {
		if (state.status !== "transport-error" && state.status !== "malformed") {
			return;
		}
		const detail = Cause.isCause(state.cause) ? Cause.pretty(state.cause) : String(state.cause);
		Effect.runSync(Effect.logWarning(`${label} ${state.status}`, detail));
	}, [label, state]);
}

export function SavedViewRuntime(props: {
	readonly scope: Scope;
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
	readonly scope: Scope;
	readonly assets: ReturnType<typeof collectManagedAssets>;
	readonly children: (assets: SavedViewManagedAssetsState) => React.ReactNode;
}) {
	const state = useAtomValue(
		savedViewManagedAssetsStateAtom({ ...props.scope, assets: props.assets }),
	);
	useSavedViewFailureLogging("saved-view managed asset resolution", state);
	return <>{props.children(state)}</>;
}
