import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	AUTOMATION_HISTORY_LIMITS,
	AutomationHistoryCursor,
	AutomationHistoryFilters,
	AutomationHistoryInternalError,
	AutomationHistoryNotFound,
	AutomationHistoryRequestError,
	AutomationHistoryRetryConflict,
	type AutomationHistoryAttempt,
	type AutomationHistoryDetail,
	type AutomationHistoryPage,
	type AutomationHistoryRetryBody,
	type AutomationHistoryRetryResult,
} from "@ryot-app/contract/modules/automations/history-schemas";
import {
	type AutomationPopulationContext,
	type AutomationRun,
	AutomationRunAttempt,
	type AutomationTriggerPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { AutomationRunId, UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Cause, Context, DateTime, Effect, Layer, Schema } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { makeSandboxObservabilityCollector } from "#lib/infrastructure/sandbox-runtime/observability-host-functions";
import { redactPluginConfig } from "#modules/plugins/config-redaction";

import { AutomationAttemptRepository } from "./attempt-repository";
import { AutomationExecutionOperations } from "./execution";
import { AutomationHistoryRepository } from "./history-repository";
import { AutomationTriggerRepository } from "./trigger-repository";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const internalError = () =>
	new AutomationHistoryInternalError({ reason: { code: "history-unavailable" } });
const parseCursor = Schema.decodeUnknownSync(Schema.fromJsonString(AutomationHistoryCursor));
const encodeCursor = Schema.encodeSync(Schema.fromJsonString(AutomationHistoryCursor));

export const decodeAutomationHistoryCursor = (cursor: string | undefined) =>
	Effect.gen(function* () {
		if (cursor === undefined) {
			return null;
		}
		return yield* Effect.try({
			catch: () => new AutomationHistoryRequestError({ reason: { code: "invalid-cursor" } }),
			try: () => {
				if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) {
					throw new Error("Invalid cursor encoding");
				}
				const text = Buffer.from(cursor, "base64url").toString("utf8");
				if (Buffer.from(text).toString("base64url") !== cursor) {
					throw new Error("Invalid cursor encoding");
				}
				return parseCursor(text);
			},
		});
	});

const properties = (schema: AppSchema | undefined, values: Readonly<Record<string, unknown>>) =>
	schema ? redactPluginConfig(schema, values).config : {};

export const redactAutomationHistoryPayload = (
	payload: AutomationTriggerPayload,
	manifest: PluginManifest | null,
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

const DiagnosticLog = Schema.Struct(AutomationRunAttempt.fields.logs.members[0].value.fields);

export const projectAutomationHistoryAttempt = (
	attempt: AutomationRunAttempt,
): AutomationHistoryAttempt => {
	const {
		returnedValue: _returnedValue,
		workflowExecutionId: _workflowExecutionId,
		...summary
	} = attempt;
	if (attempt.artifactsPrunedAt !== null) {
		return { ...summary, logs: null, error: null, artifactsTruncated: false };
	}
	const collector = makeSandboxObservabilityCollector();
	let truncated = false;
	const sanitize = (entry: typeof DiagnosticLog.Type) => {
		if (
			bytes(entry) > AUTOMATION_HISTORY_LIMITS.attemptBytes ||
			collector.record("log", [entry]) !== null
		) {
			truncated = true;
			return null;
		}
		const serialized = collector.logs[collector.logs.length - 1];
		const sanitized = Schema.decodeSync(Schema.fromJsonString(DiagnosticLog))(serialized ?? "null");
		if (bytes(sanitized) > AUTOMATION_HISTORY_LIMITS.attemptBytes) {
			truncated = true;
			return null;
		}
		return sanitized;
	};
	let error =
		attempt.error === null
			? null
			: {
					code: attempt.failureKind ?? "execution-failed",
					message:
						sanitize({ level: "error", message: attempt.error.message })?.message ??
						"[History error omitted: size limit]",
				};
	if (error !== null && bytes({ error, logs: [] }) > AUTOMATION_HISTORY_LIMITS.attemptBytes) {
		error = { ...error, message: "[History error omitted: size limit]" };
		truncated = true;
	}
	let used = bytes({ error, logs: [] });
	let count = 0;
	const logs =
		attempt.logs === null
			? null
			: attempt.logs.flatMap((entry) => {
					const value = sanitize(entry);
					if (value === null) {
						return [];
					}
					const size = bytes(value) + (count === 0 ? 0 : 1);
					if (used + size > AUTOMATION_HISTORY_LIMITS.attemptBytes) {
						truncated = true;
						return [];
					}
					used += size;
					count += 1;
					return [value];
				});
	return { ...summary, logs, error, artifactsTruncated: truncated };
};

export class AutomationHistoryService extends Context.Service<AutomationHistoryService>()(
	"AutomationHistoryService",
	{
		make: Effect.gen(function* () {
			const history = yield* AutomationHistoryRepository;
			const attempts = yield* AutomationAttemptRepository;
			const triggers = yield* AutomationTriggerRepository;
			const execution = yield* AutomationExecutionOperations;
			const database = yield* Database;
			const persisted = <A, E>(effect: Effect.Effect<A, E, Database>) =>
				effect.pipe(Effect.provideService(Database, database));
			const requireRun = Effect.fn(function* (userId: UserId, runId: AutomationRunId) {
				const [run] = yield* history.summaries({
					runId,
					userId,
					limit: 1,
					filters: {},
					cursor: null,
				});
				if (!run) {
					return yield* new AutomationHistoryNotFound({ reason: { runId, code: "run-not-found" } });
				}
				return run;
			});
			const list = Effect.fn(function* (
				userId: UserId,
				filters: AutomationHistoryFilters,
			): Effect.fn.Return<
				AutomationHistoryPage,
				AutomationHistoryRequestError | AutomationHistoryInternalError
			> {
				yield* Schema.decodeEffect(Schema.toType(AutomationHistoryFilters))(filters).pipe(
					Effect.mapError(
						() => new AutomationHistoryRequestError({ reason: { code: "invalid-filters" } }),
					),
				);
				if (
					filters.from &&
					filters.to &&
					DateTime.toEpochMillis(DateTime.makeUnsafe(filters.from)) >
						DateTime.toEpochMillis(DateTime.makeUnsafe(filters.to))
				) {
					return yield* new AutomationHistoryRequestError({ reason: { code: "invalid-filters" } });
				}
				const cursor = yield* decodeAutomationHistoryCursor(filters.cursor);
				const limit = filters.limit ?? AUTOMATION_HISTORY_LIMITS.defaultPageSize;
				const rows = yield* persisted(
					history.summaries({ cursor, userId, filters, limit: limit + 1 }),
				).pipe(Effect.mapError(internalError));
				const items = rows.slice(0, limit);
				const last = items[items.length - 1];
				return {
					items,
					nextCursor:
						rows.length > limit && last
							? Buffer.from(encodeCursor({ id: last.id, queuedAt: last.queuedAt })).toString(
									"base64url",
								)
							: null,
				};
			});
			const detail = Effect.fn(function* (userId: UserId, runId: AutomationRunId) {
				const run = yield* requireRun(userId, runId);
				const trigger = yield* triggers.findById(run.triggerId);
				if (!trigger) {
					return yield* new AutomationHistoryNotFound({ reason: { runId, code: "run-not-found" } });
				}
				const manifest = yield* history.pinnedManifest(run.pluginRevisionId);
				const retainedPayload =
					trigger.payloadPrunedAt === null && trigger.payload !== null
						? redactAutomationHistoryPayload(trigger.payload, manifest, run.pluginId)
						: null;
				const payloadTruncated =
					retainedPayload !== null &&
					bytes(retainedPayload) > AUTOMATION_HISTORY_LIMITS.payloadBytes;
				const rows = yield* history.attempts(runId);
				const now = DateTime.toDate(yield* DateTime.now);
				const reason = yield* attempts.retryEligibility(runId, now);
				return {
					run,
					retryEligibility: { reason },
					attemptsTruncated: rows.length > AUTOMATION_HISTORY_LIMITS.maxAttempts,
					attempts: rows
						.slice(0, AUTOMATION_HISTORY_LIMITS.maxAttempts)
						.map(projectAutomationHistoryAttempt),
					trigger: {
						id: trigger.id,
						payloadTruncated,
						kind: trigger.kind,
						occurredAt: trigger.occurredAt,
						payloadPrunedAt: trigger.payloadPrunedAt,
						payload: payloadTruncated ? null : retainedPayload,
					},
				} satisfies AutomationHistoryDetail;
			});
			const retry = Effect.fn(function* (
				userId: UserId,
				runId: AutomationRunId,
				body: AutomationHistoryRetryBody,
			) {
				const run = yield* persisted(requireRun(userId, runId));
				const now = DateTime.toDate(yield* DateTime.now);
				const reason = yield* persisted(attempts.retryEligibility(runId, now));
				if (reason !== null) {
					return yield* new AutomationHistoryRetryConflict({ reason: { runId, code: reason } });
				}
				if (run.attemptCount !== body.expectedAttemptCount) {
					return yield* new AutomationHistoryRetryConflict({
						reason: { runId, code: "retry-conflict" },
					});
				}
				const queued = yield* persisted(
					attempts.queueRetry({ now, runId, expectedAttemptCount: body.expectedAttemptCount }),
				).pipe(
					Effect.mapError(
						() => new AutomationHistoryRetryConflict({ reason: { runId, code: "retry-conflict" } }),
					),
				);
				const dispatch = yield* execution
					.submit({ runId, acceptedPatches: [], attemptNumber: queued.attemptNumber })
					.pipe(
						Effect.timeout("5 seconds"),
						Effect.as("submitted" as const),
						Effect.catchCause((cause) =>
							Cause.hasInterruptsOnly(cause)
								? Effect.interrupt
								: Effect.succeed("pending" as const),
						),
					);
				return {
					runId,
					dispatch,
					attemptNumber: queued.attemptNumber,
				} satisfies AutomationHistoryRetryResult;
			});
			const get = (userId: UserId, runId: AutomationRunId) =>
				persisted(detail(userId, runId)).pipe(
					Effect.catchTag("DbError", () => Effect.fail(internalError())),
				);
			return {
				getRun: (user: CurrentUserValue, runId: AutomationRunId) => get(user.id, runId),
				listRuns: (user: CurrentUserValue, filters: AutomationHistoryFilters) =>
					list(user.id, filters),
				retryRun: (
					user: CurrentUserValue,
					runId: AutomationRunId,
					body: AutomationHistoryRetryBody,
				) =>
					retry(user.id, runId, body).pipe(
						Effect.catchTag("DbError", () => Effect.fail(internalError())),
					),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
