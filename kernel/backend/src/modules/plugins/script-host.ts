import { UserId } from "@ryot-app/contract/schema/brands";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import {
	requireSandboxCapabilityInput,
	sandboxHostEffect,
	sandboxHostFailure,
	type AdditionalSandboxHostImplementationMap,
} from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import {
	admittedImportRunId,
	makeAdmittedExecutionStateLoader,
} from "#modules/imports/script-host";
import { userSandboxRunUserId } from "#modules/scripts/host/execution-context";

import { getPluginConfig } from "./config-access";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginRuntimeResolver } from "./runtime-resolver";
import { resolveStoredPluginUserSettings } from "./user-settings";

const normalizeConfigKeys = (
	rawKeys: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, string> => {
	const keys = rawKeys.map((key) => key.trim());
	return keys.some((key) => !key)
		? Effect.fail("getPluginConfig expects non-empty key strings")
		: Effect.succeed(keys);
};

const encodeConfigValues = (values: Readonly<Record<string, unknown>>) =>
	Effect.forEach(Object.entries(values), ([key, value]) =>
		isJsonValue(value)
			? Effect.succeed([key, value] as const)
			: Effect.fail(`Plugin config key "${key}" is not JSON-compatible`),
	).pipe(Effect.map((entries): Record<string, JsonValue> => Object.fromEntries(entries)));

export const makePluginScriptHost = Effect.gen(function* () {
	const pluginRuntime = yield* PluginRuntimeResolver;
	const pluginInstallations = yield* PluginInstallationRepository;
	const loadExecutionState = yield* makeAdmittedExecutionStateLoader;

	return {
		getPluginConfig: (input, rawAccess) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const access = yield* Effect.all({
						required: normalizeConfigKeys(rawAccess.required ?? []),
						optional: normalizeConfigKeys(rawAccess.optional ?? []),
					});
					const revision = input.principal.pluginRevision;
					if (!revision) {
						return yield* sandboxHostFailure(
							"Plugin config is available only to active plugin scripts",
							{ operation: "getPluginConfig", code: "unavailable-operation" },
						);
					}
					const config = yield* pluginRuntime.resolvePluginConfigContext({
						id: revision.configRevisionId,
						ownerUserId: revision.ownerId,
						pluginRevisionId: revision.revisionId,
					});
					const values = yield* getPluginConfig({
						access,
						metadata: input.principal.metadata,
						context: { config, kind: "installation", configSchema: revision.configSchema },
					});
					return yield* encodeConfigValues(values);
				}),
			),
		getUserSettings: (rawInput) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "getUserSettings");
					const plugin = input.principal.pluginRevision;
					if (!plugin) {
						return yield* sandboxHostFailure("Plugin user settings require a plugin execution", {
							operation: "getUserSettings",
							code: "unavailable-operation",
						});
					}
					const row = yield* pluginInstallations.findUserSettingsForRevision({
						pluginId: plugin.id,
						pluginRevisionId: plugin.revisionId,
						userId: UserId.make(userSandboxRunUserId(input)),
					});
					if (!row) {
						return yield* Effect.fail("Plugin installation not found");
					}
					const runId = admittedImportRunId(input);
					if (runId) {
						const state = yield* loadExecutionState(input, runId);
						if (state.pluginInstallationId !== row.installationId) {
							return yield* Effect.fail("Admitted ingestion execution settings are unavailable");
						}
						return state.executionSettings.userSettings;
					}
					const settingsSchema = row.manifest.userSettingsSchema;
					if (!settingsSchema) {
						return {};
					}
					return yield* resolveStoredPluginUserSettings(settingsSchema, row.userSettings);
				}),
			),
	} satisfies Pick<AdditionalSandboxHostImplementationMap, "getPluginConfig" | "getUserSettings">;
});
