import { expect, layer } from "@effect/vitest";
import {
	AutomationRun,
	type AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationHookSlug,
	AutomationRunId,
	EntityId,
	EntitySchemaSlug,
	ImportRunId,
	IntegrationId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Effect, Layer, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand, type LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { mapDatabaseErrors } from "#lib/infrastructure/db/errors";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { EntityImportWorkflow } from "./entity-import-workflow";
import { RecordedLogAnnotations, recordLogAnnotationsLayer } from "./log-annotations.test-support";
import {
	EntityImportWorkflowOperations,
	EntityImportWorkflowOperationsLive,
} from "./operations-workflow";

const now = IsoUtcString.make("2026-09-16T00:00:00.000Z");
const userId = UserId.make("user-1");
const providerId = SandboxProviderId.make("provider-1");
const entitySchemaSlug = EntitySchemaSlug.make("record");
const entity = {
	providerId,
	name: "Record",
	properties: {},
	createdAt: now,
	updatedAt: now,
	populatedAt: now,
	entitySchemaSlug,
	externalId: "external-1",
	id: EntityId.make("entity-1"),
};

const makeRun = (trigger: AutomationTrigger) =>
	Schema.decodeSync(AutomationRun)({
		queuedAt: now,
		stage: "after",
		startedAt: null,
		attemptCount: 0,
		finishedAt: null,
		skipReason: null,
		status: "queued",
		nextAttemptAt: null,
		delivery: "required",
		triggerId: trigger.id,
		artifactsExpireAt: now,
		executionUserId: userId,
		hookName: "After import",
		scriptSlug: "after-import",
		scriptContentHash: "content-hash",
		pluginId: PluginId.make("plugin-1"),
		sandboxScriptId: SandboxScriptId.make("script-1"),
		pluginRevisionId: PluginRevisionId.make("revision-1"),
		hookSlug: AutomationHookSlug.make("fixture.after-import"),
		id: AutomationRunId.make(`run-${trigger.causation.source}`),
		pluginConfigRevisionId: PluginConfigRevisionId.make("config-1"),
		retryPolicy: {
			maxAttempts: 1,
			maxDelayMs: 1_000,
			initialDelayMs: 1_000,
			externalIdempotency: "none",
		},
	});

const planned: AutomationTrigger[] = [];
const executed: Array<{ triggerId: string; runIds: string[] }> = [];
let inTransaction = false;
const database = DatabaseSession.of({
	requireRoot: Effect.void,
	requireTransaction: Effect.void,
	acquireUserWriteLock: () => Effect.void,
	isTransactionActive: Effect.sync(() => inTransaction),
	run: (statement) => mapDatabaseErrors(statement(Object.create(null))),
	transaction: (work) =>
		Effect.suspend(() => {
			inTransaction = true;
			return mapDatabaseErrors(work).pipe(
				Effect.ensuring(Effect.sync(() => (inTransaction = false))),
			);
		}),
});
const planner = LifecyclePlanner.of(
	withLifecycleBatchPlanning({
		plan: ({ trigger }) =>
			Effect.sync(() => {
				expect(inTransaction).toBe(true);
				planned.push(trigger);
				return { trigger, policies: [], wasCreated: true, runs: [makeRun(trigger)] };
			}),
	}),
);
const execution = withLifecycleDispatch({
	executePolicy: () => Effect.die("provider completion cannot execute before policies"),
	skipQueuedPolicies: () => Effect.die("provider completion cannot stop a policy chain"),
	after: ({ runs, triggerId }) =>
		Effect.sync(() => {
			expect(inTransaction).toBe(false);
			executed.push({ triggerId, runIds: runs.map(({ id }) => id) });
			return runs.map(({ id, hookSlug }) => ({
				hookSlug,
				runId: id,
				code: "required-hook-failed" as const,
			}));
		}),
});
const operationsLayer = EntityImportWorkflowOperationsLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(DatabaseSession, database),
			Layer.succeed(LifecyclePlanner, planner),
			Layer.succeed(LifecycleExecution, execution),
			Layer.mock(SandboxExecutionService)({}),
			Layer.mock(PluginRuntimeResolver)({}),
		),
	),
);

layer(
	Layer.merge(
		recordLogAnnotationsLayer("provider import completed with automation warnings"),
		operationsLayer,
	),
)((test) => {
	test.effect(
		"plans provider completion in a short transaction and invokes common execution",
		() => {
			const commands: LifecycleCommand[] = [
				rootLifecycleCommand({
					occurredAt: now,
					source: "provider-refresh",
					itemIdentity: "provider-refresh-item",
					initiator: { id: userId, kind: "user" },
					executionId: AutomationExecutionId.make("provider-refresh-command"),
					providerExecutionId: AutomationExecutionId.make("provider-refresh-execution"),
				}),
				rootLifecycleCommand({
					occurredAt: now,
					source: "import",
					itemIdentity: "import-item",
					initiator: { id: userId, kind: "user" },
					importRunId: ImportRunId.make("import-1"),
					executionId: AutomationExecutionId.make("import-command"),
				}),
				rootLifecycleCommand({
					occurredAt: now,
					source: "integration",
					itemIdentity: "integration-item",
					importRunId: ImportRunId.make("import-2"),
					integrationId: IntegrationId.make("integration-1"),
					executionId: AutomationExecutionId.make("integration-command"),
					initiator: { kind: "integration", id: IntegrationId.make("integration-1") },
				}),
			];
			const instance = WorkflowInstance.initial(EntityImportWorkflow, "provider-completion-test");

			return Effect.gen(function* () {
				const operations = yield* EntityImportWorkflowOperations;
				for (const [index, command] of commands.entries()) {
					yield* operations.completeProviderEntityImport(
						{
							command,
							providerId,
							entitySchemaSlug,
							externalId: entity.externalId,
							entityScope: { userId, type: "global" },
							executionId: `provider-completion-${index}`,
						},
						entity,
						`provider-completion-${index}`,
					);
				}

				expect(planned).toHaveLength(3);
				expect(planned.map(({ causation }) => causation)).toEqual(
					commands.map(({ causation }) => causation),
				);
				expect(planned.map(({ payload, scopeUserId }) => ({ payload, scopeUserId }))).toEqual(
					commands.map(() => ({
						scopeUserId: userId,
						payload: {
							userId,
							providerId,
							entitySchemaSlug,
							category: "change",
							entityId: entity.id,
							operation: "complete",
							externalId: entity.externalId,
							resource: "provider-entity-import",
						},
					})),
				);
				expect(executed).toEqual(
					planned.map((trigger) => ({
						triggerId: trigger.id,
						runIds: [`run-${trigger.causation.source}`],
					})),
				);
				expect(yield* (yield* RecordedLogAnnotations).annotations).toEqual(
					planned.map((trigger) => ({
						warningCount: 1,
						warnings: [
							{
								code: "required-hook-failed",
								hookSlug: "fixture.after-import",
								runId: `run-${trigger.causation.source}`,
							},
						],
					})),
				);
			}).pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			);
		},
	);
});
