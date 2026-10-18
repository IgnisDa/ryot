import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import {
	EntityBrowserLayout,
	type EntityBrowserLayout as SavedViewLayout,
} from "@ryot-app/contract/modules/saved-views/schemas";
import {
	PluginId,
	type SandboxProviderId as ProviderId,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";

import { parseServerOrigin, type ServerOrigin } from "#/api/origin";
import { type ApiScope, apiScopeKey } from "#/api/scope";
import { DeviceState, emptyDeviceState } from "#/modules/device/state";
import { isThemePreference, type ThemePreference } from "#/modules/theme/preference";

export const RYOT_STORAGE_PREFIX = "ryot:";
export const THEME_PREFERENCE_KEY = `${RYOT_STORAGE_PREFIX}theme`;
export const DEVICE_STATE_KEY = `${RYOT_STORAGE_PREFIX}device-alerts`;
export const SERVER_SELECTION_KEY = `${RYOT_STORAGE_PREFIX}server-url`;
export const lastWorkspaceKey = (scope: ApiScope) =>
	`${RYOT_STORAGE_PREFIX}workspace:${apiScopeKey(scope)}`;
export const savedViewLayoutKey = (scope: ApiScope, slug: string) =>
	`${RYOT_STORAGE_PREFIX}saved-view-layout:${apiScopeKey(scope)}:${slug}`;
export const rememberedProviderKey = (scope: ApiScope, schemaKey: string) =>
	`${RYOT_STORAGE_PREFIX}remembered-provider:${apiScopeKey(scope)}:${schemaKey}`;

export const pluginStorageKey = (scope: ApiScope, pluginId: PluginId, key: string) =>
	`${RYOT_STORAGE_PREFIX}plugin-storage:${identityTupleKey(scope.serverUrl, scope.userId, pluginId, key)}`;

export class PluginStorageQuotaError extends Data.TaggedError("PluginStorageQuotaError") {}
export class PluginStorageAccessError extends Data.TaggedError("PluginStorageAccessError")<{
	readonly cause: unknown;
}> {}

export class DeviceStateAccessError extends Data.TaggedError("DeviceStateAccessError")<{
	readonly cause: unknown;
}> {}

export type BrowserStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const browserStorage = () => {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
};
const isPluginId = Schema.is(PluginId);
const isSavedViewLayout = Schema.is(EntityBrowserLayout);
const isSandboxProviderId = Schema.is(SandboxProviderId);
const decodeDeviceState = Schema.decodeUnknownSync(Schema.fromJsonString(DeviceState));
const encodeDeviceState = Schema.encodeSync(Schema.fromJsonString(DeviceState));
const decodePluginValue = Schema.decodeUnknownOption(Schema.fromJsonString(JsonValue));
const encodePluginValue = Schema.encodeSync(Schema.fromJsonString(JsonValue));
const unavailablePluginStorageError = () =>
	new PluginStorageAccessError({ cause: new Error("Browser storage is unavailable") });
const attemptPluginStorageAccess = <A>(evaluate: () => A) =>
	Effect.try({
		try: evaluate,
		catch: (cause) =>
			cause instanceof PluginStorageAccessError ? cause : new PluginStorageAccessError({ cause }),
	});
const isQuotaExceededError = (cause: unknown) =>
	cause instanceof DOMException && cause.name === "QuotaExceededError";

const makeStorage = (storage: BrowserStorage | undefined): ClientStorage["Service"] => ({
	clearServerSelection: Effect.sync(() => storage?.removeItem(SERVER_SELECTION_KEY)),
	remove: (keys) => Effect.sync(() => keys.forEach((key) => storage?.removeItem(key))),
	setServerSelection: (origin) => Effect.sync(() => storage?.setItem(SERVER_SELECTION_KEY, origin)),
	setThemePreference: (preference) =>
		Effect.sync(() => storage?.setItem(THEME_PREFERENCE_KEY, preference)),
	setLastWorkspace: (scope, pluginId) =>
		Effect.sync(() => storage?.setItem(lastWorkspaceKey(scope), pluginId)),
	setSavedViewLayout: (scope, slug, layout) =>
		Effect.sync(() => storage?.setItem(savedViewLayoutKey(scope, slug), layout)),
	setRememberedProvider: (scope, schemaKey, providerId) =>
		Effect.sync(() => storage?.setItem(rememberedProviderKey(scope, schemaKey), providerId)),
	getThemePreference: Effect.sync(() => {
		const value = storage?.getItem(THEME_PREFERENCE_KEY);
		return isThemePreference(value) ? value : "system";
	}),
	getLastWorkspace: (scope) =>
		Effect.sync(() => {
			const value = storage?.getItem(lastWorkspaceKey(scope));
			return isPluginId(value) ? value : null;
		}),
	setDeviceState: (state) =>
		Effect.try({
			catch: (cause) => new DeviceStateAccessError({ cause }),
			try: () => storage?.setItem(DEVICE_STATE_KEY, encodeDeviceState(state)),
		}),
	getSavedViewLayout: (scope, slug) =>
		Effect.sync(() => {
			const value = storage?.getItem(savedViewLayoutKey(scope, slug));
			return isSavedViewLayout(value) ? value : "grid";
		}),
	getRememberedProvider: (scope, schemaKey) =>
		Effect.sync(() => {
			const value = storage?.getItem(rememberedProviderKey(scope, schemaKey));
			return isSandboxProviderId(value) ? value : null;
		}),
	removePluginValue: (scope, pluginId, key) => {
		if (!storage) {
			return Effect.fail(unavailablePluginStorageError());
		}
		return attemptPluginStorageAccess(() =>
			storage.removeItem(pluginStorageKey(scope, pluginId, key)),
		);
	},
	getServerSelection: Effect.sync(() => {
		const value = storage?.getItem(SERVER_SELECTION_KEY);
		if (value === null || value === undefined) {
			return null;
		}
		const result = parseServerOrigin(value);
		return result.ok ? result.origin : null;
	}),
	getDeviceState: Effect.try({
		catch: (cause) => new DeviceStateAccessError({ cause }),
		try: () => {
			const value = storage?.getItem(DEVICE_STATE_KEY);
			return value === null || value === undefined ? emptyDeviceState : decodeDeviceState(value);
		},
	}),
	setPluginValue: (scope, pluginId, key, value) => {
		if (!storage) {
			return Effect.fail(unavailablePluginStorageError());
		}
		return Effect.try({
			try: () => storage.setItem(pluginStorageKey(scope, pluginId, key), encodePluginValue(value)),
			catch: (cause) =>
				isQuotaExceededError(cause)
					? new PluginStorageQuotaError()
					: new PluginStorageAccessError({ cause }),
		});
	},
	getPluginValue: (scope, pluginId, key) => {
		if (!storage) {
			return Effect.fail(unavailablePluginStorageError());
		}
		return attemptPluginStorageAccess(() => {
			const value = storage.getItem(pluginStorageKey(scope, pluginId, key));
			if (value === null) {
				return null;
			}
			const decoded = decodePluginValue(value);
			if (Option.isNone(decoded)) {
				throw new PluginStorageAccessError({ cause: new Error("Stored plugin value is invalid") });
			}
			return decoded.value;
		});
	},
});

export class ClientStorage extends Context.Service<
	ClientStorage,
	{
		readonly clearServerSelection: Effect.Effect<void>;
		readonly getDeviceState: Effect.Effect<DeviceState, DeviceStateAccessError>;
		readonly getThemePreference: Effect.Effect<ThemePreference>;
		readonly getServerSelection: Effect.Effect<ServerOrigin | null>;
		readonly remove: (keys: readonly string[]) => Effect.Effect<void>;
		readonly setDeviceState: (state: DeviceState) => Effect.Effect<void, DeviceStateAccessError>;
		readonly setServerSelection: (origin: ServerOrigin) => Effect.Effect<void>;
		readonly getLastWorkspace: (scope: ApiScope) => Effect.Effect<PluginId | null>;
		readonly setLastWorkspace: (scope: ApiScope, pluginId: PluginId) => Effect.Effect<void>;
		readonly setThemePreference: (preference: ThemePreference) => Effect.Effect<void>;
		readonly getSavedViewLayout: (scope: ApiScope, slug: string) => Effect.Effect<SavedViewLayout>;
		readonly getRememberedProvider: (
			scope: ApiScope,
			schemaKey: string,
		) => Effect.Effect<ProviderId | null>;
		readonly setRememberedProvider: (
			scope: ApiScope,
			schemaKey: string,
			providerId: ProviderId,
		) => Effect.Effect<void>;
		readonly setSavedViewLayout: (
			scope: ApiScope,
			slug: string,
			layout: SavedViewLayout,
		) => Effect.Effect<void>;
		readonly getPluginValue: (
			scope: ApiScope,
			pluginId: PluginId,
			key: string,
		) => Effect.Effect<JsonValue | null, PluginStorageAccessError>;
		readonly setPluginValue: (
			scope: ApiScope,
			pluginId: PluginId,
			key: string,
			value: JsonValue,
		) => Effect.Effect<void, PluginStorageAccessError | PluginStorageQuotaError>;
		readonly removePluginValue: (
			scope: ApiScope,
			pluginId: PluginId,
			key: string,
		) => Effect.Effect<void, PluginStorageAccessError>;
	}
>()("ClientStorage") {
	static readonly layer = Layer.effect(
		this,
		Effect.sync(() => makeStorage(browserStorage())),
	);
}

export const clientStorageLayer = (storage: BrowserStorage | undefined) =>
	Layer.succeed(ClientStorage, makeStorage(storage));
