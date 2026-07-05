import { Atom, useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as KeyValueStore from "@effect/platform/KeyValueStore";
import { Effect, Layer, Option, Schema } from "effect";
import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

const storageLayer =
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

const storageRuntime = Atom.runtime(storageLayer);
const serverUrlAtom = Atom.kvs({
	key: "server-url",
	runtime: storageRuntime,
	defaultValue: () => null,
	schema: Schema.NullOr(Schema.String),
});

export const useServerUrl = () => useAtomValue(serverUrlAtom);
export const useSetServerUrl = () => useAtomSet(serverUrlAtom);
