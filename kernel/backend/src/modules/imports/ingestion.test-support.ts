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

import { user } from "#lib/infrastructure/db/schema/tables/auth";
import { mutationReceipt } from "#lib/infrastructure/db/schema/tables/mutations";
import { fakeDatabaseSession } from "#lib/test-utils/effect";

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
	slug: "fixture",
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
	configSchema: { fields: {} },
	userBootstrapScriptSlugs: [],
	id: PluginId.make("plugin-1"),
	revisionId: PluginRevisionId.make("revision-1"),
	configRevisionId: PluginConfigRevisionId.make("config-1"),
	schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
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
	itemIdentity: JSON.stringify(["ingestion", ingestionTestScope.runId, operationId]),
});

export const ingestionTestDatabase = (
	read: () => ReadonlyArray<typeof mutationReceipt.$inferSelect> = () => [],
) =>
	Layer.unwrap(
		Effect.sync(() => {
			const fingerprints = new Map<string, string>();
			const dialect = new PgDialect();
			return fakeDatabaseSession({
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
				select: (fields?: Readonly<Record<string, unknown>>) => ({
					from: (table: unknown) => ({
						where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
							const rows = Effect.sync(() => {
								if (table === user) {
									return [{ token: ingestionTestScope.accountGeneration.token }];
								}
								if (table !== mutationReceipt) {
									return [];
								}
								if (fields && "fingerprint" in fields) {
									const [id] = dialect.sqlToQuery(condition).params;
									const fingerprint = typeof id === "string" ? fingerprints.get(id) : undefined;
									return fingerprint === undefined ? [] : [{ fingerprint }];
								}
								return [...read()];
							});
							return Object.assign(rows, { for: () => rows, limit: () => rows });
						},
					}),
				}),
			});
		}),
	);
