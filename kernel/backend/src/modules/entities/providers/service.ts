import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	type ImportEntityBody,
	type ImportEntityRunResult,
	ProviderEntityBadRequest,
	ProviderEntityImportBacklogFull,
	ProviderEntityNotFound,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntitySchemaSlug,
	SandboxProviderId,
	PluginId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { Context, DateTime, Effect, Layer, Option, Redacted } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { AppConfig } from "#platform/config/service";
import { trimToNull } from "#platform/validation";
import {
	awaitWorkflowSettled,
	WorkflowExecutionNotifications,
} from "#platform/workflow/execution-notifications";
import {
	createWorkflowJobId,
	deriveJobIdSecret,
	resolveWorkflowJob,
} from "#platform/workflow/job-id";

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
			const notifications = yield* WorkflowExecutionNotifications;
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
					entitySchema: { slug: entitySchemaSlug, owner: definitionOwner(provider.pluginId) },
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
					pluginId: PluginId.make(provider.pluginId),
					entityScope: {
						userId: user.id,
						type: provider.pluginScope === "user" ? ("user" as const) : ("global" as const),
					},
					command: {
						...rootLifecycleCommand({
							occurredAt,
							source: "api",
							lane: "interactive",
							initiator: { id: user.id, kind: "user" },
							accountGeneration: user.accountGeneration,
							executionId: AutomationExecutionId.make(executionId),
							itemIdentity: stableStringify([
								"provider-entity-import",
								user.id,
								providerId,
								entitySchemaSlug,
								externalId,
							]),
						}),
						writeContext: null,
					},
				};
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
				return { jobId: createWorkflowJobId(jobIdSecret, { executionId: admitted.id }, user.id) };
			});

			const resolveJob = Effect.fn("EntityImportService.resolveJob")(function* (
				user: CurrentUserValue,
				jobId: string,
			) {
				const resolvedJobId = trimToNull(jobId);
				const job = resolvedJobId ? resolveWorkflowJob(jobIdSecret, user.id, resolvedJobId) : null;
				if (!job) {
					return yield* new ProviderEntityNotFound({
						reason: { jobId, code: "import-job-not-found" },
					});
				}
				return job;
			});

			const readResult = Effect.fnUntraced(function* (user: CurrentUserValue, executionId: string) {
				const admitted = yield* admission.status({ id: executionId, userId: user.id });
				if (admitted === "queued") {
					return { status: "queued" } satisfies ImportEntityRunResult;
				}
				const result = Option.getOrUndefined(yield* engine.poll(EntityImportWorkflow, executionId));
				// A signed job with neither a ledger row nor a workflow was cancelled before admission.
				if (result === undefined && admitted === null) {
					return { status: "cancelled" } satisfies ImportEntityRunResult;
				}
				return toEntityImportRunResult(result);
			});

			const getImportResult = Effect.fn("EntityImportService.getImportResult")(function* (
				user: CurrentUserValue,
				jobId: string,
			) {
				const { executionId } = yield* resolveJob(user, jobId);
				return yield* awaitWorkflowSettled({
					timeout: "20 seconds",
					backstop: "20 seconds",
					read: readResult(user, executionId),
					identities: [{ executionId, workflowName: EntityImportWorkflow._tag }],
					isSettled: (result) => result.status !== "queued" && result.status !== "running",
				}).pipe(Effect.provideService(WorkflowExecutionNotifications, notifications));
			});

			const cancelImport = Effect.fn("EntityImportService.cancelImport")(function* (
				user: CurrentUserValue,
				jobId: string,
			) {
				const { executionId } = yield* resolveJob(user, jobId);
				yield* admission.cancel({ id: executionId, userId: user.id });
				yield* notifications.publish({ executionId, workflowName: EntityImportWorkflow._tag });
				return { jobId };
			});

			return { cancelImport, getImportResult, import: importEntity };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
