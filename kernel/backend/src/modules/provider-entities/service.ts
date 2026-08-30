import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	type ImportEntityBody,
	type ImportEntityRunResult,
	ProviderEntityBadRequest,
	ProviderEntityImportBacklogFull,
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

import { PROVIDER_IMPORT_USER_BACKLOG_LIMIT, ProviderImportAdmission } from "./admission";
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
			const admission = yield* ProviderImportAdmission;
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
				const workflowPayload = {
					providerId,
					externalId,
					executionId,
					entitySchemaSlug,
					entityScope: {
						userId: user.id,
						type: provider.pluginScope === "user" ? ("user" as const) : ("global" as const),
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
				};
				if (!admission.enabled) {
					yield* engine
						.execute(EntityImportWorkflow, { executionId, discard: true, payload: workflowPayload })
						.pipe(Effect.orDie);
					return { jobId: createWorkflowJobId(jobIdSecret, executionId, user.id) };
				}
				const admitted = yield* admission.submit({ userId: user.id, payload: workflowPayload });
				if (admitted.status === "backlog-full") {
					return yield* new ProviderEntityImportBacklogFull({
						reason: {
							retryAfterSeconds: 30,
							code: "import-backlog-full",
							limit: PROVIDER_IMPORT_USER_BACKLOG_LIMIT,
						},
					});
				}
				return { jobId: createWorkflowJobId(jobIdSecret, admitted.id, user.id) };
			});

			const resolveJob = Effect.fn("EntityImportService.resolveJob")(function* (
				user: CurrentUserValue,
				jobId: string,
			) {
				const resolvedJobId = trimToNull(jobId);
				const executionId = resolvedJobId
					? resolveWorkflowExecutionId(jobIdSecret, user.id, resolvedJobId)
					: null;
				if (!executionId) {
					return yield* new ProviderEntityNotFound({
						reason: { jobId, code: "import-job-not-found" },
					});
				}
				return executionId;
			});

			const getImportResult = Effect.fn("EntityImportService.getImportResult")(function* (
				user: CurrentUserValue,
				jobId: string,
			) {
				const executionId = yield* resolveJob(user, jobId);
				const admitted = admission.enabled
					? yield* admission.status({ id: executionId, userId: user.id })
					: null;
				if (admitted === "queued") {
					return { status: "queued" } satisfies ImportEntityRunResult;
				}
				const result = Option.getOrUndefined(yield* engine.poll(EntityImportWorkflow, executionId));
				// A signed job with neither a ledger row nor a workflow was cancelled before admission.
				if (result === undefined && admission.enabled && admitted === null) {
					return { status: "cancelled" } satisfies ImportEntityRunResult;
				}
				return toEntityImportRunResult(result);
			});

			const cancelImport = Effect.fn("EntityImportService.cancelImport")(function* (
				user: CurrentUserValue,
				jobId: string,
			) {
				const executionId = yield* resolveJob(user, jobId);
				yield* admission.cancel({ id: executionId, userId: user.id });
				return { jobId };
			});

			return { cancelImport, getImportResult, import: importEntity };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ProviderImportAdmission.layer),
	);
}
