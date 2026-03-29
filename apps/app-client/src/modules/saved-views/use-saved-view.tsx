import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { Cause, Effect } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Network from "expo-network";
import { useEffect, useRef, useState } from "react";
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
	dirty: boolean;
	inFlight: boolean;
	generation: number;
	firstDirtyAt: number | undefined;
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

const STRUCTURAL_DIRTY_MAX_MS = 30_000;

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
	data: { itemsById: new Map(), pages: [] },
	foreground: { generation, queryDocument, phase: "initial" },
	structural: { dirty: false, generation, inFlight: false, firstDirtyAt: undefined },
});

const markStructuralDirty = (runtime: LayoutRuntime) => {
	runtime.structural.dirty = true;
	runtime.structural.firstDirtyAt ??= Date.now();
};

const operationToken = (cache: RuntimeCache, layout: SavedViewLayout) => ({
	layout,
	identity: cache.identity,
	generation: cache.layouts[layout]?.structural.generation ?? -1,
});

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
	const cacheRef = useRef<RuntimeCache>(undefined);
	const controllersRef = useRef(new Set<AbortController>());
	const startStructuralOperationRef = useRef<(manual: boolean) => Promise<void>>(() =>
		Promise.resolve(),
	);
	const startStructural = useRef((manual: boolean) =>
		startStructuralOperationRef.current(manual),
	).current;
	const [, rerender] = useState(0);

	if (!cacheRef.current || cacheRef.current.identity !== identity) {
		cacheRef.current = { activeLayout: layout, identity, layouts: {} };
	}
	const cache = cacheRef.current;
	let runtime = cache.layouts[layout];
	if (!runtime) {
		runtime = createLayoutRuntime(scope.record.layouts[layout].queryDocument);
		cache.layouts[layout] = runtime;
	}
	if (cache.activeLayout !== layout) {
		const previous = cache.layouts[cache.activeLayout];
		if (previous) {
			previous.structural.generation += 1;
			previous.foreground = undefined;
			previous.foregroundBusy = false;
		}
		cache.activeLayout = layout;
		runtime.structural.generation += 1;
		if (runtime.data.pages.length === 0) {
			runtime.foreground = {
				generation: runtime.structural.generation,
				phase: "initial",
				queryDocument: scope.record.layouts[layout].queryDocument,
			};
			runtime.foregroundBusy = true;
		}
	}

	const foreground = runtime.foreground;
	const queryDocument =
		foreground?.queryDocument ??
		runtime.data.pages.at(-1)?.queryDocument ??
		scope.record.layouts[layout].queryDocument;
	const atom = savedViewResultStateAtom({ ...scope, layout, queryDocument });
	const currentState = useAtomValue(atom);
	const refreshCurrent = useAtomRefresh(atom);
	runtime.foregroundBusy = foreground !== undefined && currentState.status === "loading";

	useSavedViewFailureLogging("saved-view result", currentState);
	useEffect(() => {
		if (!foreground || currentState.status === "loading") {
			return;
		}
		const currentCache = cacheRef.current;
		const currentRuntime = currentCache?.layouts[layout];
		if (
			!currentCache ||
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
		if (currentRuntime.structural.dirty) {
			queueMicrotask(() => void startStructural(false));
		}
	}, [currentState, foreground, identity, layout, startStructural]);

	startStructuralOperationRef.current = async (manual: boolean) => {
		const currentCache = cacheRef.current;
		if (!currentCache) {
			return;
		}
		const targetLayout = currentCache.activeLayout;
		const targetRuntime = currentCache.layouts[targetLayout];
		if (
			!targetRuntime ||
			targetRuntime.data.pages.length === 0 ||
			targetRuntime.foregroundBusy ||
			targetRuntime.structural.inFlight
		) {
			return;
		}

		const token = operationToken(currentCache, targetLayout);
		const record = scope.record;
		const pagesToLoad = targetRuntime.data.pages.length;
		const controller = new AbortController();
		controllersRef.current.add(controller);
		targetRuntime.manual = manual;
		targetRuntime.structural.dirty = false;
		targetRuntime.structural.inFlight = true;
		targetRuntime.structural.firstDirtyAt = undefined;
		rerender((value) => value + 1);

		let completed = false;
		try {
			const replacement = await fetchSavedViewReplacement({
				pagesToLoad,
				signal: controller.signal,
				queryDocument: record.layouts[targetLayout].queryDocument,
				execute: (document, signal) => executeRyotQL(scope.serverUrl, document, signal),
				decode: (response) => {
					const decoded = mapSavedViewResult(AsyncResult.success(response), record, targetLayout);
					if (decoded.status !== "ready") {
						throw decoded.status === "loading"
							? new Error("Unexpected loading state")
							: decoded.cause;
					}
					return decoded;
				},
			});
			const latestCache = cacheRef.current;
			const latestRuntime = latestCache?.layouts[targetLayout];
			if (
				latestCache &&
				latestRuntime &&
				isSavedViewOperationCurrent(token, operationToken(latestCache, latestCache.activeLayout))
			) {
				latestRuntime.data = replacement;
				latestRuntime.foreground = undefined;
				latestRuntime.foregroundBusy = false;
				latestRuntime.structural.generation += 1;
				completed = true;
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				Effect.runSync(Effect.logWarning("saved-view structural refresh failed", String(error)));
			}
		} finally {
			controllersRef.current.delete(controller);
			const latestCache = cacheRef.current;
			const latestRuntime =
				latestCache?.identity === token.identity ? latestCache.layouts[targetLayout] : undefined;
			if (latestRuntime) {
				latestRuntime.manual = false;
				latestRuntime.structural.inFlight = false;
				if (!completed) {
					markStructuralDirty(latestRuntime);
				}
				rerender((value) => value + 1);
				if (completed && latestRuntime.structural.dirty) {
					queueMicrotask(() => void startStructural(false));
				}
			}
		}
	};

	const state =
		runtime.data.pages.length > 0 ? materializeSavedViewData(runtime.data, layout) : currentState;
	const isLoadingMore = foreground?.phase === "load-more" && currentState.status === "loading";

	useEntityUpdates({
		blocked: runtime.foregroundBusy || runtime.manual,
		entityIds: state.status === "ready" ? state.entityIds : [],
		owner: `saved-view:${scope.serverUrl}:${scope.userId}:${scope.record.slug}`,
		onDrain: () => void startStructural(false),
		onBatch: async (updates, signal) => {
			const currentCache = cacheRef.current;
			if (!currentCache) {
				return;
			}
			const targetLayout = currentCache.activeLayout;
			const targetRuntime = currentCache.layouts[targetLayout];
			if (!targetRuntime || targetRuntime.data.pages.length === 0) {
				return;
			}
			const token = operationToken(currentCache, targetLayout);
			const loaded = new Set(targetRuntime.data.pages.flatMap((page) => page.entityIds));
			const entityIds = [...new Set(updates.map((update) => update.entityId))].filter((entityId) =>
				loaded.has(entityId),
			);
			if (entityIds.length === 0) {
				return;
			}
			markStructuralDirty(targetRuntime);
			rerender((value) => value + 1);
			const record = scope.record;
			const response = await executeRyotQL(
				scope.serverUrl,
				buildSavedViewHydrationDocument({
					entityIds,
					queryDocument: record.layouts[targetLayout].queryDocument,
					entityIdField: record.layouts[targetLayout].entityIdField,
				}),
				signal,
			);
			const decoded = mapSavedViewResult(AsyncResult.success(response), record, targetLayout);
			if (decoded.status !== "ready") {
				throw decoded.status === "loading" ? new Error("Unexpected loading state") : decoded.cause;
			}
			const latestCache = cacheRef.current;
			const latestRuntime = latestCache?.layouts[targetLayout];
			if (!latestCache || !latestRuntime) {
				return;
			}
			if (
				!isSavedViewOperationCurrent(token, operationToken(latestCache, latestCache.activeLayout))
			) {
				if (latestCache.identity === token.identity && latestCache.activeLayout === token.layout) {
					markStructuralDirty(latestRuntime);
					rerender((value) => value + 1);
				}
				return;
			}
			const requested = new Set(entityIds);
			latestRuntime.data = patchSavedViewItems(
				latestRuntime.data,
				decoded.data.items.filter((item) => requested.has(item.entityId)),
			);
			rerender((value) => value + 1);
		},
	});

	useEffect(() => {
		const dirtyAt = runtime.structural.firstDirtyAt;
		if (!runtime.structural.dirty || dirtyAt === undefined || runtime.structural.inFlight) {
			return undefined;
		}
		const timer = setTimeout(
			() => void startStructural(false),
			Math.max(0, dirtyAt + STRUCTURAL_DIRTY_MAX_MS - Date.now()),
		);
		return () => {
			clearTimeout(timer);
		};
	}, [
		identity,
		layout,
		runtime.structural.dirty,
		runtime.structural.firstDirtyAt,
		runtime.structural.inFlight,
		startStructural,
	]);

	useEffect(() => {
		let wasConnected: boolean | undefined;
		const appStateSubscription = AppState.addEventListener("change", (nextState) => {
			if (nextState === "active") {
				void startStructural(false);
			}
		});
		const networkSubscription = Network.addNetworkStateListener(({ isConnected }) => {
			if (isConnected === true && wasConnected === false) {
				void startStructural(false);
			}
			if (isConnected !== undefined) {
				wasConnected = isConnected;
			}
		});
		return () => {
			appStateSubscription.remove();
			networkSubscription.remove();
		};
	}, [identity, startStructural]);

	useEffect(
		() => () => {
			for (const controller of controllersRef.current) {
				controller.abort();
			}
			controllersRef.current.clear();
		},
		[],
	);

	const refresh = () => {
		if (runtime.data.pages.length > 0) {
			void startStructural(true);
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
