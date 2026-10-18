import { type SandboxFailureKind, SandboxRunError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { EntityId, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { entityEnrichmentRequest as table } from "#schema/tables/enrichment";
import { workflowExecution } from "#schema/tables/workflow-executions";

export type EnrichmentRequestInput = {
	readonly inputHash?: string | undefined;
	readonly cooldown?: boolean | undefined;
	readonly id: string;
	readonly payload: unknown;
	readonly pluginId: string;
	readonly retryOf?: string;
	readonly externalId: string;
	readonly workflowName: string;
	readonly populationPin?: string;
	readonly dispatchRoot?: boolean;
	readonly language: string | null;
	readonly entitySchemaSlug: string;
	readonly entityId: EntityId | null;
	readonly scopeUserId: UserId | null;
	readonly level: "base" | "full" | null;
	readonly providerId: SandboxProviderId;
	readonly sourceContentGeneration?: number;
	readonly requester: AccountGeneration | null;
	readonly populationMode?: "ensure" | "refresh";
	readonly operation: "population" | "translation";
};

export type EnrichmentRequestPatch = {
	readonly state: (typeof table.$inferInsert)["state"] & string;
	readonly attempt?: number;
	readonly nextAttemptAt?: Date | null;
	readonly failureKind?: SandboxFailureKind | null;
};

export class EnrichmentRequestsRepository extends Context.Service<EnrichmentRequestsRepository>()(
	"EnrichmentRequestsRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const get = Effect.fn("EnrichmentRequestsRepository.get")(function* (id: string) {
				const [row] = yield* session.run((db) => db.select().from(table).where(eq(table.id, id)));
				return row ?? null;
			});
			const account = Effect.fn("EnrichmentRequestsRepository.account")(function* (userId: UserId) {
				const [row] = yield* session.run((db) =>
					db
						.select({ disabledAt: user.disabledAt, token: user.accountGeneration })
						.from(user)
						.where(eq(user.id, userId)),
				);
				return row?.disabledAt === null ? { userId, token: row.token } : null;
			});
			const ensure = Effect.fn("EnrichmentRequestsRepository.ensure")(function* (
				input: EnrichmentRequestInput,
			) {
				yield* session.requireTransaction;
				const createdAt = yield* DateTime.nowAsDate;
				let joinedTo: string | null = null;
				const populationPin = input.populationPin;
				if (input.operation === "population" && populationPin !== undefined) {
					yield* lockTarget("population-admission");
					const previous = yield* get(input.id);
					if (previous) {
						return previous;
					}
					const [compatible] = yield* session.run((db) =>
						db
							.select()
							.from(table)
							.where(
								and(
									eq(table.operation, "population"),
									eq(table.providerId, input.providerId),
									eq(table.externalId, input.externalId),
									eq(table.pluginId, input.pluginId),
									eq(table.entitySchemaSlug, input.entitySchemaSlug),
									sql`${table.scopeUserId} is not distinct from ${input.scopeUserId}`,
									eq(table.populationPin, populationPin),
									isNull(table.joinedTo),
									or(
										inArray(table.state, ["queued", "running", "retrying"]),
										input.cooldown
											? and(
													eq(table.state, "succeeded"),
													sql`${table.completedAt} > ${new Date(createdAt.getTime() - 60_000)}`,
												)
											: undefined,
									),
									input.populationMode === "refresh"
										? eq(table.populationMode, "refresh")
										: undefined,
									input.level === "full" ? eq(table.level, "full") : undefined,
								),
							)
							.orderBy(
								sql`case when ${table.state} = 'succeeded' then 1 else 0 end`,
								desc(table.sequence),
							)
							.limit(1),
					);
					joinedTo = compatible?.id ?? null;
					const [capacity] = yield* session.run((db) =>
						db
							.select({
								count: sql<number>`count(*)::int`,
								owned: sql<number>`count(*) filter (where ${table.requesterUserId} is not distinct from ${input.requester?.userId ?? null})::int`,
							})
							.from(table)
							.where(
								and(
									eq(table.operation, "population"),
									inArray(table.state, ["queued", "running", "retrying"]),
								),
							),
					);
					if ((capacity?.count ?? 0) >= 1000 || (input.requester && (capacity?.owned ?? 0) >= 50)) {
						return yield* new SandboxRunError({
							kind: "resource-unavailable",
							data: { code: "execution-limit" },
							message: "Provider population backlog is full",
						});
					}
				}
				yield* session.run((db) =>
					db
						.insert(table)
						.values({
							...input,
							joinedTo,
							createdAt,
							dispatchRoot: input.dispatchRoot ?? false,
							requesterUserId: input.requester?.userId ?? null,
							requesterGeneration: input.requester?.token ?? null,
						})
						.onConflictDoNothing(),
				);
				const [row] = yield* session.run((db) =>
					db
						.select()
						.from(table)
						.where(
							input.retryOf
								? or(eq(table.id, input.id), eq(table.retryOf, input.retryOf))
								: eq(table.id, input.id),
						),
				);
				return row ?? null;
			});
			const claimPopulation = Effect.fn("EnrichmentRequestsRepository.claimPopulation")(function* (
				id: string,
			) {
				yield* session.requireTransaction;
				yield* lockTarget("population-admission");
				const row = yield* get(id);
				if (row?.joinedTo !== null || !["queued", "running", "retrying"].includes(row.state)) {
					return false;
				}
				if (row.state !== "queued") {
					return true;
				}
				const [blocker] = yield* session.run((db) =>
					db
						.select({ id: table.id })
						.from(table)
						.where(
							and(
								eq(table.operation, "population"),
								isNull(table.joinedTo),
								inArray(table.state, ["queued", "running", "retrying"]),
								eq(table.providerId, row.providerId),
								eq(table.externalId, row.externalId),
								eq(table.pluginId, row.pluginId),
								eq(table.entitySchemaSlug, row.entitySchemaSlug),
								sql`${table.scopeUserId} is not distinct from ${row.scopeUserId}`,
								sql`${table.sequence} < ${row.sequence}`,
							),
						)
						.limit(1),
				);
				if (blocker) {
					return false;
				}
				const [running] = yield* session.run((db) =>
					db
						.select({ count: sql<number>`count(*)::int` })
						.from(table)
						.where(
							and(
								eq(table.operation, "population"),
								isNull(table.joinedTo),
								inArray(table.state, ["running", "retrying"]),
							),
						),
				);
				if ((running?.count ?? 0) >= 8) {
					return false;
				}
				yield* update(id, { state: "running" });
				return true;
			});
			const guardPopulation = Effect.fn("EnrichmentRequestsRepository.guardPopulation")(function* (
				id: string,
				attempt?: number,
			) {
				yield* session.requireTransaction;
				const [row] = yield* session.run((db) =>
					db
						.select({ state: table.state, attempt: table.attempt, joinedTo: table.joinedTo })
						.from(table)
						.where(eq(table.id, id))
						.for("update"),
				);
				return (
					row?.joinedTo === null &&
					(attempt === undefined || row.attempt === attempt) &&
					row.state === "running"
				);
			});
			const latestTranslation = Effect.fn("EnrichmentRequestsRepository.latestTranslation")(
				function* (id: string) {
					const row = yield* get(id);
					if (!row) {
						return false;
					}
					const [newer] = yield* session.run((db) =>
						db
							.select({ id: table.id })
							.from(table)
							.where(
								and(
									eq(table.operation, "translation"),
									eq(table.entityId, row.entityId ?? ""),
									eq(table.language, row.language ?? ""),
									sql`${table.sourceContentGeneration} = ${row.sourceContentGeneration}`,
									sql`${table.sequence} > ${row.sequence}`,
								),
							)
							.limit(1),
					);
					return newer === undefined;
				},
			);
			const expiredExecutionStatus = Effect.fn(
				"EnrichmentRequestsRepository.expiredExecutionStatus",
			)(function* (id: string, workflowName: string) {
				const [row] = yield* session.run((db) =>
					db
						.select({ status: workflowExecution.status })
						.from(workflowExecution)
						.where(
							and(
								eq(workflowExecution.executionId, id),
								eq(workflowExecution.workflowName, workflowName),
								isNotNull(workflowExecution.expiredAt),
							),
						),
				);
				return row?.status ?? null;
			});
			const update = Effect.fn("EnrichmentRequestsRepository.update")(function* (
				id: string,
				patch: EnrichmentRequestPatch,
			) {
				const terminal =
					patch.state === "failed" || patch.state === "succeeded" || patch.state === "cancelled";
				const completedAt = terminal ? yield* DateTime.nowAsDate : null;
				const [row] = yield* session.run((db) =>
					db
						.update(table)
						.set({
							...patch,
							completedAt,
							...(terminal ? { payload: {}, nextAttemptAt: null } : {}),
						})
						.where(and(eq(table.id, id), inArray(table.state, ["queued", "running", "retrying"])))
						.returning(),
				);
				return row ?? null;
			});
			const recordBaseCheck = Effect.fn("EnrichmentRequestsRepository.recordBaseCheck")(function* (
				id: string,
				checkedAt: Date,
			) {
				yield* session.requireTransaction;
				yield* session.run((db) =>
					db.update(table).set({ baseCheckedAt: checkedAt }).where(eq(table.id, id)),
				);
			});
			const followers = Effect.fn("EnrichmentRequestsRepository.followers")(function* (id: string) {
				return yield* session.run((db) =>
					db
						.select()
						.from(table)
						.where(
							and(eq(table.joinedTo, id), inArray(table.state, ["queued", "running", "retrying"])),
						),
				);
			});
			const attachEntity = Effect.fn("EnrichmentRequestsRepository.attachEntity")(function* (
				id: string,
				entityId: EntityId,
			) {
				yield* session.run((db) =>
					db
						.update(table)
						.set({ entityId })
						.where(and(eq(table.id, id), isNull(table.entityId))),
				);
			});
			const latest = Effect.fn("EnrichmentRequestsRepository.latest")(function* (input: {
				entityId: EntityId;
				requester: AccountGeneration;
				operation: "population" | "translation";
				language?: string;
				level?: "base" | "full";
			}) {
				const [row] = yield* session.run((db) =>
					db
						.select()
						.from(table)
						.where(
							and(
								eq(table.entityId, input.entityId),
								eq(table.requesterUserId, input.requester.userId),
								eq(table.requesterGeneration, input.requester.token),
								eq(table.operation, input.operation),
								input.level === undefined ? undefined : eq(table.level, input.level),
								input.language === undefined ? undefined : eq(table.language, input.language),
								input.operation === "translation"
									? eq(
											table.sourceContentGeneration,
											sql`(select content_generation from entity where id = ${input.entityId})`,
										)
									: undefined,
							),
						)
						.orderBy(desc(table.sequence))
						.limit(1),
				);
				if (row?.joinedTo) {
					const owner = yield* get(row.joinedTo);
					if (owner) {
						return {
							...row,
							state: owner.state,
							attempt: owner.attempt,
							failureKind: owner.failureKind,
						};
					}
				}
				return row ?? null;
			});
			const pending = Effect.fn("EnrichmentRequestsRepository.pending")(function* () {
				return yield* session.run((db) =>
					db
						.select()
						.from(table)
						.where(
							or(
								inArray(table.state, ["queued", "running", "retrying"]),
								isNull(table.registrationReleasedAt),
							),
						)
						.orderBy(asc(table.observedAt), asc(table.sequence))
						.limit(100),
				);
			});
			const observed = Effect.fn("EnrichmentRequestsRepository.observed")(function* (id: string) {
				const observedAt = yield* DateTime.nowAsDate;
				yield* session.run((db) => db.update(table).set({ observedAt }).where(eq(table.id, id)));
			});
			const released = Effect.fn("EnrichmentRequestsRepository.released")(function* (id: string) {
				const registrationReleasedAt = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db.update(table).set({ registrationReleasedAt }).where(eq(table.id, id)),
				);
			});
			const prune = Effect.fn("EnrichmentRequestsRepository.prune")(function* () {
				yield* session.run((db) =>
					db.execute(sql`delete from entity_enrichment_request where id in (
					select older.id from entity_enrichment_request older
					where older.completed_at < now() - interval '168 hours' and older.registration_released_at is not null
					and not exists (select 1 from entity_enrichment_request follower where follower.joined_to = older.id)
					and (older.base_checked_at is null or exists (select 1 from entity_enrichment_request checked
						where checked.entity_id = older.entity_id and checked.base_checked_at >= older.base_checked_at and checked.sequence > older.sequence))
					and exists (select 1 from entity_enrichment_request newer where newer.sequence > older.sequence
						and newer.provider_id = older.provider_id and newer.external_id = older.external_id
						and newer.entity_schema_slug = older.entity_schema_slug and newer.plugin_id = older.plugin_id
						and newer.scope_user_id is not distinct from older.scope_user_id
						and newer.requester_user_id is not distinct from older.requester_user_id
						and newer.requester_generation is not distinct from older.requester_generation
						and newer.operation = older.operation and newer.level is not distinct from older.level
						and newer.language is not distinct from older.language)
					order by older.sequence limit 100)`),
				);
			});
			const lockTarget = Effect.fn("EnrichmentRequestsRepository.lockTarget")(function* (
				key: string,
			) {
				yield* session.requireTransaction;
				yield* session.run((db) =>
					db.execute(sql`select pg_advisory_xact_lock(hashtext(${`entity-enrichment:${key}`}))`),
				);
			});
			return {
				get,
				prune,
				ensure,
				update,
				latest,
				pending,
				account,
				observed,
				released,
				followers,
				lockTarget,
				attachEntity,
				recordBaseCheck,
				claimPopulation,
				guardPopulation,
				latestTranslation,
				expiredExecutionStatus,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
