import { Effect, Layer } from "effect";

import { ClientStorage } from "#/persistence/storage";

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
