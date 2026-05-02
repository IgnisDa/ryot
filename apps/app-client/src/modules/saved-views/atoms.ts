import { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import {
	buildSavedViewRecordDocument,
	buildSavedViewRecordsDocument,
} from "@ryot/ryotql-recipes/saved-view-records";
import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appQueryClient } from "@/api/query-client";
import { serverStorageRuntime } from "@/modules/server/storage";

import {
	canonicalManagedAssetRequest,
	savedViewRecordRequestKey,
	savedViewResultRequestKey,
	type ManagedAssetResolutionRequest,
	type SavedViewRecordRequest,
	type SavedViewResultRequest,
} from "./atom-requests";

const savedViewRecordRequestKeySchema = Schema.Tuple([Schema.String, Schema.String, Schema.String]);
const savedViewResultRequestKeySchema = Schema.Tuple([
	Schema.String,
	Schema.String,
	RyotQLDocument,
]);
const managedAssetResolutionRequestKeySchema = Schema.Tuple([
	Schema.String,
	Schema.String,
	Schema.Array(ManagedAssetLocator),
]);

export const createSavedViewAtom = appQueryClient.mutation("savedViews", "create");

export const savedViewsAtom = appQueryClient.query("ryotql", "execute", {
	payload: buildSavedViewRecordsDocument({ includeDisabled: true, limit: 10, page: 1 }),
});

const savedViewRecordFamily = Atom.family((key: string) => {
	const [, , slug] = Schema.decodeUnknownSync(savedViewRecordRequestKeySchema)(JSON.parse(key));
	return appQueryClient.query("ryotql", "execute", {
		payload: buildSavedViewRecordDocument({ slug }),
	});
});

export const savedViewRecordAtom = (request: SavedViewRecordRequest) =>
	savedViewRecordFamily(savedViewRecordRequestKey(request));

const savedViewResultFamily = Atom.family((key: string) => {
	const [, , payload] = Schema.decodeUnknownSync(savedViewResultRequestKeySchema)(JSON.parse(key));
	return appQueryClient.query("ryotql", "execute", { payload });
});

export const savedViewResultAtom = (request: SavedViewResultRequest) =>
	savedViewResultFamily(savedViewResultRequestKey(request));

const managedAssetResolutionFamily = Atom.family((key: string) => {
	const [, , assets] = Schema.decodeUnknownSync(managedAssetResolutionRequestKeySchema)(
		JSON.parse(key),
	);
	return appQueryClient
		.query("uploads", "resolveDownloads", { payload: { assets } })
		.pipe(Atom.withRefresh("14 minutes"));
});

export const managedAssetResolutionAtom = (request: ManagedAssetResolutionRequest) => {
	const { key } = canonicalManagedAssetRequest(request);
	return managedAssetResolutionFamily(key);
};

export const savedViewLayoutAtom = Atom.family((viewSlug: string) =>
	Atom.kvs({
		runtime: serverStorageRuntime,
		defaultValue: () => "grid" as const,
		key: `saved-view-layout:${viewSlug}`,
		schema: Schema.Literals(["grid", "list", "table"]),
	}),
);
