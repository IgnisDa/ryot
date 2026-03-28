import { Effect, Schema } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { Atom } from "effect/unstable/reactivity";

import { appStorageRuntime } from "@/persistence/storage";

import { CLOUD_URL, normalizeServerOrigin } from "./url";

const serverUrlKey = "server-url";
const serverUrlSchema = Schema.NullOr(Schema.String);

export const serverUrlAtom = Atom.kvs({
	key: serverUrlKey,
	schema: serverUrlSchema,
	defaultValue: () => null,
	runtime: appStorageRuntime,
});

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
			Effect.map((serverUrl) => normalizeServerOrigin(serverUrl ?? CLOUD_URL)),
		);
});
