import { Effect, Layer } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { Atom } from "effect/unstable/reactivity";
import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

import { appStorageKey, ownedAppStorageKeys } from "./keys";

const mmkv = Platform.OS === "web" ? undefined : createMMKV({ id: "ryot-app" });

const getNativeKeys = () => mmkv?.getAllKeys() ?? [];
const getWebKeys = () =>
	typeof localStorage === "undefined"
		? []
		: Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
				(key): key is string => key !== null,
			);

const getOwnedKeys = () =>
	ownedAppStorageKeys(Platform.OS === "web" ? getWebKeys() : getNativeKeys());

const removeOwnedKeys = () => {
	for (const key of getOwnedKeys()) {
		if (Platform.OS === "web") {
			localStorage.removeItem(key);
		} else {
			mmkv?.remove(key);
		}
	}
};

export const appStorageLayer = Layer.sync(KeyValueStore.KeyValueStore, () =>
	KeyValueStore.makeStringOnly({
		clear: Effect.sync(removeOwnedKeys),
		size: Effect.sync(() => getOwnedKeys().length),
		get: (key) =>
			Effect.sync(() =>
				Platform.OS === "web"
					? (localStorage.getItem(appStorageKey(key)) ?? undefined)
					: mmkv?.getString(appStorageKey(key)),
			),
		remove: (key) =>
			Effect.sync(() => {
				if (Platform.OS === "web") {
					localStorage.removeItem(appStorageKey(key));
				} else {
					mmkv?.remove(appStorageKey(key));
				}
			}),
		set: (key, value) =>
			Effect.sync(() => {
				if (Platform.OS === "web") {
					localStorage.setItem(appStorageKey(key), value);
				} else {
					mmkv?.set(appStorageKey(key), value);
				}
			}),
	}),
);

export const appStorageRuntime = Atom.runtime(appStorageLayer);

export const clearAppPersistence = () => removeOwnedKeys();
