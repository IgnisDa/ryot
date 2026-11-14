import { type SandboxFailureKind, SandboxRunError } from "@ryot-app/contract/errors";
import { type EntityId, type SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { entityEnrichmentRequest as table } from "#schema/tables/enrichment";
import { job } from "#schema/tables/jobs";

export type EnrichmentRequestPatch = {
	readonly attempt?: number;
	readonly failureKind?: null | SandboxFailureKind;
	readonly state: string & (typeof table.$inferInsert)["state"];
};

export type EnrichmentRequestInput = {
	readonly id: string;
	readonly payload: unknown;
	readonly pluginId: string;
	readonly retryOf?: string;
	readonly externalId: string;
	readonly populationPin?: string;
	readonly language: null | string;
	readonly entitySchemaSlug: string;
	readonly requester: null | UserId;
	readonly entityId: null | EntityId;
	readonly scopeUserId: null | UserId;
	readonly level: null | "base" | "full";
	readonly providerId: SandboxProviderId;
	readonly inputHash?: string | undefined;
	readonly cooldown?: boolean | undefined;
	readonly sourceContentGeneration?: number;
	readonly populationMode?: "ensure" | "refresh";
	readonly operation: "population" | "translation";
};

export class EnrichmentRequestsRepository extends Context.Service<EnrichmentRequestsRepository>()(
	"@ryot-app/kernel-backend/modules/entities/enrichment/repository/EnrichmentRequestsRepository",
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
						.select({ token: user.id, disabledAt: user.disabledAt })
						.from(user)
						.where(eq(user.id, userId)),
				);
				return row?.disabledAt === null ? userId : null;
			});
			const ensure = Effect.fn("EnrichmentRequestsRepository.ensure")(function* (
				input: EnrichmentRequestInput,
			) {
				yield* session.requireTransaction;
				const createdAt = yield* DateTime.nowAsDate;
				let joinedTo: null | string = null;
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
								owned: sql<number>`count(*) filter (where ${table.requesterUserId} is not distinct from ${input.requester})::int`,
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
						.values({ ...input, joinedTo, createdAt, requesterUserId: input.requester })
						.onConflictDoNothing(),
				);
				if (input.operation === "population" && input.level === "full" && input.requester) {
					yield* session.run((db) =>
						db.execute(sql`with superseded as (
							select request.id from ${table} request
							join ${job} queued on queued.key = request.id and queued.status = 'queued'
							where request.operation = 'population' and request.level = 'base'
								and request.state = 'queued' and request.joined_to is null and request.id <> ${input.id}
								and request.requester_user_id = ${input.requester}
								and request.provider_id = ${input.providerId} and request.external_id = ${input.externalId}
								and request.plugin_id = ${input.pluginId} and request.entity_schema_slug = ${input.entitySchemaSlug}
								and request.scope_user_id is not distinct from ${input.scopeUserId}
								and not exists (select 1 from ${table} follower where follower.joined_to = request.id)
							for update of request, queued skip locked
						), unqueued as (
							delete from ${job} where key in (select id from superseded) and status = 'queued'
						)
						update ${table} set state = 'cancelled', completed_at = ${createdAt}, payload = '{}'
						where id in (select id from superseded)`),
					);
				}
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
						.set({ ...patch, completedAt, ...(terminal ? { payload: {} } : {}) })
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
				language?: string;
				requester: UserId;
				entityId: EntityId;
				level?: "base" | "full";
				operation: "population" | "translation";
			}) {
				const [row] = yield* session.run((db) =>
					db
						.select()
						.from(table)
						.where(
							and(
								eq(table.entityId, input.entityId),
								eq(table.requesterUserId, input.requester),
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
			const requesterIds = Effect.fn("EnrichmentRequestsRepository.requesterIds")(function* (
				id: string,
			) {
				const rows = yield* session.run((db) =>
					db
						.selectDistinct({ userId: table.requesterUserId })
						.from(table)
						.where(or(eq(table.id, id), eq(table.joinedTo, id))),
				);
				return rows.flatMap(({ userId }) => (userId === null ? [] : [UserId.make(userId)]));
			});
			// A job that ran out of attempts never reached its handler to settle the request.
			const failOrphaned = Effect.fn("EnrichmentRequestsRepository.failOrphaned")(function* (
				limit: number,
			) {
				return yield* session.run((db) =>
					db.execute<{ entity_id: null | string; requester_user_id: null | string }>(
						sql`with orphaned as (
							select request.id from ${table} request
							where request.state in ('queued', 'running', 'retrying') and request.joined_to is null
								and not exists (select 1 from ${job} j where j.key = request.id and j.status in ('queued', 'running'))
							order by request.sequence limit ${limit}
						)
						update ${table} set state = 'failed', failure_kind = 'infrastructure', completed_at = now(), payload = '{}'
						where state in ('queued', 'running', 'retrying')
							and (id in (select id from orphaned) or joined_to in (select id from orphaned))
						returning entity_id, requester_user_id`,
						"objects",
					),
				);
			});
			const prune = Effect.fn("EnrichmentRequestsRepository.prune")(function* () {
				yield* session.run((db) =>
					db.execute(sql`delete from entity_enrichment_request where id in (
					select older.id from entity_enrichment_request older
					where older.completed_at < now() - interval '168 hours'
					and not exists (select 1 from entity_enrichment_request follower where follower.joined_to = older.id)
					and (older.base_checked_at is null or exists (select 1 from entity_enrichment_request checked
						where checked.entity_id = older.entity_id and checked.base_checked_at >= older.base_checked_at and checked.sequence > older.sequence))
					and exists (select 1 from entity_enrichment_request newer where newer.sequence > older.sequence
						and newer.provider_id = older.provider_id and newer.external_id = older.external_id
						and newer.entity_schema_slug = older.entity_schema_slug and newer.plugin_id = older.plugin_id
						and newer.scope_user_id is not distinct from older.scope_user_id
						and newer.requester_user_id is not distinct from older.requester_user_id
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
				account,
				followers,
				lockTarget,
				failOrphaned,
				requesterIds,
				attachEntity,
				recordBaseCheck,
				guardPopulation,
				latestTranslation,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
