import type { IngestionRun } from "@ryot-app/contract/modules/imports/ingestion";
import {
	ImportRunId,
	UserId,
	PluginId,
	PluginRevisionId,
	PluginConfigRevisionId,
	SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { fixtureManifest } from "#modules/plugins/test-support";
import { user } from "#schema/tables/auth";
import { mutationReceipt } from "#schema/tables/mutations";
import { fakeDatabaseSession } from "#testing/effect";

import { ingestionItemIdentity } from "./outcomes";

export const ingestionTestScope = {
	userId: UserId.make("user-1"),
	runId: ImportRunId.make("run-1"),
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
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
	accountGeneration: ingestionTestScope.accountGeneration,
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
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
	configSchema: { fields: {} },
	userBootstrapScriptSlugs: [],
	id: PluginId.make("plugin-1"),
	packageId: fixtureManifest().metadata.packageId,
	revisionId: PluginRevisionId.make("revision-1"),
	configRevisionId: PluginConfigRevisionId.make("config-1"),
	schemaScope: {
		eventSchemas: [],
		signalSchemaSlugs: [],
		entitySchemaSlugs: [],
		relationshipSchemaSlugs: [],
	},
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

export const ingestionTestReceipt = (
	operationId: string,
	commandKind: string,
	result: (typeof mutationReceipt.$inferSelect)["result"],
): typeof mutationReceipt.$inferSelect => ({
	result,
	commandKind,
	dispatch: [],
	batchId: null,
	evidence: null,
	pluginId: null,
	batchIndex: null,
	workflowName: null,
	receiptType: "item",
	mutationScope: "user",
	sandboxScriptId: null,
	pluginRevisionId: null,
	id: `receipt:${operationId}`,
	pluginConfigRevisionId: null,
	executionId: ingestionTestScope.runId,
	ownerUserId: ingestionTestScope.userId,
	scopeUserId: ingestionTestScope.userId,
	recordedAt: new Date(ingestionTestNow),
	rootExecutionId: ingestionTestScope.runId,
	inputFingerprint: `fingerprint:${operationId}`,
	accountGeneration: ingestionTestScope.accountGeneration,
	itemIdentity: ingestionItemIdentity(ingestionTestScope.runId, operationId),
});

export const ingestionTestDatabase = (
	read: () => ReadonlyArray<typeof mutationReceipt.$inferSelect> = () => [],
) =>
	Layer.unwrap(
		Effect.sync(() => {
			const fingerprints = new Map<string, string>();
			const dialect = new PgDialect();
			return fakeDatabaseSession({
				execute: (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
					const [id] = dialect.sqlToQuery(query).params;
					const fingerprint = typeof id === "string" ? (fingerprints.get(id) ?? null) : null;
					return Effect.succeed([{ fingerprint, retiring: false }]);
				},
				select: () => ({
					from: (table: unknown) => ({
						where: () => {
							const rows = Effect.sync(() => {
								if (table === user) {
									return [{ token: ingestionTestScope.accountGeneration.token }];
								}
								if (table !== mutationReceipt) {
									return [];
								}
								return [...read()];
							});
							return Object.assign(rows, { for: () => rows, limit: () => rows });
						},
					}),
				}),
				insert: () => ({
					values: (
						input: Pick<typeof mutationReceipt.$inferInsert, "id" | "inputFingerprint">,
					) => ({
						onConflictDoNothing: () => ({
							returning: () =>
								Effect.sync(() => {
									if (fingerprints.has(input.id)) {
										return [];
									}
									fingerprints.set(input.id, input.inputFingerprint);
									return [{ fingerprint: input.inputFingerprint }];
								}),
						}),
					}),
				}),
			});
		}),
	);
