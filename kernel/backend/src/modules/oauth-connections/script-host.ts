import { OAuthConnectionId } from "@ryot-app/contract/schema/brands";
import { sandboxHostEffect, sandboxHostFailure } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import { makeAdmittedExecutionStateLoader } from "#modules/imports/script-host";
import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
	type ScriptRunInput,
} from "#modules/scripts/authorization/capabilities";

import { OAuthConnectionsService } from "./service";

export const makeOAuthConnectionScriptHost = Effect.gen(function* () {
	const oauthConnections = yield* OAuthConnectionsService;
	const loadExecutionState = yield* makeAdmittedExecutionStateLoader;
	const loadOAuthIntegrationRun = Effect.fn("loadOAuthIntegrationRun")(function* (
		rawInput: ScriptRunInput,
		operation: "getOAuthAccessToken" | "invalidateOAuthAccessToken",
		field: string,
	) {
		const input = yield* requireSandboxCapabilityInput(rawInput, operation);
		const { subject, pluginRevision } = input.principal;
		if (
			subject.integrationId === undefined ||
			subject.integrationRunId === undefined ||
			pluginRevision === null
		) {
			return yield* sandboxHostFailure(
				`${operation} is available only to integration run executions`,
				{ operation, code: "unavailable-operation" },
			);
		}
		if (!input.principal.metadata.oauthConnectionFields?.includes(field)) {
			return yield* Effect.fail(`OAuth connection field "${field}" is not declared by this script`);
		}
		const { integrationId, integrationRunId } = subject;
		const state = yield* loadExecutionState(input, integrationRunId);
		const integration = state.executionSettings.integration;
		const connectionId = integration?.providerSpecifics[field];
		if (
			state.sourcePayload["integrationId"] !== integrationId ||
			!integration ||
			typeof connectionId !== "string" ||
			connectionId.length === 0
		) {
			return yield* Effect.fail("Admitted integration settings are unavailable");
		}
		return {
			field,
			integrationId,
			integrationRunId,
			userId: subject.userId,
			pluginId: pluginRevision.id,
			connectionId: OAuthConnectionId.make(connectionId),
		};
	});

	return {
		getOAuthAccessToken: (rawInput, options) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const binding = yield* loadOAuthIntegrationRun(
						rawInput,
						"getOAuthAccessToken",
						options.field,
					);
					return yield* oauthConnections
						.accessTokenForIntegrationRun(binding)
						.pipe(Effect.mapError((error) => error.message));
				}),
			),
		invalidateOAuthAccessToken: (rawInput, options) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const binding = yield* loadOAuthIntegrationRun(
						rawInput,
						"invalidateOAuthAccessToken",
						options.field,
					);
					return yield* oauthConnections
						.invalidateAccessTokenForIntegrationRun({
							...binding,
							accessToken: options.accessToken,
						})
						.pipe(Effect.mapError((error) => error.message));
				}),
			),
	} satisfies Pick<
		AdditionalScriptHostImplementationMap,
		"getOAuthAccessToken" | "invalidateOAuthAccessToken"
	>;
});
