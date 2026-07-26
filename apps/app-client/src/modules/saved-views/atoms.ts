import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appQueryClient, appQueryClientLive } from "@/api/query-client";
import { keyedRequestFamily, scopedReactivityKey } from "@/api/request-key";
import { appStorageRuntime } from "@/persistence/storage";

import { canonicalManagedAssetRequest, type ManagedAssetResolutionRequest } from "./atom-requests";
import { makeSavedViewRecordAtom } from "./saved-view-record-atom";
import { type SavedViewLayoutStorageScope, savedViewLayoutStorageKey } from "./storage";

export const savedViewRecordAtom = makeSavedViewRecordAtom(appQueryClientLive);

export const managedAssetResolutionAtom = (request: ManagedAssetResolutionRequest) => {
	const canonical = canonicalManagedAssetRequest(request);
	return managedAssetResolutionFamily(canonical);
};

const managedAssetResolutionFamily = keyedRequestFamily(
	(request: ReturnType<typeof canonicalManagedAssetRequest>) => request.key,
	(request: ReturnType<typeof canonicalManagedAssetRequest>) =>
		appQueryClient(request.scope.serverUrl)
			.query("uploads", "resolveDownloads", {
				payload: { assets: request.assets },
				reactivityKeys: scopedReactivityKey("managed-assets", request.scope),
			})
			.pipe(Atom.withRefresh("14 minutes")),
);

const savedViewLayoutFamily = Atom.family((key: string) =>
	Atom.kvs({
		key,
		runtime: appStorageRuntime,
		defaultValue: () => "grid" as const,
		schema: Schema.Literals(["grid", "list", "table"]),
	}),
);

export const savedViewLayoutAtom = (scope: SavedViewLayoutStorageScope) =>
	savedViewLayoutFamily(savedViewLayoutStorageKey(scope));
