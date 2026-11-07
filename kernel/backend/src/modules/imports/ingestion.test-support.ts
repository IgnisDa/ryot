import type { IngestionRun } from "@ryot-app/contract/modules/imports/ingestion";
import {
	ImportRunId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { importItemKey, type ImportItemResult } from "#modules/mutations/idempotency";
import { fixtureManifest } from "#modules/plugins/test-support";
import { emptyScriptsDigest } from "#modules/scripts/authorization/principal.test-support";
import { user } from "#schema/tables/auth";
import { idempotencyKey } from "#schema/tables/mutations";
import { fakeDatabaseSession } from "#testing/effect";

export const ingestionTestScope = {
	userId: UserId.make("user-1"),
	runId: ImportRunId.make("run-1"),
};
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
	response,
	key: importItemKey(ingestionTestScope.runId, itemIdentity),
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
								return table === idempotencyKey ? [...read()] : [];
							});
							return Object.assign(rows, { for: () => rows, limit: () => rows });
						},
					}),
				}),
			}),
		),
	);
