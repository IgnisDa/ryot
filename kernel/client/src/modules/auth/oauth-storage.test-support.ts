import { Context, Effect, Layer, Ref } from "effect";

import { oauthStorageLayer, type OAuthStorageAdapter } from "#/modules/auth/oauth-storage";

export class FakeOAuthStorage extends Context.Service<
	FakeOAuthStorage,
	{
		readonly values: Effect.Effect<ReadonlyMap<string, string>>;
		readonly seed: (key: string, value: string) => Effect.Effect<void>;
	}
>()("test/FakeOAuthStorage") {}

export const fakeOAuthStorageLayer = (overrides: Partial<OAuthStorageAdapter> = {}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const values = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
			const setItem = (key: string, value: string) =>
				Ref.update(values, (current) => new Map(current).set(key, value));
			const adapter: OAuthStorageAdapter = {
				setItem,
				keys: Effect.map(Ref.get(values), (current) => [...current.keys()]),
				getItem: (key) => Effect.map(Ref.get(values), (current) => current.get(key) ?? null),
				removeItem: (key) =>
					Ref.update(values, (current) => {
						const next = new Map(current);
						next.delete(key);
						return next;
					}),
				...overrides,
			};
			return Layer.merge(
				oauthStorageLayer(adapter),
				Layer.succeed(FakeOAuthStorage, { seed: setItem, values: Ref.get(values) }),
			);
		}),
	);
