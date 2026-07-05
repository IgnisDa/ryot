import { Atom, useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as KeyValueStore from "@effect/platform/KeyValueStore";
import { Effect, Layer, Option, Schema } from "effect";
import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

import { CLOUD_URL } from "@/modules/server/url";

const serverUrlKey = "server-url";
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
					get: (key) => Effect.sync(() => Option.fromNullable(storage.getString(key))),
				});
			});

const storageRuntime = Atom.runtime(serverStorageLayer);

export const serverUrlAtom = Atom.kvs({
	key: serverUrlKey,
	runtime: storageRuntime,
	schema: serverUrlSchema,
	defaultValue: () => null,
});

export const useServerUrl = () => useAtomValue(serverUrlAtom);
export const useSetServerUrl = () => useAtomSet(serverUrlAtom);
export const serverUrlReader = Effect.map(KeyValueStore.KeyValueStore, (store) => {
	const serverUrls = store.forSchema(serverUrlSchema);
	return () =>
		serverUrls
			.get(serverUrlKey)
			.pipe(
				Effect.orDie,
				Effect.map(Option.flatMap(Option.fromNullable)),
				Effect.map(Option.getOrElse(() => CLOUD_URL)),
			);
});
