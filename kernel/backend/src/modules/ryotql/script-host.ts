import { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import { sandboxHostEffect, sandboxHostFailure } from "@ryot-app/sandbox/host/invocation";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { Effect, Schema } from "effect";

import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
} from "#modules/scripts/authorization/capabilities";
import {
	sandboxDefinitionReadContext,
	sandboxRunUserId,
} from "#modules/scripts/host/execution-context";
import { SandboxRepository } from "#modules/scripts/registry/repository";

import { RyotQLService } from "./service";

const decodeExecutionRequest = Schema.decodeUnknownEffect(Schema.toType(ExecutionRequest));

export const makeRyotQLScriptHost = Effect.gen(function* () {
	const ryotqlService = yield* RyotQLService;
	const scripts = yield* SandboxRepository;

	return {
		executeRyotql: (rawInput, query) =>
			requireSandboxCapabilityInput(rawInput, "executeRyotql").pipe(
				Effect.flatMap((input) => {
					const { subject } = input.principal;
					if (
						subject.type === "system" ||
						(subject.type === "automation-run" && subject.executionUserId === null)
					) {
						return sandboxHostEffect(
							Effect.gen(function* () {
								const revision = input.principal.pluginRevision;
								if (revision?.scope !== "system") {
									return yield* sandboxHostFailure(
										"executeRyotql system access requires a pinned plugin script",
										{ operation: "executeRyotql", code: "unavailable-operation" },
									);
								}
								const document = yield* decodeExecutionRequest(query);
								return yield* ryotqlService.executeForPlugin(
									{
										pluginId: revision.id,
										packageId: revision.packageId,
										pluginRevisionId: revision.revisionId,
										...(yield* scripts.getSchemaScope(revision.revisionId)),
									},
									document,
									SANDBOX_LIMITS.ryotqlResultBytes,
								);
							}),
						);
					}
					return sandboxHostEffect(
						Effect.gen(function* () {
							const document = yield* decodeExecutionRequest(query);
							const userId = sandboxRunUserId(input);
							if (userId === null) {
								return yield* sandboxHostFailure("executeRyotql requires a user execution", {
									operation: "executeRyotql",
									code: "unavailable-operation",
								});
							}
							return yield* ryotqlService.executeForUser(
								userId,
								null,
								"plugin",
								document,
								"standard",
								SANDBOX_LIMITS.ryotqlResultBytes,
								sandboxDefinitionReadContext(input),
							);
						}),
					);
				}),
			),
	} satisfies Pick<AdditionalScriptHostImplementationMap, "executeRyotql">;
});
