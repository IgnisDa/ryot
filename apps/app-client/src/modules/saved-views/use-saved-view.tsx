import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { Cause, Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";

import { keyedRequestFamily, scopedRequestKey } from "@/api/request-key";
import { useEntityInterest } from "@/modules/entity-interest/provider";

import { withSavedViewCursor } from "./atom-requests";
import {
	managedAssetResolutionAtom,
	savedViewLayoutAtom,
	savedViewRecordAtom,
	savedViewResultAtom,
} from "./atoms";
import type { collectManagedAssets } from "./display-data";
import type { SavedViewLayout } from "./saved-view-layout-selector";
import {
	mapManagedAssetResolution,
	mapSavedViewRecord,
	mapSavedViewResult,
	combineSavedViewPages,
	type SavedViewManagedAssetsState,
	type SavedViewResultState,
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

type SavedViewPage = {
	readonly state?: SavedViewResultState;
	readonly queryDocument: RyotQLDocument;
	readonly phase: "initial" | "load-more" | "ready";
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
	const identity = `${scope.serverUrl}:${scope.userId}:${scope.record.slug}:${scope.record.updatedAt}`;
	const cacheRef = useRef<{
		identity: string;
		layouts: Partial<Record<SavedViewLayout, SavedViewPage[]>>;
	}>(undefined);
	const [, rerender] = useState(0);
	if (!cacheRef.current || cacheRef.current.identity !== identity) {
		cacheRef.current = { identity, layouts: {} };
	}
	const cache = cacheRef.current;
	const pages =
		cache.layouts[layout] ??
		(cache.layouts[layout] = [
			{
				phase: "initial",
				queryDocument: scope.record.layouts[layout].queryDocument,
			},
		]);
	const currentPage = pages[pages.length - 1];
	const atom = savedViewResultStateAtom({
		...scope,
		layout,
		queryDocument: currentPage.queryDocument,
	});
	const currentState = useAtomValue(atom);
	const refreshCurrent = useAtomRefresh(atom);

	useSavedViewFailureLogging("saved-view result", currentState);
	useEffect(() => {
		if (currentState.status === "loading" || currentPage.state === currentState) {
			return;
		}
		const activePages = cacheRef.current?.layouts[layout];
		if (activePages?.at(-1) !== currentPage) {
			return;
		}
		if (currentState.status === "ready") {
			if (!cacheRef.current) {
				return;
			}
			cacheRef.current.layouts[layout] = [
				...activePages.slice(0, -1),
				{ ...currentPage, phase: "ready", state: currentState },
			];
			rerender((value) => value + 1);
		}
	}, [currentPage, currentState, layout, rerender]);

	const readyPages = pages.flatMap((page) => (page.state?.status === "ready" ? [page.state] : []));
	const state = readyPages.length > 0 ? combineSavedViewPages(readyPages) : currentState;
	const refresh = () => refreshCurrent();
	const loadMore = () => {
		if (currentPage.phase === "load-more") {
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
		cache.layouts[layout] = [
			...pages,
			{
				phase: "load-more",
				queryDocument: withSavedViewCursor(currentPage.queryDocument, cursor),
			},
		];
		rerender((value) => value + 1);
	};
	return {
		state,
		refresh,
		loadMore,
		isLoadingMore: currentPage.phase === "load-more" && currentState.status === "loading",
	};
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
	readonly onEntityUpdated: () => void;
	readonly entityIds: readonly string[];
	readonly scope: Scope & { readonly viewSlug: string };
	readonly assets: ReturnType<typeof collectManagedAssets>;
	readonly children: (assets: SavedViewManagedAssetsState) => React.ReactNode;
}) {
	useEntityInterest(
		`saved-view:${props.scope.serverUrl}:${props.scope.userId}:${props.scope.viewSlug}`,
		props.entityIds,
		props.onEntityUpdated,
	);
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
