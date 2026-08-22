import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	type ImportEntityBody,
	ProviderEntityBadRequest,
	ProviderEntityNotFound,
} from "@ryot-app/contract/modules/provider-entities/schemas";
import {
	AutomationExecutionId,
	EntitySchemaSlug,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { Context, DateTime, Effect, Layer, Option, Redacted } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
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
						reason: { field: "providerId", code: "invalid-import-input" },
					});
				}
				if (!externalId) {
					return yield* new ProviderEntityBadRequest({
						reason: { field: "externalId", code: "invalid-import-input" },
					});
				}

				const providerId = SandboxProviderId.make(trimmedProviderId);
				const provider = yield* pluginRuntime.findProviderAvailableToUser(user.id, providerId);
				if (!provider) {
					return yield* new ProviderEntityNotFound({
						reason: { providerId, code: "provider-not-found" },
					});
				}
				const entitySchemaSlug = EntitySchemaSlug.make(provider.rootEntitySchemaSlug);

				const entitySchemaScope = yield* repository.findEntitySchemaForUser({
					userId: user.id,
					entitySchemaSlug,
				});
				if (!entitySchemaScope) {
					return yield* new ProviderEntityNotFound({
						reason: { entitySchemaSlug, code: "entity-schema-not-found" },
					});
				}

				const executionId = generateId();
				const occurredAt = IsoUtcString.make((yield* DateTime.nowAsDate).toISOString());
				yield* engine
					.execute(EntityImportWorkflow, {
						executionId,
						discard: true,
						payload: {
							providerId,
							externalId,
							executionId,
							entitySchemaSlug,
							entityScope: {
								userId: user.id,
								type: provider.pluginScope === "user" ? "user" : "global",
							},
							command: rootLifecycleCommand({
								occurredAt,
								source: "api",
								initiator: { id: user.id, kind: "user" },
								executionId: AutomationExecutionId.make(executionId),
								itemIdentity: stableStringify([
									"provider-entity-import",
									user.id,
									providerId,
									entitySchemaSlug,
									externalId,
								]),
							}),
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
						reason: { jobId, code: "import-job-not-found" },
					});
				}

				const executionId = resolveWorkflowExecutionId(jobIdSecret, user.id, resolvedJobId);
				if (!executionId) {
					return yield* new ProviderEntityNotFound({
						reason: { jobId, code: "import-job-not-found" },
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
