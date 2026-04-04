import { Effect, Layer, Schema } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { Atom } from "effect/unstable/reactivity";
import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

import { CLOUD_URL } from "@/modules/server/url";

const workspaceKey = "workspace";
const serverUrlKey = "server-url";
const workspaceSchema = Schema.String;
const serverUrlSchema = Schema.NullOr(Schema.String);

export const serverStorageLayer =
	Platform.OS === "web"
		? KeyValueStore.layerStorage(() => localStorage)
		: Layer.sync(KeyValueStore.KeyValueStore, () => {
				const storage = createMMKV();
				return KeyValueStore.makeStringOnly({
					size: Effect.sync(() => storage.length),
					clear: Effect.sync(() => storage.clearAll()),
					remove: (key) => Effect.sync(() => void storage.remove(key)),
					set: (key, value) => Effect.sync(() => storage.set(key, value)),
					get: (key) => Effect.sync(() => storage.getString(key)),
				});
			});

export const serverStorageRuntime = Atom.runtime(serverStorageLayer);

export const serverUrlAtom = Atom.kvs({
	key: serverUrlKey,
	schema: serverUrlSchema,
	defaultValue: () => null,
	runtime: serverStorageRuntime,
});

export const workspaceAtom = Atom.kvs({
	key: workspaceKey,
	schema: workspaceSchema,
	defaultValue: () => "media",
	runtime: serverStorageRuntime,
});

export function clearServerStorage() {
	if (Platform.OS === "web") {
		localStorage.clear();
	} else {
		createMMKV().clearAll();
	}
}

const decodeServerUrl = Schema.decodeEffect(
	Schema.fromJsonString(Schema.toCodecJson(serverUrlSchema)),
);

export const serverUrlReader = Effect.map(KeyValueStore.KeyValueStore, (store) => {
	return () =>
		store.get(serverUrlKey).pipe(
			Effect.flatMap((serverUrl) =>
				serverUrl === undefined ? Effect.succeed(undefined) : decodeServerUrl(serverUrl),
			),
			Effect.orDie,
			Effect.map((serverUrl) => serverUrl ?? CLOUD_URL),
		);
});
