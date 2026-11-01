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
import { Context, Effect, Layer, Option, Schema } from "effect";

import { parseServerOrigin, type ServerOrigin } from "#/api/origin";
import { type ApiScope, apiScopeKey } from "#/api/scope";
import { type RecentDestination, RecentDestinations } from "#/modules/command-center/recents";
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
export const recentDestinationsKey = (scope: ApiScope) =>
	`${RYOT_STORAGE_PREFIX}recent-destinations:${apiScopeKey(scope)}`;
const sidebarSectionExpandedKey = (scope: ApiScope, workspace: string, section: string) =>
	`${RYOT_STORAGE_PREFIX}sidebar-expanded:${apiScopeKey(scope)}:${workspace}:${section}`;
export const rememberedProviderKey = (scope: ApiScope, schemaKey: string) =>
	`${RYOT_STORAGE_PREFIX}remembered-provider:${apiScopeKey(scope)}:${schemaKey}`;

export const pluginStorageKey = (scope: ApiScope, pluginId: PluginId, key: string) =>
	`${RYOT_STORAGE_PREFIX}plugin-storage:${identityTupleKey(scope.serverUrl, scope.userId, pluginId, key)}`;

export type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export class PluginStorageQuotaError extends Schema.TaggedError<
	PluginStorageQuotaError,
	{ readonly brand: unique symbol }
>()("PluginStorageQuotaError", {}) {}

export class DeviceStateAccessError extends Schema.TaggedError<
	DeviceStateAccessError,
	{ readonly brand: unique symbol }
>()("DeviceStateAccessError", { cause: Schema.Unknown }) {}

export class PluginStorageAccessError extends Schema.TaggedError<
	PluginStorageAccessError,
	{ readonly brand: unique symbol }
>()("PluginStorageAccessError", { cause: Schema.Unknown }) {}

const browserStorage = () => {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
};
const decodeRecentDestinations = Schema.decodeUnknownOption(
	Schema.fromJsonString(RecentDestinations),
);
const encodeRecentDestinations = Schema.encodeEffect(Schema.fromJsonString(RecentDestinations));
const bestEffort = <A>(fallback: A, evaluate: () => A) =>
	Effect.sync(() => {
		try {
			return evaluate();
		} catch {
			return fallback;
		}
	});
const parseExpanded = (value: null | string | undefined) => {
	if (value === "true") {
		return true;
	}
	return value === "false" ? false : null;
};
const isPluginId = Schema.is(PluginId);
const isSavedViewLayout = Schema.is(EntityBrowserLayout);
const isSandboxProviderId = Schema.is(SandboxProviderId);
const decodeDeviceState = Schema.decodeUnknownEffect(Schema.fromJsonString(DeviceState));
const encodeDeviceState = Schema.encodeEffect(Schema.fromJsonString(DeviceState));
const decodePluginValue = Schema.decodeUnknownOption(Schema.fromJsonString(JsonValue));
const encodePluginValue = Schema.encodeEffect(Schema.fromJsonString(JsonValue));
const deviceStateAccessError = (cause: unknown) => new DeviceStateAccessError({ cause });
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

const makeStorage = (storage: undefined | BrowserStorage): ClientStorage["Service"] => ({
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
	getSidebarSectionExpanded: (scope, workspace, section) =>
		bestEffort(null, () =>
			parseExpanded(storage?.getItem(sidebarSectionExpandedKey(scope, workspace, section))),
		),
	getSavedViewLayout: (scope, slug) =>
		Effect.sync(() => {
			const value = storage?.getItem(savedViewLayoutKey(scope, slug));
			return isSavedViewLayout(value) ? value : "grid";
		}),
	setSidebarSectionExpanded: (scope, workspace, section, expanded) =>
		bestEffort(undefined, () =>
			storage?.setItem(sidebarSectionExpandedKey(scope, workspace, section), String(expanded)),
		),
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
	setDeviceState: (state) =>
		encodeDeviceState(state).pipe(
			Effect.mapError(deviceStateAccessError),
			Effect.flatMap((encoded) =>
				Effect.try({
					catch: deviceStateAccessError,
					try: () => storage?.setItem(DEVICE_STATE_KEY, encoded),
				}),
			),
		),
	setRecentDestinations: (scope, destinations) =>
		encodeRecentDestinations(destinations).pipe(
			Effect.flatMap((encoded) =>
				bestEffort(undefined, () => storage?.setItem(recentDestinationsKey(scope), encoded)),
			),
			Effect.orElseSucceed(() => undefined),
		),
	getRecentDestinations: (scope) =>
		bestEffort([], () => {
			const value = storage?.getItem(recentDestinationsKey(scope));
			if (value === null || value === undefined) {
				return [];
			}
			return Option.getOrElse(decodeRecentDestinations(value), () => []);
		}),
	getDeviceState: Effect.try({
		catch: deviceStateAccessError,
		try: () => storage?.getItem(DEVICE_STATE_KEY),
	}).pipe(
		Effect.flatMap((value) =>
			value === null || value === undefined
				? Effect.succeed(emptyDeviceState)
				: decodeDeviceState(value).pipe(Effect.mapError(deviceStateAccessError)),
		),
	),
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
	setPluginValue: (scope, pluginId, key, value) => {
		if (!storage) {
			return Effect.fail(unavailablePluginStorageError());
		}
		return encodePluginValue(value).pipe(
			Effect.mapError((cause) => new PluginStorageAccessError({ cause })),
			Effect.flatMap((encoded) =>
				Effect.try({
					try: () => storage.setItem(pluginStorageKey(scope, pluginId, key), encoded),
					catch: (cause) =>
						isQuotaExceededError(cause)
							? new PluginStorageQuotaError()
							: new PluginStorageAccessError({ cause }),
				}),
			),
		);
	},
});

export class ClientStorage extends Context.Service<
	ClientStorage,
	{
		readonly clearServerSelection: Effect.Effect<void>;
		readonly getThemePreference: Effect.Effect<ThemePreference>;
		readonly getServerSelection: Effect.Effect<null | ServerOrigin>;
		readonly remove: (keys: readonly string[]) => Effect.Effect<void>;
		readonly setServerSelection: (origin: ServerOrigin) => Effect.Effect<void>;
		readonly getDeviceState: Effect.Effect<DeviceState, DeviceStateAccessError>;
		readonly getLastWorkspace: (scope: ApiScope) => Effect.Effect<null | PluginId>;
		readonly setThemePreference: (preference: ThemePreference) => Effect.Effect<void>;
		readonly setLastWorkspace: (scope: ApiScope, pluginId: PluginId) => Effect.Effect<void>;
		readonly setDeviceState: (state: DeviceState) => Effect.Effect<void, DeviceStateAccessError>;
		readonly getSavedViewLayout: (scope: ApiScope, slug: string) => Effect.Effect<SavedViewLayout>;
		readonly getRecentDestinations: (
			scope: ApiScope,
		) => Effect.Effect<readonly RecentDestination[]>;
		readonly getRememberedProvider: (
			scope: ApiScope,
			schemaKey: string,
		) => Effect.Effect<null | ProviderId>;
		readonly setSavedViewLayout: (
			scope: ApiScope,
			slug: string,
			layout: SavedViewLayout,
		) => Effect.Effect<void>;
		readonly setRecentDestinations: (
			scope: ApiScope,
			destinations: readonly RecentDestination[],
		) => Effect.Effect<void>;
		readonly setRememberedProvider: (
			scope: ApiScope,
			schemaKey: string,
			providerId: ProviderId,
		) => Effect.Effect<void>;
		readonly getSidebarSectionExpanded: (
			scope: ApiScope,
			workspace: string,
			section: string,
		) => Effect.Effect<null | boolean>;
		readonly removePluginValue: (
			scope: ApiScope,
			pluginId: PluginId,
			key: string,
		) => Effect.Effect<void, PluginStorageAccessError>;
		readonly setSidebarSectionExpanded: (
			scope: ApiScope,
			workspace: string,
			section: string,
			expanded: boolean,
		) => Effect.Effect<void>;
		readonly getPluginValue: (
			scope: ApiScope,
			pluginId: PluginId,
			key: string,
		) => Effect.Effect<null | JsonValue, PluginStorageAccessError>;
		readonly setPluginValue: (
			scope: ApiScope,
			pluginId: PluginId,
			key: string,
			value: JsonValue,
		) => Effect.Effect<void, PluginStorageQuotaError | PluginStorageAccessError>;
	}
>()("@ryot-app/kernel-client/persistence/storage/ClientStorage") {
	static readonly layer = Layer.effect(
		this,
		Effect.sync(() => makeStorage(browserStorage())),
	);
}

export const clientStorageLayer = (storage: undefined | BrowserStorage) =>
	Layer.succeed(ClientStorage, makeStorage(storage));
