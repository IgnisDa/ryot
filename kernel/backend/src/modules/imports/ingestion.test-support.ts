import type { IngestionRun } from "@ryot-app/contract/modules/imports/ingestion";
import {
	ImportRunId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { fixtureManifest } from "@ryot-app/contract/testing";
import { Effect, Layer } from "effect";

import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { EntityImportWorkflowOperations } from "#modules/entities/providers/operations-workflow";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import type { ImportItemResult } from "#modules/mutations/idempotency";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { RelationshipsService } from "#modules/relationships/service";
import { emptyScriptsDigest } from "#modules/scripts/authorization/principal.test-support";
import { JobQueue } from "#platform/jobs/queue";
import { TransientValues } from "#platform/transient-values";
import { user } from "#schema/tables/auth";
import { importItem } from "#schema/tables/imports";
import { fakeDatabaseSession } from "#testing/effect";

export const ingestionTestScope = {
	userId: UserId.make("user-1"),
	runId: ImportRunId.make("run-1"),
};
/** Stands in for what a root needs to run a data import, in tests of its other paths. */
export const unusedDataImportServices = Layer.mergeAll(
	Layer.mock(EntitiesService)({}),
	Layer.mock(EntitiesRepository)({}),
	Layer.mock(EventsService)({}),
	Layer.mock(RelationshipsService)({}),
	Layer.mock(ManagedAssetsService)({}),
	Layer.mock(LifecycleExecution)({}),
	Layer.mock(PluginRuntimeResolver)({}),
	Layer.mock(EntityImportWorkflowOperations)({}),
	Layer.mock(JobQueue)({}),
	Layer.mock(TransientValues)({}),
);
export const ingestionTestNow = "2026-01-01T00:00:00.000Z";
export const ingestionTestRun = (overrides: Partial<IngestionRun> = {}): IngestionRun => ({
	summary: [],
	activities: [],
	finishedAt: null,
	blockReasons: [],
	source: "fixture",
	status: "running",
	expiryReason: null,
	failureReason: null,
	integrationId: null,
	blockDeadline: null,
	executionKind: "source",
	collectionSealed: false,
	startedAt: ingestionTestNow,
	id: ingestionTestScope.runId,
	acceptedAt: ingestionTestNow,
	userId: ingestionTestScope.userId,
	pluginInstallationId: "installation-1",
	plan: { selection: {}, operation: "fixture" },
	pins: {
		scriptId: "script-1",
		executionId: "run-1-import",
		pluginRevisionId: "revision-1",
		pluginConfigRevisionId: "config-1",
	},
	...overrides,
});
export const ingestionTestRevision = {
	ownerId: null,
	workflowScripts: {},
	scope: "system" as const,
	configSchema: { fields: {} },
	userBootstrapScriptSlugs: [],
	id: PluginId.make("plugin-1"),
	scriptsDigest: emptyScriptsDigest,
	packageId: fixtureManifest().metadata.packageId,
	revisionId: PluginRevisionId.make("revision-1"),
	configRevisionId: PluginConfigRevisionId.make("config-1"),
};
export const ingestionTestSource = {
	source: "fixture",
	pluginId: "plugin-1",
	namedArtifactPaths: {},
	pluginRevision: ingestionTestRevision,
	pluginInstallationId: "installation-1",
	executionSettings: { userSettings: {} },
	sourcePayload: { apiKey: "private-credential" },
	workflowScriptId: SandboxScriptId.make("script-1"),
};

export const ingestionTestItem = (itemIdentity: string, response: ImportItemResult) => ({
	data: response,
	id: itemIdentity,
});

export const ingestionTestDatabase = (
	read: () => ReadonlyArray<ReturnType<typeof ingestionTestItem>> = () => [],
) =>
	Layer.unwrap(
		Effect.sync(() =>
			fakeDatabaseSession({
				execute: () => Effect.succeed([{ retiring: false, fingerprint: null }]),
				insert: () => ({ values: () => ({ onConflictDoNothing: () => Effect.void }) }),
				select: () => ({
					from: (table: unknown) => ({
						where: () => {
							const rows = Effect.sync(() => {
								if (table === user) {
									return [{ jobAlive: true, retiringAt: null }];
								}
								return table === importItem ? [...read()] : [];
							});
							return Object.assign(rows, { for: () => rows, limit: () => rows });
						},
					}),
				}),
			}),
		),
	);
