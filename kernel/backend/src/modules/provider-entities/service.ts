import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import {
	type ImportEntityBody,
	ProviderEntityBadRequest,
	ProviderEntityNotFound,
} from "@ryot/contract/modules/provider-entities/schemas";
import { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import {
	createWorkflowJobId,
	deriveJobIdSecret,
	resolveWorkflowExecutionId,
} from "#lib/shared/job-id";
import { trimToNull } from "#lib/shared/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntityImportWorkflow } from "./entity-import-workflow";
import { toEntityImportRunResult } from "./result-workflow";

export class EntityImportService extends Context.Service<EntityImportService>()(
	"EntityImportService",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const engine = yield* WorkflowEngine;
			const repository = yield* EntitiesRepository;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const jobIdSecret = deriveJobIdSecret(Redacted.value(config.server.adminAccessToken));

			const importEntity = Effect.fn("EntityImportService.import")(function* (
				user: CurrentUserValue,
				payload: ImportEntityBody,
			) {
				const trimmedProviderId = trimToNull(payload.providerId);
				const externalId = trimToNull(payload.externalId);

				if (!trimmedProviderId) {
					return yield* new ProviderEntityBadRequest({
						reason: { code: "invalid-import-input", field: "providerId" },
					});
				}
				if (!externalId) {
					return yield* new ProviderEntityBadRequest({
						reason: { code: "invalid-import-input", field: "externalId" },
					});
				}

				const providerId = SandboxProviderId.make(trimmedProviderId);
				const provider = yield* pluginRuntime.findProviderAvailableToUser(user.id, providerId);
				if (!provider) {
					return yield* new ProviderEntityNotFound({
						reason: { code: "provider-not-found", providerId },
					});
				}
				const entitySchemaSlug = EntitySchemaSlug.make(provider.rootEntitySchemaSlug);

				const entitySchemaScope = yield* repository.getEntitySchemaScopeForUser({
					userId: user.id,
					entitySchemaSlug,
				});
				if (!entitySchemaScope) {
					return yield* new ProviderEntityNotFound({
						reason: { code: "entity-schema-not-found", entitySchemaSlug },
					});
				}

				const executionId = generateId();
				yield* engine
					.execute(EntityImportWorkflow, {
						executionId,
						discard: true,
						payload: {
							providerId,
							externalId,
							executionId,
							userId: user.id,
							entitySchemaSlug,
							origin: { kind: "api" },
							entityScope: provider.pluginScope === "user" ? "user" : "global",
						},
					})
					.pipe(Effect.orDie);

				return { jobId: createWorkflowJobId(jobIdSecret, executionId, user.id) };
			});

			const getImportResult = Effect.fn("EntityImportService.getImportResult")(function* (
				user: CurrentUserValue,
				jobId: string,
			) {
				const resolvedJobId = trimToNull(jobId);
				if (!resolvedJobId) {
					return yield* new ProviderEntityNotFound({
						reason: { code: "import-job-not-found", jobId },
					});
				}

				const executionId = resolveWorkflowExecutionId(jobIdSecret, user.id, resolvedJobId);
				if (!executionId) {
					return yield* new ProviderEntityNotFound({
						reason: { code: "import-job-not-found", jobId },
					});
				}

				return toEntityImportRunResult(
					Option.getOrUndefined(yield* engine.poll(EntityImportWorkflow, executionId)),
				);
			});

			return { getImportResult, import: importEntity };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
