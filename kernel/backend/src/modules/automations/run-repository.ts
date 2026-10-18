import { DbError } from "@ryot-app/contract/errors";
import { AUTOMATION_HISTORY_LIMITS } from "@ryot-app/contract/modules/automations/history-schemas";
import {
	type AutomationPopulationContext,
	AutomationRun,
	AutomationRunSkipReason,
	type AutomationTriggerPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { AutomationRunId, AutomationTriggerId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import {
	and,
	asc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	lte,
	notInArray,
	or,
	sql,
} from "drizzle-orm";
import { Array as Arr, Context, DateTime, Effect, Layer, Schema } from "effect";

import { redactPluginConfig } from "#modules/plugins/configuration/redaction";
import { insertChunkSize } from "#platform/db/bind-parameters";
import { DatabaseSession } from "#platform/db/session";
import { automationRun as table } from "#schema/tables/automations";
import { pluginRevision } from "#schema/tables/core";

const policyChainStopped = Schema.decodeSync(AutomationRunSkipReason)({
	code: "policy-chain-stopped",
});

const decodeRow = ({
	historyPayload: _historyPayload,
	historyPayloadTruncated: _historyPayloadTruncated,
	...row
}: typeof table.$inferSelect) =>
	decodeStoredSchema(
		{
			...row,
			queuedAt: row.queuedAt.toISOString(),
			startedAt: row.startedAt?.toISOString() ?? null,
			finishedAt: row.finishedAt?.toISOString() ?? null,
			artifactsExpireAt: row.artifactsExpireAt.toISOString(),
			nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
		},
		AutomationRun,
		`Invalid automation run ${row.id}`,
	);

const jsonBytes = (value: JsonValue) => Buffer.byteLength(JSON.stringify(value), "utf8");

type PinnedSchemas = Pick<
	PluginManifest,
	"entitySchemas" | "signalSchemas" | "relationshipSchemas"
>;

const properties = (schema: AppSchema | undefined, values: Readonly<Record<string, unknown>>) =>
	schema ? redactPluginConfig(schema, values).config : {};

export const redactAutomationHistoryPayload = (
	payload: AutomationTriggerPayload,
	manifest: null | PinnedSchemas,
	pluginId: AutomationRun["pluginId"],
): JsonValue => {
	const entitySchema = (slug: string) =>
		manifest?.entitySchemas.find((schema) => schema.slug === slug);
	if (payload.resource === "signal") {
		const signalSchema =
			payload.signalSchemaPluginId === pluginId
				? manifest?.signalSchemas.find((schema) => schema.slug === payload.signalSchemaSlug)
				: undefined;
		return Schema.decodeUnknownSync(JsonValue)({
			...payload,
			properties: properties(signalSchema?.propertiesSchema, payload.properties),
		});
	}
	if (payload.resource === "provider-entity-import") {
		return payload;
	}
	const redactPopulation = (population: AutomationPopulationContext) =>
		population.parentEntity
			? {
					...population,
					parentEntity: {
						...population.parentEntity,
						properties: properties(
							entitySchema(population.parentEntity.entitySchemaSlug)?.propertiesSchema,
							population.parentEntity.properties,
						),
					},
				}
			: population;
	if (payload.operation === "batch") {
		return Schema.decodeSync(JsonValue)({
			...payload,
			items: payload.items.map((item) => redactAutomationHistoryPayload(item, manifest, pluginId)),
		});
	}
	const snapshot = (value: Readonly<Record<string, unknown>>) => {
		let schema: AppSchema | undefined;
		if (payload.resource === "entity") {
			schema = entitySchema(String(value["entitySchemaSlug"]))?.propertiesSchema;
		} else if (payload.resource === "event") {
			schema = entitySchema(String(value["entitySchemaSlug"]))?.eventSchemas.find(
				(event) => event.slug === value["eventSchemaSlug"],
			)?.propertiesSchema;
		} else {
			schema = manifest?.relationshipSchemas.find(
				(relationship) => relationship.slug === value["relationshipSchemaSlug"],
			)?.propertiesSchema;
		}
		const values = value["properties"];
		return { ...value, properties: properties(schema, isObjectRecord(values) ? values : {}) };
	};
	const result: Record<string, unknown> = { ...payload };
	if ("draft" in payload) {
		result["draft"] = snapshot(payload.draft);
	}
	if ("before" in payload) {
		result["before"] = snapshot(payload.before);
	}
	if ("after" in payload) {
		result["after"] = snapshot(payload.after);
	}
	if ("population" in payload && payload.population) {
		result["population"] = redactPopulation(payload.population);
	}
	return Schema.decodeUnknownSync(JsonValue)(result);
};

const immutableFields = (run: AutomationRun) => ({
	id: run.id,
	stage: run.stage,
	pluginId: run.pluginId,
	hookSlug: run.hookSlug,
	hookName: run.hookName,
	delivery: run.delivery,
	queuedAt: run.queuedAt,
	triggerId: run.triggerId,
	scriptSlug: run.scriptSlug,
	retryPolicy: run.retryPolicy,
	executionUserId: run.executionUserId,
	pluginRevisionId: run.pluginRevisionId,
	scriptContentHash: run.scriptContentHash,
	artifactsExpireAt: run.artifactsExpireAt,
	pluginConfigRevisionId: run.pluginConfigRevisionId,
});

export class AutomationRunRepository extends Context.Service<AutomationRunRepository>()(
	"AutomationRunRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const findById = Effect.fn(function* (id: AutomationRunId) {
				const [row] = yield* session.run((db) => db.select().from(table).where(eq(table.id, id)));
				return row ? yield* decodeRow(row) : null;
			});
			const insertQueued = Effect.fn(function* (input: {
				runs: ReadonlyArray<AutomationRun>;
				triggerPayload: AutomationTriggerPayload;
			}) {
				const values = yield* decodeStoredSchema(
					input.runs,
					Schema.Array(AutomationRun),
					"Invalid queued automation run",
				);
				if (
					values.some(
						(value) =>
							value.status !== "queued" ||
							value.attemptCount !== 0 ||
							value.startedAt !== null ||
							value.finishedAt !== null ||
							value.nextAttemptAt !== null ||
							value.skipReason !== null ||
							value.sandboxScriptId === null,
					)
				) {
					return yield* new DbError({
						message:
							"New automation runs must be queued with a pinned script and no execution state",
					});
				}
				if (!values.length) {
					return [];
				}
				const revisionIds = [
					...new Set(
						values.flatMap(({ pluginRevisionId }) =>
							pluginRevisionId === null ? [] : [pluginRevisionId],
						),
					),
				];
				const revisions = revisionIds.length
					? yield* session.run((db) =>
							db
								.select({
									id: pluginRevision.id,
									entitySchemas: sql<
										PinnedSchemas["entitySchemas"]
									>`coalesce(${pluginRevision.entitySchemas}, '[]'::jsonb)`,
									signalSchemas: sql<
										PinnedSchemas["signalSchemas"]
									>`coalesce(${pluginRevision.signalSchemas}, '[]'::jsonb)`,
									relationshipSchemas: sql<
										PinnedSchemas["relationshipSchemas"]
									>`coalesce(${pluginRevision.relationshipSchemas}, '[]'::jsonb)`,
								})
								.from(pluginRevision)
								.where(inArray(pluginRevision.id, revisionIds)),
						)
					: [];
				const schemas = new Map(revisions.map((revision) => [revision.id, revision]));
				const histories = new Map<
					string,
					Pick<typeof table.$inferSelect, "historyPayload" | "historyPayloadTruncated">
				>();
				const rows = values.map((value) => {
					const key = stableStringify([value.pluginRevisionId, value.pluginId]);
					let history = histories.get(key);
					if (!history) {
						const manifest =
							value.pluginRevisionId === null
								? null
								: (schemas.get(value.pluginRevisionId) ?? null);
						const redacted = redactAutomationHistoryPayload(
							input.triggerPayload,
							manifest,
							value.pluginId,
						);
						const truncated = jsonBytes(redacted) > AUTOMATION_HISTORY_LIMITS.payloadBytes;
						history = {
							historyPayloadTruncated: truncated,
							historyPayload: truncated ? null : redacted,
						};
						histories.set(key, history);
					}
					return {
						...value,
						...history,
						startedAt: null,
						finishedAt: null,
						nextAttemptAt: null,
						queuedAt: DateTime.toDate(DateTime.makeUnsafe(value.queuedAt)),
						artifactsExpireAt: DateTime.toDate(DateTime.makeUnsafe(value.artifactsExpireAt)),
					};
				});
				for (const chunk of Arr.chunksOf(rows, insertChunkSize(table))) {
					yield* session.run((db) => db.insert(table).values(chunk).onConflictDoNothing());
				}
				const storedRows = yield* session.run((db) =>
					db
						.select()
						.from(table)
						.where(
							inArray(
								table.id,
								values.map(({ id }) => id),
							),
						),
				);
				const storedRuns = yield* Effect.forEach(storedRows, decodeRow);
				const byId = new Map(storedRuns.map((run) => [run.id, run]));
				return yield* Effect.forEach(values, (value) => {
					const stored = byId.get(value.id);
					if (
						!stored ||
						stableStringify(immutableFields(stored)) !== stableStringify(immutableFields(value)) ||
						(stored.sandboxScriptId !== null && stored.sandboxScriptId !== value.sandboxScriptId)
					) {
						return Effect.fail(
							new DbError({ message: `Automation run identity conflict: ${value.id}` }),
						);
					}
					return Effect.succeed(stored);
				});
			});
			const listByTrigger = Effect.fn(function* (triggerId: AutomationTriggerId) {
				const rows = yield* session.run((db) =>
					db
						.select()
						.from(table)
						.where(eq(table.triggerId, triggerId))
						.orderBy(asc(table.queuedAt), asc(table.id)),
				);
				return yield* Effect.forEach(rows, decodeRow);
			});
			const listDispatchStates = Effect.fn(function* (ids: ReadonlyArray<AutomationRunId>) {
				return yield* session.run((db) =>
					db
						.select({ id: table.id, status: table.status, attemptCount: table.attemptCount })
						.from(table)
						.where(inArray(table.id, [...ids])),
				);
			});
			const listQueuedCandidates = Effect.fn(function* (input: {
				now: Date;
				limit: number;
				initialQueuedBefore: Date;
			}) {
				if (
					!Number.isSafeInteger(input.limit) ||
					input.limit < 1 ||
					!Number.isFinite(input.now.getTime()) ||
					!Number.isFinite(input.initialQueuedBefore.getTime())
				) {
					return yield* new DbError({
						message: "Queued candidate query requires a valid time and positive integer limit",
					});
				}
				const rows = yield* session.run((db) =>
					db
						.select()
						.from(table)
						.where(
							and(
								eq(table.status, "queued"),
								eq(table.stage, "after"),
								lte(table.queuedAt, input.now),
								or(isNull(table.nextAttemptAt), lte(table.nextAttemptAt, input.now)),
								or(gt(table.attemptCount, 0), lte(table.queuedAt, input.initialQueuedBefore)),
							),
						)
						.orderBy(asc(table.queuedAt), asc(table.id))
						.limit(input.limit),
				);
				return yield* Effect.forEach(rows, decodeRow);
			});
			const skipQueuedPolicies = Effect.fn(function* (input: { triggerId: AutomationTriggerId }) {
				const queuedPolicy = and(
					eq(table.triggerId, input.triggerId),
					eq(table.stage, "before"),
					eq(table.status, "queued"),
					eq(table.attemptCount, 0),
				);
				return yield* session
					.transaction(
						session.run((transaction) =>
							Effect.gen(function* () {
								const rows = yield* transaction
									.select({ id: table.id })
									.from(table)
									.where(queuedPolicy)
									.orderBy(asc(table.id))
									.for("update");
								if (rows.length === 0) {
									return;
								}
								const finishedAt = DateTime.toDate(yield* DateTime.now);
								yield* transaction
									.update(table)
									.set({ finishedAt, status: "skipped", skipReason: policyChainStopped })
									.where(
										and(
											queuedPolicy,
											inArray(
												table.id,
												rows.map(({ id }) => id),
											),
										),
									);
							}),
						),
					)
					.pipe(
						Effect.mapError((error) =>
							error._tag === "DatabaseSessionStateError"
								? new DbError({ message: "Automation run transaction already active" })
								: error,
						),
					);
			});
			const clearExpiredScriptPins = Effect.fn(function* (input: { now: Date; limit: number }) {
				return yield* session.run((db) => {
					const expiredTerminal = and(
						isNotNull(table.sandboxScriptId),
						lte(table.artifactsExpireAt, input.now),
						isNull(table.nextAttemptAt),
						notInArray(table.status, ["queued", "running"]),
					);
					const candidates = db
						.select({ id: table.id })
						.from(table)
						.where(expiredTerminal)
						.orderBy(asc(table.artifactsExpireAt), asc(table.id))
						.limit(input.limit);
					return db
						.update(table)
						.set({ sandboxScriptId: null })
						.where(and(inArray(table.id, candidates), expiredTerminal))
						.returning({ id: table.id });
				});
			});
			const clearHistoryPayloads = Effect.fn(function* (triggerIds: ReadonlyArray<string>) {
				if (triggerIds.length === 0) {
					return;
				}
				yield* session.run((db) =>
					db
						.update(table)
						.set({ historyPayload: null, historyPayloadTruncated: false })
						.where(inArray(table.triggerId, [...triggerIds])),
				);
			});
			const deleteExpired = Effect.fn(function* (input: {
				now: Date;
				before: Date;
				limit: number;
			}) {
				return yield* session.run((db) => {
					const expiredHistory = and(
						lte(table.queuedAt, input.before),
						lte(table.artifactsExpireAt, input.now),
						isNull(table.nextAttemptAt),
						notInArray(table.status, ["queued", "running"]),
					);
					const candidates = db
						.select({ id: table.id })
						.from(table)
						.where(expiredHistory)
						.orderBy(asc(table.queuedAt), asc(table.id))
						.limit(input.limit);
					return db
						.delete(table)
						.where(and(inArray(table.id, candidates), expiredHistory))
						.returning({ id: table.id });
				});
			});
			return {
				findById,
				insertQueued,
				deleteExpired,
				listByTrigger,
				listDispatchStates,
				skipQueuedPolicies,
				clearHistoryPayloads,
				listQueuedCandidates,
				clearExpiredScriptPins,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
