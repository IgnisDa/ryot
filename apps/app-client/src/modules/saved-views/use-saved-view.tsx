import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { Cause, Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { useEffect } from "react";

import { keyedRequestFamily, scopedRequestKey } from "@/api/request-key";
import { useEntityInterest } from "@/modules/entity-interest/provider";

import {
	managedAssetResolutionAtom,
	savedViewLayoutAtom,
	savedViewRecordAtom,
	savedViewResultAtom,
} from "./atoms";
import type { SavedViewLayout } from "./saved-view-layout-selector";
import {
	mapManagedAssetResolution,
	mapSavedViewRecord,
	mapSavedViewResult,
	type SavedViewManagedAssetsState,
} from "./state";

type RecordScope = Scope & { readonly slug: string };
type Scope = { readonly serverUrl: string; readonly userId: string };
type ResultScope = Scope & { readonly layout: SavedViewLayout; readonly record: SavedViewRecord };
type ManagedAssetsScope = Scope & {
	readonly assets: ReturnType<typeof collectManagedAssets>;
};

const savedViewRecordStateAtom = keyedRequestFamily(
	(request: RecordScope) => scopedRequestKey(request, request.slug),
	(request: RecordScope) => savedViewRecordAtom(request).pipe(Atom.map(mapSavedViewRecord)),
);

const savedViewResultStateAtom = keyedRequestFamily(
	(request: ResultScope) =>
		scopedRequestKey(request, request.record.slug, request.layout, request.record.updatedAt),
	(request: ResultScope) => {
		const source = savedViewResultAtom({
			userId: request.userId,
			serverUrl: request.serverUrl,
			queryDocument: request.record.layouts[request.layout].queryDocument,
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
	const atom = savedViewResultStateAtom({ ...scope, layout });
	const state = useAtomValue(atom);
	useSavedViewFailureLogging("saved-view result", state);
	return { state, refresh: useAtomRefresh(atom) };
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
