import { makeContractClient } from "@ryot/contract/client";
import { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import { buildNavigationDocument } from "@ryot/ryotql-recipes/navigation";
import { buildNotificationChannelsDocument } from "@ryot/ryotql-recipes/notification-channels";
import {
	buildSavedViewRecordDocument,
	buildSavedViewRecordsDocument,
} from "@ryot/ryotql-recipes/saved-view-records";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";

import { appQueryClient } from "@/api/query-client";
import { serverStorageLayer, serverUrlSchema, workspaceSchema } from "@/modules/server/storage";

const publicApiRuntime = Atom.runtime(FetchHttpClient.layer);
const storageRuntime = Atom.runtime(serverStorageLayer);
const themeSchema = Schema.Literals(["light", "dark", "system"]);

export const connectToServerAtom = publicApiRuntime.fn((serverUrl: string) =>
	makeContractClient(`${serverUrl}/api`).pipe(Effect.flatMap((client) => client.system.health())),
);

export const createSavedViewAtom = appQueryClient.mutation("savedViews", "create");

export const notificationChannelsAtom = appQueryClient.query("ryotql", "execute", {
	payload: buildNotificationChannelsDocument({ limit: 100, page: 1 }),
});

export const navigationAtom = appQueryClient.query("ryotql", "execute", {
	payload: buildNavigationDocument(),
});

const savedViewRecordRequestSchema = Schema.fromJsonString(
	Schema.Struct({ slug: Schema.String, serverUrl: Schema.String, userId: Schema.String }),
);

export const savedViewRecordAtom = Atom.family((serializedRequest: string) => {
	const { slug, serverUrl, userId } = Schema.decodeUnknownSync(savedViewRecordRequestSchema)(
		serializedRequest,
	);
	return appQueryClient.query("ryotql", "execute", {
		reactivityKeys: [serverUrl, userId],
		payload: buildSavedViewRecordDocument({ slug }),
	});
});

const savedViewResultRequestSchema = Schema.fromJsonString(
	Schema.Struct({ queryDocument: RyotQLDocument, serverUrl: Schema.String, userId: Schema.String }),
);

export const savedViewResultAtom = Atom.family((serializedRequest: string) => {
	const { queryDocument, serverUrl, userId } = Schema.decodeUnknownSync(
		savedViewResultRequestSchema,
	)(serializedRequest);
	return appQueryClient.query("ryotql", "execute", {
		payload: queryDocument,
		reactivityKeys: [serverUrl, userId],
	});
});

const managedAssetRequestSchema = Schema.fromJsonString(
	Schema.Struct({
		userId: Schema.String,
		serverUrl: Schema.String,
		assets: Schema.Array(ManagedAssetLocator),
	}),
);

export const managedAssetResolutionAtom = Atom.family((serializedRequest: string) => {
	const { assets, serverUrl, userId } =
		Schema.decodeUnknownSync(managedAssetRequestSchema)(serializedRequest);
	return appQueryClient
		.query("uploads", "resolveDownloads", {
			payload: { assets },
			reactivityKeys: [serverUrl, userId],
		})
		.pipe(Atom.withRefresh("14 minutes"));
});

export const savedViewsAtom = appQueryClient.query("ryotql", "execute", {
	payload: buildSavedViewRecordsDocument({ includeDisabled: true, limit: 10, page: 1 }),
});

export const savedViewLayoutAtom = Atom.family((viewSlug: string) =>
	Atom.kvs({
		runtime: storageRuntime,
		defaultValue: () => "grid" as const,
		key: `saved-view-layout:${viewSlug}`,
		schema: Schema.Literals(["grid", "list", "table"]),
	}),
);

export const serverUrlAtom = Atom.kvs({
	key: "server-url",
	runtime: storageRuntime,
	schema: serverUrlSchema,
	defaultValue: () => null,
});

export const systemConfigAtom = appQueryClient.query("system", "config", {});

export const themeAtom = Atom.kvs({
	key: "theme",
	schema: themeSchema,
	runtime: storageRuntime,
	defaultValue: () => "system" as const,
});

export const workspaceAtom = Atom.kvs({
	key: "workspace",
	runtime: storageRuntime,
	schema: workspaceSchema,
	defaultValue: () => "media",
});
