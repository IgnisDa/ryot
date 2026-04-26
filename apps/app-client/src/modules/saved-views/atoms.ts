import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import {
	buildSavedViewRecordDocument,
	buildSavedViewRecordsDocument,
} from "@ryot/ryotql-recipes/saved-view-records";
import { stableStringify } from "@ryot/ts-utils/json";
import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appQueryClient } from "@/api/query-client";
import { serverStorageRuntime } from "@/modules/server/storage";

export const createSavedViewAtom = appQueryClient.mutation("savedViews", "create");

export const savedViewsAtom = appQueryClient.query("ryotql", "execute", {
	payload: buildSavedViewRecordsDocument({ includeDisabled: true, limit: 10, page: 1 }),
});

type SavedViewRecordRequest = { slug: string; userId: string; serverUrl: string };

const savedViewRecordFamily = Atom.family((key: string) => {
	const [, , slug] = JSON.parse(key) as [string, string, string];
	return appQueryClient.query("ryotql", "execute", {
		payload: buildSavedViewRecordDocument({ slug }),
	});
});

export const savedViewRecordAtom = (request: SavedViewRecordRequest) =>
	savedViewRecordFamily(stableStringify([request.serverUrl, request.userId, request.slug]));

type SavedViewResultRequest = {
	userId: string;
	serverUrl: string;
	queryDocument: RyotQLDocument;
};

const savedViewResultFamily = Atom.family((key: string) => {
	const [, , payload] = JSON.parse(key) as [string, string, RyotQLDocument];
	return appQueryClient.query("ryotql", "execute", { payload });
});

export const savedViewResultAtom = (request: SavedViewResultRequest) =>
	savedViewResultFamily(
		stableStringify([request.serverUrl, request.userId, request.queryDocument]),
	);

type ManagedAssetResolutionRequest = {
	userId: string;
	serverUrl: string;
	assets: readonly ManagedAssetLocator[];
};

const managedAssetResolutionFamily = Atom.family((key: string) => {
	const [, , assets] = JSON.parse(key) as [string, string, ManagedAssetLocator[]];
	return appQueryClient
		.query("uploads", "resolveDownloads", { payload: { assets } })
		.pipe(Atom.withRefresh("14 minutes"));
});

export const managedAssetResolutionAtom = (request: ManagedAssetResolutionRequest) => {
	const assets = [
		...new Map(request.assets.map((asset) => [`${asset.type}:${asset.key}`, asset])).values(),
	].sort((left, right) => `${left.type}:${left.key}`.localeCompare(`${right.type}:${right.key}`));
	return managedAssetResolutionFamily(stableStringify([request.serverUrl, request.userId, assets]));
};

export const savedViewLayoutAtom = Atom.family((viewSlug: string) =>
	Atom.kvs({
		runtime: serverStorageRuntime,
		defaultValue: () => "grid" as const,
		key: `saved-view-layout:${viewSlug}`,
		schema: Schema.Literals(["grid", "list", "table"]),
	}),
);
