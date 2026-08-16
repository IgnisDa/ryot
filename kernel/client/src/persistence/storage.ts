import { Slug } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { parseServerOrigin, type ServerOrigin } from "#/api/origin";
import { apiScopeKey, type ApiScope } from "#/api/scope";
import { isThemePreference, type ThemePreference } from "#/modules/theme/preference";

export const RYOT_STORAGE_PREFIX = "ryot:";
export const THEME_PREFERENCE_KEY = `${RYOT_STORAGE_PREFIX}theme`;
export const SERVER_SELECTION_KEY = `${RYOT_STORAGE_PREFIX}server-url`;
export const lastWorkspaceKey = (scope: ApiScope) =>
	`${RYOT_STORAGE_PREFIX}workspace:${apiScopeKey(scope)}`;

export type BrowserStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const browserStorage = () => (typeof localStorage === "undefined" ? undefined : localStorage);
const isWorkspaceSlug = Schema.is(Slug);

const makeStorage = (storage: BrowserStorage | undefined): ClientStorage["Service"] => ({
	clearServerSelection: Effect.sync(() => storage?.removeItem(SERVER_SELECTION_KEY)),
	remove: (keys) => Effect.sync(() => keys.forEach((key) => storage?.removeItem(key))),
	setServerSelection: (origin) => Effect.sync(() => storage?.setItem(SERVER_SELECTION_KEY, origin)),
	setThemePreference: (preference) =>
		Effect.sync(() => storage?.setItem(THEME_PREFERENCE_KEY, preference)),
	setLastWorkspace: (scope, slug) =>
		Effect.sync(() => {
			if (isWorkspaceSlug(slug)) {
				storage?.setItem(lastWorkspaceKey(scope), slug);
			}
		}),
	getThemePreference: Effect.sync(() => {
		const value = storage?.getItem(THEME_PREFERENCE_KEY);
		return isThemePreference(value) ? value : "system";
	}),
	getLastWorkspace: (scope) =>
		Effect.sync(() => {
			const value = storage?.getItem(lastWorkspaceKey(scope));
			return isWorkspaceSlug(value) ? value : null;
		}),
	getServerSelection: Effect.sync(() => {
		const value = storage?.getItem(SERVER_SELECTION_KEY);
		if (value === null || value === undefined) {
			return null;
		}
		const result = parseServerOrigin(value);
		return result.ok ? result.origin : null;
	}),
});

export class ClientStorage extends Context.Service<
	ClientStorage,
	{
		readonly clearServerSelection: Effect.Effect<void>;
		readonly getThemePreference: Effect.Effect<ThemePreference>;
		readonly getServerSelection: Effect.Effect<ServerOrigin | null>;
		readonly remove: (keys: readonly string[]) => Effect.Effect<void>;
		readonly setServerSelection: (origin: ServerOrigin) => Effect.Effect<void>;
		readonly getLastWorkspace: (scope: ApiScope) => Effect.Effect<string | null>;
		readonly setLastWorkspace: (scope: ApiScope, slug: string) => Effect.Effect<void>;
		readonly setThemePreference: (preference: ThemePreference) => Effect.Effect<void>;
	}
>()("ClientStorage") {
	static readonly layer = Layer.effect(
		this,
		Effect.sync(() => makeStorage(browserStorage())),
	);
}

export const clientStorageLayer = (storage: BrowserStorage | undefined) =>
	Layer.succeed(ClientStorage, makeStorage(storage));
