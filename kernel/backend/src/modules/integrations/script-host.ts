import { IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import {
	sandboxHostEffect,
	sandboxHostFailure,
	toSandboxJsonValue,
} from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import {
	admittedImportRunId,
	makeAdmittedExecutionStateLoader,
} from "#modules/imports/script-host";
import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
} from "#modules/scripts/authorization/capabilities";
import {
	sandboxRunIntegrationId,
	userSandboxRunUserId,
} from "#modules/scripts/host/execution-context";

import { type IntegrationRecord, IntegrationsRepository } from "./repository";

const toSandboxIntegrationSettings = (settings: Readonly<Record<string, unknown>>) =>
	Object.fromEntries(
		Object.entries(settings).map(([key, value]) => [key, toSandboxJsonValue(value)]),
	);

const toSandboxIntegration = (integration: IntegrationRecord) => {
	const { pluginInstallationId: _pluginInstallationId, ...record } = integration;
	return { ...record, providerSpecifics: toSandboxIntegrationSettings(record.providerSpecifics) };
};

export const makeIntegrationScriptHost = Effect.gen(function* () {
	const integrationsRepository = yield* IntegrationsRepository;
	const loadExecutionState = yield* makeAdmittedExecutionStateLoader;

	return {
		listIntegrations: (rawInput, rawOptions) =>
			Effect.gen(function* () {
				const input = yield* requireSandboxCapabilityInput(rawInput, "listIntegrations");
				const options = rawOptions ?? {};

				return yield* sandboxHostEffect(
					integrationsRepository
						.listForUser({
							userId: UserId.make(userSandboxRunUserId(input)),
							...(options.provider !== undefined ? { provider: options.provider } : {}),
							...(options.isDisabled !== undefined ? { isDisabled: options.isDisabled } : {}),
						})
						.pipe(Effect.map((rows) => rows.map(toSandboxIntegration))),
				);
			}),
		getCurrentIntegration: (rawInput) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "getCurrentIntegration");
					const integrationId = sandboxRunIntegrationId(input);
					if (!integrationId) {
						return yield* sandboxHostFailure(
							"getCurrentIntegration is available only to executions scoped to an integration",
							{ code: "unavailable-operation", operation: "getCurrentIntegration" },
						);
					}
					const integration = yield* integrationsRepository.getForUser({
						integrationId: IntegrationId.make(integrationId),
						userId: UserId.make(userSandboxRunUserId(input)),
					});
					if (!integration) {
						return yield* Effect.fail("Integration not found");
					}
					const runId = admittedImportRunId(input);
					if (!runId) {
						return toSandboxIntegration(integration);
					}
					const state = yield* loadExecutionState(input, runId);
					if (
						state.pluginInstallationId !== integration.pluginInstallationId ||
						state.sourcePayload["integrationId"] !== integration.id
					) {
						return yield* Effect.fail("Admitted integration settings are unavailable");
					}
					if (!state.executionSettings.integration) {
						return yield* Effect.fail("Admitted integration settings are unavailable");
					}
					return toSandboxIntegration({ ...integration, ...state.executionSettings.integration });
				}),
			),
	} satisfies Pick<
		AdditionalScriptHostImplementationMap,
		"listIntegrations" | "getCurrentIntegration"
	>;
});
