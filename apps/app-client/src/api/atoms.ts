import { makeContractClient } from "@ryot/contract/client";
import { buildNavigationDocument } from "@ryot/ryotql-recipes/navigation";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";

import { appQueryClient } from "@/api/query-client";
import { serverStorageLayer, serverUrlSchema, workspaceSchema } from "@/modules/server/storage";

const publicApiRuntime = Atom.runtime(FetchHttpClient.layer);
const storageRuntime = Atom.runtime(serverStorageLayer);

export const connectToServerAtom = publicApiRuntime.fn((serverUrl: string) =>
	makeContractClient(`${serverUrl}/api`).pipe(Effect.flatMap((client) => client.system.health())),
);

export const createSavedViewAtom = appQueryClient.mutation("savedViews", "create");

export const notificationChannelsAtom = appQueryClient.query("notifications", "listChannels", {});

export const navigationAtom = appQueryClient.query("ryotql", "execute", {
	payload: buildNavigationDocument(),
});

export const savedViewsAtom = appQueryClient.query("savedViews", "list", {
	query: { includeDisabled: true },
});

export const serverUrlAtom = Atom.kvs({
	key: "server-url",
	runtime: storageRuntime,
	schema: serverUrlSchema,
	defaultValue: () => null,
});

export const systemConfigAtom = appQueryClient.query("system", "config", {});

export const workspaceAtom = Atom.kvs({
	key: "workspace",
	runtime: storageRuntime,
	schema: workspaceSchema,
	defaultValue: () => "media",
});
