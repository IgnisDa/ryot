import { expect } from "bun:test";

import type { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	ImportRunId,
	IntegrationId,
	PluginId,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { recordingChangeSets } from "#modules/changes/change-sets.test-support";
import type { Changes } from "#modules/changes/changes";
import { type DomainLifecycleCommand, DomainWriteChecks } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import { DatabaseSession } from "#platform/db/session";
import { makeWorkflowActivityEngine } from "#testing/effect";

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
	entitySchemaPluginId: PluginId.make("plugin-1"),
};

const commits: Array<{ readonly changes: Changes; readonly command: DomainLifecycleCommand }> = [];
const operationsLayer = EntityImportWorkflowOperationsLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.mock(DatabaseSession)({}),
			Layer.mock(ScriptExecutionService)({}),
			Layer.mock(PluginRuntimeResolver)({}),
			Layer.mock(DomainWriteChecks)({}),
			recordingChangeSets((commit) => Effect.sync(() => void commits.push(commit))),
		),
	),
);

layer(operationsLayer)((test) => {
	test.effect(
		"commits the provider completion as a kernel trigger under each import command",
		() => {
			const commands: LifecycleCommand[] = [
				rootLifecycleCommand({
					occurredAt: now,
					lane: "background",
					accountUserId: userId,
					source: "provider-refresh",
					itemIdentity: "provider-refresh-item",
					initiator: { id: userId, kind: "user" },
					executionId: AutomationExecutionId.make("provider-refresh-command"),
					providerExecutionId: AutomationExecutionId.make("provider-refresh-execution"),
				}),
				rootLifecycleCommand({
					occurredAt: now,
					source: "import",
					lane: "background",
					accountUserId: userId,
					itemIdentity: "import-item",
					initiator: { id: userId, kind: "user" },
					importRunId: ImportRunId.make("import-1"),
					executionId: AutomationExecutionId.make("import-command"),
				}),
				rootLifecycleCommand({
					occurredAt: now,
					lane: "background",
					source: "integration",
					accountUserId: userId,
					itemIdentity: "integration-item",
					importRunId: ImportRunId.make("import-2"),
					integrationId: IntegrationId.make("integration-1"),
					executionId: AutomationExecutionId.make("integration-command"),
					initiator: { kind: "integration", id: IntegrationId.make("integration-1") },
				}),
			];
			const instance = WorkflowInstance.initial(
				ScriptExecutionWorkflow,
				"provider-completion-test",
			);

			return Effect.gen(function* () {
				const operations = yield* EntityImportWorkflowOperations;
				for (const [index, command] of commands.entries()) {
					yield* operations.completeProviderEntityImport(
						{
							providerId,
							entitySchemaSlug,
							externalId: entity.externalId,
							pluginId: PluginId.make("plugin-1"),
							entityScope: { userId, type: "global" },
							command: { ...command, writeContext: null },
							executionId: `provider-completion-${index}`,
						},
						entity,
					);
				}

				expect(commits).toEqual(
					commands.map((command) => ({
						command: { ...command, writeContext: null },
						changes: {
							userId: null,
							triggers: [
								{
									scopeUserId: userId,
									owner: { kind: "plugin", pluginId: entity.entitySchemaPluginId },
									change: {
										userId,
										providerId,
										entitySchemaSlug,
										category: "change",
										entityId: entity.id,
										operation: "complete",
										externalId: entity.externalId,
										resource: "provider-entity-import",
										entitySchemaPluginId: entity.entitySchemaPluginId,
									},
								},
							],
						},
					})),
				);
			}).pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			);
		},
		testTimeout,
	);
});
