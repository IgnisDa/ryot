import { buildSavedViewRecordDocument } from "@ryot/ryotql-recipes/saved-view-records";
import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appQueryClient } from "@/api/query-client";
import { keyedRequestFamily, scopedReactivityKey } from "@/api/request-key";
import { appStorageRuntime } from "@/persistence/storage";

import {
	canonicalManagedAssetRequest,
	savedViewRecordRequestKey,
	savedViewResultRequestKey,
	type ManagedAssetResolutionRequest,
	type SavedViewRecordRequest,
	type SavedViewResultRequest,
} from "./atom-requests";
import { type SavedViewLayoutStorageScope, savedViewLayoutStorageKey } from "./storage";

export const savedViewRecordAtom = keyedRequestFamily(
	savedViewRecordRequestKey,
	(request: SavedViewRecordRequest) => {
		return appQueryClient.query("ryotql", "execute", {
			payload: buildSavedViewRecordDocument({ slug: request.slug }),
			reactivityKeys: scopedReactivityKey("saved-view-record", request),
		});
	},
);

export const savedViewResultAtom = keyedRequestFamily(
	savedViewResultRequestKey,
	(request: SavedViewResultRequest) =>
		appQueryClient.query("ryotql", "execute", {
			payload: request.queryDocument,
			reactivityKeys: scopedReactivityKey("saved-view-result", request),
		}),
);

export const managedAssetResolutionAtom = (request: ManagedAssetResolutionRequest) => {
	const canonical = canonicalManagedAssetRequest(request);
	return managedAssetResolutionFamily(canonical);
};

const managedAssetResolutionFamily = keyedRequestFamily(
	(request: ReturnType<typeof canonicalManagedAssetRequest>) => request.key,
	(request: ReturnType<typeof canonicalManagedAssetRequest>) =>
		appQueryClient
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
