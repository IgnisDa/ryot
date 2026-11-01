import { UserId } from "@ryot-app/contract/schema/brands";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import { sandboxHostEffect, sandboxHostFailure } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import {
	admittedImportRunId,
	makeAdmittedExecutionStateLoader,
} from "#modules/imports/script-host";
import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
} from "#modules/scripts/authorization/capabilities";
import { isUserBootstrapPrincipal } from "#modules/scripts/authorization/principal";
import { userSandboxRunUserId } from "#modules/scripts/host/execution-context";

import { PluginRuntimeResolver } from "./catalog/runtime-resolver";
import { getPluginConfig } from "./configuration/access";
import { PluginInstallationRepository } from "./installations/repository";
import { resolveStoredPluginUserSettings } from "./preferences/user-settings";
import { PluginUserSettingsWriter } from "./preferences/user-settings-writer";

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
	const userSettingsWriter = yield* PluginUserSettingsWriter;

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
						context: { config, configSchema: revision.configSchema },
					});
					return yield* encodeConfigValues(values);
				}),
			),
		updateUserSettings: (rawInput, values) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "updateUserSettings");
					const { principal } = input;
					const plugin = principal.pluginRevision;
					if (!plugin) {
						return yield* sandboxHostFailure("Plugin user settings require a plugin execution", {
							code: "unavailable-operation",
							operation: "updateUserSettings",
						});
					}
					if (
						principal.subject.integrationId !== undefined ||
						admittedImportRunId(input) !== null ||
						principal.initialization !== undefined ||
						isUserBootstrapPrincipal(principal)
					) {
						return yield* sandboxHostFailure(
							"Plugin user settings cannot be written by integration, import, or bootstrap executions",
							{ code: "unavailable-operation", operation: "updateUserSettings" },
						);
					}
					yield* userSettingsWriter.patch({
						values,
						pluginId: plugin.id,
						userId: principal.subject.userId,
						pluginRevisionId: plugin.revisionId,
						accountGeneration: principal.subject.accountGeneration,
					});
					return { saved: true as const };
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
					const settingsSchema = row.userSettingsSchema;
					if (!settingsSchema) {
						return {};
					}
					return yield* resolveStoredPluginUserSettings(settingsSchema, row.userSettings);
				}),
			),
	} satisfies Pick<
		AdditionalScriptHostImplementationMap,
		"getPluginConfig" | "getUserSettings" | "updateUserSettings"
	>;
});
