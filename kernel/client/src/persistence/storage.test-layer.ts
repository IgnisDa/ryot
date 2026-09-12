import { Context, Effect, Layer } from "effect";

import { ClientStorage, clientStorageLayer, type BrowserStorage } from "#/persistence/storage";

export const makeClientStorageStub = (
	overrides: Partial<ClientStorage["Service"]> = {},
): ClientStorage["Service"] => ({
	remove: () => Effect.void,
	clearServerSelection: Effect.void,
	setPluginValue: () => Effect.void,
	setLastWorkspace: () => Effect.void,
	removePluginValue: () => Effect.void,
	setSavedViewLayout: () => Effect.void,
	setServerSelection: () => Effect.void,
	setThemePreference: () => Effect.void,
	setRememberedProvider: () => Effect.void,
	getServerSelection: Effect.succeed(null),
	getPluginValue: () => Effect.succeed(null),
	getLastWorkspace: () => Effect.succeed(null),
	getRememberedProvider: () => Effect.succeed(null),
	getThemePreference: Effect.succeed("system" as const),
	getSavedViewLayout: () => Effect.succeed("grid" as const),
	...overrides,
});

export const makeClientStorage = (overrides: Partial<ClientStorage["Service"]> = {}) =>
	Layer.succeed(ClientStorage, makeClientStorageStub(overrides));

export class FakeBrowserStorage extends Context.Service<
	FakeBrowserStorage,
	{
		readonly values: Effect.Effect<ReadonlyMap<string, string>>;
		readonly seed: (key: string, value: string) => Effect.Effect<void>;
	}
>()("test/FakeBrowserStorage") {}

export const fakeClientStorageLayer = (
	options: {
		readonly entries?: ReadonlyArray<readonly [string, string]>;
		readonly setItem?: BrowserStorage["setItem"];
	} = {},
) =>
	Layer.unwrap(
		Effect.sync(() => {
			const values = new Map(options.entries);
			return Layer.merge(
				clientStorageLayer({
					removeItem: (key) => values.delete(key),
					getItem: (key) => values.get(key) ?? null,
					setItem: options.setItem ?? ((key, value) => values.set(key, value)),
				}),
				Layer.succeed(FakeBrowserStorage, {
					values: Effect.sync(() => new Map(values)),
					seed: (key, value) => Effect.sync(() => void values.set(key, value)),
				}),
			);
		}),
	);
