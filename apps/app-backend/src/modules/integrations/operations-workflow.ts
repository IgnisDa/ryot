import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, toSandboxRunError } from "@ryot/contract/errors";
import type { SandboxCompletedResult } from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { processSandboxExecution } from "#modules/sandbox/durable-queues";
import { SandboxPluginScriptResolver } from "#modules/sandbox/plugin-script-resolver";
import { SandboxRepository } from "#modules/sandbox/repository";

import type { IntegrationRecord } from "./repository";

type RunAdapterInput = {
	context: unknown;
	executionId: string;
	integration: IntegrationRecord;
};

export type IntegrationRunOperationsValue = {
	runAdapter: (
		input: RunAdapterInput,
	) => Effect.Effect<SandboxCompletedResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
};

export class IntegrationRunOperations extends Context.Tag("IntegrationRunOperations")<
	IntegrationRunOperations,
	IntegrationRunOperationsValue
>() {}

const runIntegrationAdapter = (input: RunAdapterInput) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const catalog = yield* IntegrationProviderCatalog;
		const resolution = catalog.resolveOwned(
			input.integration.provider,
			input.integration.pluginSlug,
		);
		if (!resolution?.provider.scriptSlug) {
			return yield* new SandboxRunError({
				message: `Integration provider '${input.integration.provider}' is unavailable`,
			});
		}
		const scriptId = yield* Activity.make({
			error: SandboxRunError,
			success: SandboxScriptId,
			name: `resolve-integration-adapter-${input.executionId}`,
			execute: runWithDb(resolution.script).pipe(
				Effect.mapError(toSandboxRunError),
				Effect.flatMap((script) =>
					script
						? Effect.succeed(script.id)
						: new SandboxRunError({
								message: `Integration provider '${input.integration.provider}' script is unavailable`,
							}),
				),
			),
		});
		return yield* processSandboxExecution({
			scriptId,
			context: input.context,
			executionId: input.executionId,
			authority: {
				type: "user",
				userId: input.integration.userId,
				integrationId: input.integration.id,
			},
		});
	}).pipe(Effect.mapError(toSandboxRunError));

export const IntegrationRunOperationsLive = Layer.effect(
	IntegrationRunOperations,
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		const catalog = yield* IntegrationProviderCatalog;
		const pluginScriptResolver = yield* SandboxPluginScriptResolver;
		const queueFactory = yield* PersistedQueue.PersistedQueueFactory;

		return {
			runAdapter: (input) =>
				runIntegrationAdapter(input).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(IntegrationProviderCatalog, catalog),
					Effect.provideService(SandboxRepository, repository),
					Effect.provideService(SandboxPluginScriptResolver, pluginScriptResolver),
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
				),
		} satisfies IntegrationRunOperationsValue;
	}),
);
