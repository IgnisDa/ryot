import {
	EntityBrowserLayout,
	type EntityBrowserLayout as SavedViewLayout,
} from "@ryot-app/contract/modules/saved-views/schemas";
import {
	type PluginSlug,
	SandboxProviderId,
	Slug,
	type SandboxProviderId as ProviderId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";

import { parseServerOrigin, type ServerOrigin } from "#/api/origin";
import { apiScopeKey, type ApiScope } from "#/api/scope";
import { isThemePreference, type ThemePreference } from "#/modules/theme/preference";

export const RYOT_STORAGE_PREFIX = "ryot:";
export const THEME_PREFERENCE_KEY = `${RYOT_STORAGE_PREFIX}theme`;
export const SERVER_SELECTION_KEY = `${RYOT_STORAGE_PREFIX}server-url`;
export const lastWorkspaceKey = (scope: ApiScope) =>
	`${RYOT_STORAGE_PREFIX}workspace:${apiScopeKey(scope)}`;
export const savedViewLayoutKey = (scope: ApiScope, slug: string) =>
	`${RYOT_STORAGE_PREFIX}saved-view-layout:${apiScopeKey(scope)}:${slug}`;
export const rememberedProviderKey = (scope: ApiScope, entitySchemaSlug: string) =>
	`${RYOT_STORAGE_PREFIX}remembered-provider:${apiScopeKey(scope)}:${entitySchemaSlug}`;

export const pluginStorageKey = (scope: ApiScope, pluginSlug: PluginSlug, key: string) =>
	`${RYOT_STORAGE_PREFIX}plugin-storage:${apiScopeKey(scope)}:${pluginSlug}:${key}`;

export class PluginStorageQuotaError extends Data.TaggedError("PluginStorageQuotaError") {}

export type BrowserStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const browserStorage = () => (typeof localStorage === "undefined" ? undefined : localStorage);
const isWorkspaceSlug = Schema.is(Slug);
const isSavedViewLayout = Schema.is(EntityBrowserLayout);
const isSandboxProviderId = Schema.is(SandboxProviderId);
const decodePluginValue = Schema.decodeUnknownOption(Schema.fromJsonString(JsonValue));

const makeStorage = (storage: BrowserStorage | undefined): ClientStorage["Service"] => ({
	clearServerSelection: Effect.sync(() => storage?.removeItem(SERVER_SELECTION_KEY)),
	remove: (keys) => Effect.sync(() => keys.forEach((key) => storage?.removeItem(key))),
	setServerSelection: (origin) => Effect.sync(() => storage?.setItem(SERVER_SELECTION_KEY, origin)),
	setThemePreference: (preference) =>
		Effect.sync(() => storage?.setItem(THEME_PREFERENCE_KEY, preference)),
	setSavedViewLayout: (scope, slug, layout) =>
		Effect.sync(() => storage?.setItem(savedViewLayoutKey(scope, slug), layout)),
	removePluginValue: (scope, pluginSlug, key) =>
		Effect.sync(() => storage?.removeItem(pluginStorageKey(scope, pluginSlug, key))),
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
	setRememberedProvider: (scope, entitySchemaSlug, providerId) =>
		Effect.sync(() => storage?.setItem(rememberedProviderKey(scope, entitySchemaSlug), providerId)),
	getLastWorkspace: (scope) =>
		Effect.sync(() => {
			const value = storage?.getItem(lastWorkspaceKey(scope));
			return isWorkspaceSlug(value) ? value : null;
		}),
	getSavedViewLayout: (scope, slug) =>
		Effect.sync(() => {
			const value = storage?.getItem(savedViewLayoutKey(scope, slug));
			return isSavedViewLayout(value) ? value : "grid";
		}),
	getRememberedProvider: (scope, entitySchemaSlug) =>
		Effect.sync(() => {
			const value = storage?.getItem(rememberedProviderKey(scope, entitySchemaSlug));
			return isSandboxProviderId(value) ? value : null;
		}),
	setPluginValue: (scope, pluginSlug, key, value) =>
		Effect.try({
			catch: () => new PluginStorageQuotaError(),
			try: () => storage?.setItem(pluginStorageKey(scope, pluginSlug, key), JSON.stringify(value)),
		}),
	getServerSelection: Effect.sync(() => {
		const value = storage?.getItem(SERVER_SELECTION_KEY);
		if (value === null || value === undefined) {
			return null;
		}
		const result = parseServerOrigin(value);
		return result.ok ? result.origin : null;
	}),
	getPluginValue: (scope, pluginSlug, key) =>
		Effect.sync(() => {
			const value = storage?.getItem(pluginStorageKey(scope, pluginSlug, key));
			return value === null || value === undefined
				? null
				: Option.getOrNull(decodePluginValue(value));
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
		readonly getSavedViewLayout: (scope: ApiScope, slug: string) => Effect.Effect<SavedViewLayout>;
		readonly getRememberedProvider: (
			scope: ApiScope,
			entitySchemaSlug: string,
		) => Effect.Effect<ProviderId | null>;
		readonly setRememberedProvider: (
			scope: ApiScope,
			entitySchemaSlug: string,
			providerId: ProviderId,
		) => Effect.Effect<void>;
		readonly setSavedViewLayout: (
			scope: ApiScope,
			slug: string,
			layout: SavedViewLayout,
		) => Effect.Effect<void>;
		readonly getPluginValue: (
			scope: ApiScope,
			pluginSlug: PluginSlug,
			key: string,
		) => Effect.Effect<JsonValue | null>;
		readonly setPluginValue: (
			scope: ApiScope,
			pluginSlug: PluginSlug,
			key: string,
			value: JsonValue,
		) => Effect.Effect<void, PluginStorageQuotaError>;
		readonly removePluginValue: (
			scope: ApiScope,
			pluginSlug: PluginSlug,
			key: string,
		) => Effect.Effect<void>;
	}
>()("ClientStorage") {
	static readonly layer = Layer.effect(
		this,
		Effect.sync(() => makeStorage(browserStorage())),
	);
}

export const clientStorageLayer = (storage: BrowserStorage | undefined) =>
	Layer.succeed(ClientStorage, makeStorage(storage));
