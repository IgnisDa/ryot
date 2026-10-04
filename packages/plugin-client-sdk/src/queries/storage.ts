import type { PluginId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useEffectEvent, useState } from "react";

import { useRyot } from "./provider";

export type PluginStorageState<A> =
	| { readonly status: "loading" }
	| {
			readonly value: A | null;
			readonly status: "ready";
			readonly remove: () => Promise<void>;
			readonly set: (value: A) => Promise<void>;
	  };

export const usePluginStorage = <A>(options: {
	readonly key: string;
	readonly pluginId: PluginId;
	readonly schema: Schema.Codec<A, JsonValue>;
}): PluginStorageState<A> => {
	const client = useRyot();
	const { key, schema, pluginId } = options;
	const identity = JSON.stringify([pluginId, key]);
	const [stored, setStored] = useState<{ readonly identity: string; readonly value: A | null }>();
	const decode = useEffectEvent((value: JsonValue | null) =>
		value === null ? null : Option.getOrNull(Schema.decodeOption(schema)(value)),
	);
	useEffect(() => {
		const fiber = Effect.runFork(
			client.storage.get(pluginId, key).pipe(
				Effect.map(decode),
				Effect.orElseSucceed(() => null),
				Effect.tap((value) =>
					Effect.sync(() => {
						setStored((current) =>
							current?.identity === identity ? current : { value, identity },
						);
					}),
				),
			),
		);
		return () => {
			Effect.runFork(Fiber.interrupt(fiber));
		};
	}, [client, identity, key, pluginId]);
	const set = useCallback(
		(value: A) => {
			const encoded = Schema.encodeSync(schema)(value);
			setStored({ value, identity });
			return Effect.runPromise(client.storage.set(pluginId, key, encoded));
		},
		[client, identity, key, pluginId, schema],
	);
	const remove = useCallback(() => {
		setStored({ identity, value: null });
		return Effect.runPromise(client.storage.remove(pluginId, key));
	}, [client, identity, key, pluginId]);
	return stored?.identity === identity
		? { set, remove, status: "ready", value: stored.value }
		: { status: "loading" };
};
