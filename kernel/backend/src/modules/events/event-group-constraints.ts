import { DbError } from "@ryot-app/contract/errors";
import type { AutomationEventDraft } from "@ryot-app/contract/modules/automations/lifecycle";
import { EventBadRequest, EventStale } from "@ryot-app/contract/modules/events/schemas";
import { PluginEventGroup } from "@ryot-app/contract/modules/plugins/event-groups";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { type SQL, sql } from "drizzle-orm";
import { Context, Effect, Schema } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import { DatabaseSession } from "#platform/db/session";
import { runRootTransaction } from "#platform/db/transaction";

const violation = (message: string) =>
	new EventBadRequest({
		reason: { code: "mutation-conflict", message: `Event group constraint violated: ${message}` },
	});

const StoredGroupRecord = Schema.Struct({
	id: EventId,
	userId: UserId,
	entityId: EntityId,
	revision: Schema.Int,
	eventSchemaSlug: EventSchemaSlug,
	entitySchemaSlug: EntitySchemaSlug,
	sessionEntityId: Schema.NullOr(EntityId),
	eventSchemaPluginId: Schema.NullOr(PluginId),
	properties: Schema.Record(Schema.String, Schema.Unknown),
});
const StoredGroupDeclaration = Schema.Struct({
	eventGroup: PluginEventGroup,
	eventSchemaSlug: EventSchemaSlug,
	pluginId: Schema.NullOr(PluginId),
	entitySchemaSlug: EntitySchemaSlug,
});
export type EventGroupDeclaration = typeof StoredGroupDeclaration.Type;
type GroupBinding = { readonly eventId: EventId; readonly anchorId: EventId };
type GroupSource = Pick<
	AutomationEventDraft,
	"entityId" | "sessionEntityId" | "eventSchemaSlug" | "entitySchemaSlug" | "eventSchemaPluginId"
>;
type PendingGroups = {
	readonly eventIds: Set<EventId>;
	readonly selections: Set<string>;
	readonly entityIds: Set<EntityId>;
	readonly sessionIds: Set<EntityId>;
	readonly bindings: Array<GroupBinding>;
	readonly createdEventIds: Set<EventId>;
	readonly declarations: Map<string, EventGroupDeclaration>;
	readonly before: Map<EventId, typeof StoredGroupRecord.Type>;
};
type ValidationScope = {
	readonly userId: UserId;
	readonly allSessions: boolean;
	readonly eventIds: ReadonlyArray<EventId>;
	readonly entityIds: ReadonlyArray<EntityId>;
	readonly sessionIds: ReadonlyArray<EntityId>;
	readonly bindings: ReadonlyArray<GroupBinding>;
	readonly createdEventIds: ReadonlyArray<EventId>;
	readonly declarations: ReadonlyArray<EventGroupDeclaration>;
	readonly before: ReadonlyArray<typeof StoredGroupRecord.Type>;
};
const PendingEventGroups = Context.Reference<null | Map<UserId, PendingGroups>>(
	"EventGroupConstraints.Pending",
	{ defaultValue: () => null },
);
const selectionKey = (row: Pick<GroupSource, "entitySchemaSlug" | "eventSchemaPluginId">) =>
	stableStringify([row.eventSchemaPluginId, row.entitySchemaSlug]);
const valuesSql = (values: ReadonlyArray<string>) =>
	sql`select jsonb_array_elements_text(${stableStringify(values)}::jsonb)`;
const sameProperties = (left: SQL, right: SQL, keys: ReadonlyArray<string>) =>
	sql.join(
		keys.map((key) => sql`(${left} -> ${key}) is not distinct from (${right} -> ${key})`),
		sql` and `,
	);
const presentScalars = (properties: SQL, keys: ReadonlyArray<string>) =>
	sql.join(
		keys.map(
			(key) =>
				sql`coalesce(jsonb_typeof(${properties} -> ${key}) in ('string', 'number', 'boolean'), false)`,
		),
		sql` and `,
	);
const matchingRows = (left: SQL, right: SQL, dependent: PluginEventGroup["dependents"][number]) =>
	sql`${left}.user_id = ${right}.user_id
		and ${left}.event_schema_plugin_id is not distinct from ${right}.event_schema_plugin_id
		and ${left}.session_entity_id = ${right}.session_entity_id
		and ${left}.entity_id = ${right}.entity_id
		and ${sameProperties(sql`${left}.properties`, sql`${right}.properties`, dependent.matchProperties)}`;

export class EventGroupConstraints extends Context.Service<EventGroupConstraints>()(
	"@ryot-app/kernel-backend/modules/events/event-group-constraints/EventGroupConstraints",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const entities = yield* EntitiesRepository;
			const requireTransaction = session.requireTransaction.pipe(Effect.orDie);
			const readChanged = Effect.fnUntraced(function* (
				userId: UserId,
				eventIds: ReadonlyArray<EventId>,
			) {
				if (eventIds.length === 0) {
					return [];
				}
				const rows = yield* session.run((db) =>
					db.execute(
						sql`
				select v.id, v.revision, v.user_id as "userId", v.entity_id as "entityId",
					v.session_entity_id as "sessionEntityId", v.event_schema_slug as "eventSchemaSlug",
					v.event_schema_plugin_id as "eventSchemaPluginId", e.entity_schema_slug as "entitySchemaSlug", v.properties
				from event v join entity e on e.id = v.entity_id
				where v.user_id = ${userId} and v.id in (${valuesSql(eventIds)})
			`,
						"objects",
					),
				);
				return yield* Schema.decodeUnknownEffect(Schema.Array(StoredGroupRecord))(rows).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid event group source rows" })),
				);
			});
			const assertRevisions = Effect.fnUntraced(function* (
				expected: ReadonlyMap<EventId, number>,
				rows: ReadonlyArray<typeof StoredGroupRecord.Type>,
			) {
				const current = new Map(rows.map((row) => [row.id, row.revision]));
				for (const [eventId, revision] of expected) {
					if (current.get(eventId) !== revision) {
						return yield* new EventStale({ reason: { eventId, code: "event-stale" } });
					}
				}
				return undefined;
			});
			const pendingFor = Effect.fnUntraced(function* (userId: UserId) {
				const pending = yield* PendingEventGroups;
				if (pending === null) {
					return yield* new DbError({ message: "Event writes require an event transaction" });
				}
				const existing = pending.get(userId);
				if (existing) {
					return existing;
				}
				const created: PendingGroups = {
					bindings: [],
					before: new Map(),
					eventIds: new Set(),
					entityIds: new Set(),
					sessionIds: new Set(),
					selections: new Set(),
					declarations: new Map(),
					createdEventIds: new Set(),
				};
				pending.set(userId, created);
				return created;
			});
			const isCaptured = Effect.fn("EventGroupConstraints.isCaptured")(function* (input: {
				readonly userId: UserId;
				readonly eventIds: ReadonlyArray<EventId>;
				readonly drafts: ReadonlyArray<GroupSource>;
				readonly createdEventIds?: ReadonlyArray<EventId>;
			}) {
				const pending = yield* pendingFor(input.userId);
				return (
					input.eventIds.every((id) => pending.eventIds.has(id)) &&
					(input.createdEventIds ?? []).every((id) => pending.createdEventIds.has(id)) &&
					input.drafts.every(
						(draft) =>
							pending.entityIds.has(draft.entityId) &&
							(draft.sessionEntityId === null || pending.entityIds.has(draft.sessionEntityId)) &&
							pending.selections.has(selectionKey(draft)),
					)
				);
			});
			const capture = Effect.fn("EventGroupConstraints.capture")(function* (input: {
				readonly userId: UserId;
				readonly eventIds: ReadonlyArray<EventId>;
				readonly drafts: ReadonlyArray<GroupSource>;
				readonly entityIds?: ReadonlyArray<EntityId>;
				readonly createdEventIds?: ReadonlyArray<EventId>;
				readonly expectedRevisions?: ReadonlyMap<EventId, number>;
			}) {
				yield* requireTransaction;
				const pending = yield* pendingFor(input.userId);
				const eventIds = [...new Set(input.eventIds)].sort();
				const expected = input.expectedRevisions ?? new Map<EventId, number>();
				const readIds = [...new Set([...eventIds, ...expected.keys()])];
				const observedRows = yield* readChanged(input.userId, readIds);
				yield* assertRevisions(expected, observedRows);
				const observed = observedRows.filter((row) => eventIds.includes(row.id));
				const sources = [...observed, ...input.drafts];
				const entityIds = [
					...new Set([
						...(input.entityIds ?? []),
						...input.drafts.flatMap((row) => [
							row.entityId,
							...(row.sessionEntityId === null ? [] : [row.sessionEntityId]),
						]),
					]),
				].sort();
				if (
					observed.some(
						(row) =>
							!entityIds.includes(row.entityId) ||
							(row.sessionEntityId !== null && !entityIds.includes(row.sessionEntityId)),
					)
				) {
					return yield* violation("an event reference changed before its session was locked");
				}
				yield* entities.getMutationEntities(entityIds, true);
				const currentRows = yield* readChanged(input.userId, readIds);
				yield* assertRevisions(expected, currentRows);
				const before = currentRows.filter((row) => eventIds.includes(row.id));
				if (
					before.some(
						(row) =>
							!entityIds.includes(row.entityId) ||
							(row.sessionEntityId !== null && !entityIds.includes(row.sessionEntityId)),
					)
				) {
					return yield* violation("an event reference changed before its session was locked");
				}
				const selections = [
					...new Map(
						sources.map((row) => [
							selectionKey(row),
							{ pluginId: row.eventSchemaPluginId, entitySchemaSlug: row.entitySchemaSlug },
						]),
					).values(),
				];
				const raw =
					selections.length === 0
						? []
						: yield* session.run((db) =>
								db.execute(
									sql`
				select r.plugin_id as "pluginId", e.slug as "entitySchemaSlug",
					d.slug as "eventSchemaSlug", d.event_group as "eventGroup"
				from definition_event_schema d join definition_entity_schema e on e.id = d.entity_schema_id
				left join plugin_revision r on r.id = e.plugin_revision_id
				left join plugin p on p.id = r.plugin_id
				join jsonb_to_recordset(${stableStringify(selections)}::jsonb)
					as selected("pluginId" text, "entitySchemaSlug" text)
					on r.plugin_id is not distinct from selected."pluginId"
					and e.slug = selected."entitySchemaSlug"
				where d.event_group is not null and (e.plugin_revision_id is null or
					(p.active_revision_id = r.id and (p.owner_user_id is null or p.owner_user_id = ${input.userId})))
			`,
									"objects",
								),
							);
				const declarations = yield* Schema.decodeUnknownEffect(
					Schema.Array(StoredGroupDeclaration),
				)(raw).pipe(
					Effect.mapError(
						() => new DbError({ message: "Invalid persisted event group declaration" }),
					),
				);
				const sessionIds = [
					...new Set(
						sources.flatMap((row) => (row.sessionEntityId === null ? [] : [row.sessionEntityId])),
					),
				];
				const bindings: Array<GroupBinding> = [];
				for (const declaration of declarations) {
					for (const dependent of declaration.eventGroup.dependents) {
						const rows =
							eventIds.length === 0
								? []
								: yield* session.run((db) =>
										db.execute(
											sql`
						select d.id as "eventId", a.id as "anchorId"
						from event d join event a on ${matchingRows(sql`d`, sql`a`, dependent)}
						join entity e on e.id = d.entity_id
						where d.user_id = ${input.userId}
							and d.id in (${valuesSql(eventIds)})
							and d.event_schema_plugin_id is not distinct from ${declaration.pluginId}
							and e.entity_schema_slug = ${declaration.entitySchemaSlug}
							and d.event_schema_slug = ${dependent.eventSchemaSlug}
							and a.event_schema_slug = ${declaration.eventSchemaSlug}
					`,
											"objects",
										),
									);
						bindings.push(
							...(yield* Schema.decodeUnknownEffect(
								Schema.Array(Schema.Struct({ eventId: EventId, anchorId: EventId })),
							)(rows).pipe(
								Effect.mapError(
									() => new DbError({ message: "Invalid captured event group bindings" }),
								),
							)),
						);
					}
				}
				for (const row of before) {
					if (!pending.eventIds.has(row.id) && !pending.createdEventIds.has(row.id)) {
						pending.before.set(row.id, row);
					}
				}
				pending.bindings.push(...bindings.filter(({ eventId }) => !pending.eventIds.has(eventId)));
				for (const declaration of declarations) {
					pending.declarations.set(
						stableStringify([
							declaration.pluginId,
							declaration.entitySchemaSlug,
							declaration.eventSchemaSlug,
						]),
						declaration,
					);
				}
				for (const row of sources) {
					pending.selections.add(selectionKey(row));
				}
				for (const id of eventIds) {
					pending.eventIds.add(id);
				}
				for (const id of entityIds) {
					pending.entityIds.add(id);
				}
				for (const id of sessionIds) {
					pending.sessionIds.add(id);
				}
				for (const id of input.createdEventIds ?? []) {
					pending.createdEventIds.add(id);
				}
				return entityIds;
			});
			const validate = Effect.fn("EventGroupConstraints.validate")(function* (
				captured: ValidationScope,
			) {
				yield* requireTransaction;
				const invalid = Effect.fnUntraced(function* (query: SQL, message: string) {
					const rows = yield* session.run((db) =>
						db.execute(sql`select exists(${query}) as invalid`, "objects"),
					);
					const [result] = yield* Schema.decodeUnknownEffect(
						Schema.Array(Schema.Struct({ invalid: Schema.Boolean })),
					)(rows).pipe(
						Effect.mapError(
							() => new DbError({ message: "Invalid event group consistency result" }),
						),
					);
					if (result?.invalid) {
						return yield* violation(message);
					}
					return undefined;
				});
				for (const declaration of captured.declarations) {
					const inScope = (alias: SQL) => sql`${alias}.user_id = ${captured.userId}
					and ${alias}.event_schema_plugin_id is not distinct from ${declaration.pluginId}
					and (${captured.allSessions} or ${alias}.session_entity_id in (${valuesSql(captured.sessionIds)}) or ${alias}.id in (${valuesSql(captured.eventIds)})
						or (${alias}.session_entity_id is null and ${alias}.entity_id in (${valuesSql(captured.entityIds)})))
					and exists (select 1 from entity e where e.id = ${alias}.entity_id and e.entity_schema_slug = ${declaration.entitySchemaSlug})`;
					const group = declaration.eventGroup;
					yield* invalid(
						sql`
					select 1 from event a where ${inScope(sql`a`)} and a.event_schema_slug = ${declaration.eventSchemaSlug}
					and (a.session_entity_id is null or not (${presentScalars(sql`a.properties`, group.keyProperties)}))
				`,
						"an anchor requires a session and present scalar keys",
					);
					yield* invalid(
						sql`
					select 1 from event a where ${inScope(sql`a`)} and a.event_schema_slug = ${declaration.eventSchemaSlug}
					group by a.user_id, a.event_schema_plugin_id, a.session_entity_id,
						${sql.join(
							group.keyProperties.map((key) => sql`(a.properties -> ${key})`),
							sql`, `,
						)}
					having count(*) > 1
				`,
						"an anchor key must be unique within its session",
					);
					const oldAnchors = captured.before.filter(
						(row) =>
							row.eventSchemaPluginId === declaration.pluginId &&
							row.entitySchemaSlug === declaration.entitySchemaSlug &&
							row.eventSchemaSlug === declaration.eventSchemaSlug,
					);
					const previous = sql`jsonb_to_recordset(${stableStringify(oldAnchors)}::jsonb)
					as b(id text, "userId" text, "entityId" text, "sessionEntityId" text, properties jsonb)`;
					yield* invalid(
						sql`
					select 1 from ${previous} join event a on a.id = b.id and a.user_id = b."userId"
					where a.session_entity_id is distinct from b."sessionEntityId"
					or not (${group.immutableProperties.length === 0 ? sql`true` : sameProperties(sql`a.properties`, sql`b.properties`, group.immutableProperties)})
				`,
						"retained anchor fields and properties are immutable",
					);
					for (const dependent of group.dependents) {
						yield* invalid(
							sql`
						select 1 from event d where ${inScope(sql`d`)} and d.event_schema_slug = ${dependent.eventSchemaSlug}
						and (d.session_entity_id is null or not (${presentScalars(sql`d.properties`, dependent.matchProperties)})
						or not exists(select 1 from event a where a.event_schema_slug = ${declaration.eventSchemaSlug} and ${matchingRows(sql`d`, sql`a`, dependent)}))
					`,
							"every dependent requires exactly one matching anchor",
						);
						yield* invalid(
							sql`
						select 1 from event a where ${inScope(sql`a`)} and a.event_schema_slug = ${declaration.eventSchemaSlug}
						and not exists(select 1 from event d where d.event_schema_slug = ${dependent.eventSchemaSlug} and ${matchingRows(sql`d`, sql`a`, dependent)})
					`,
							"an anchor requires its declared dependents",
						);
						yield* invalid(
							sql`
						select 1 from ${previous} join event d
							on d.user_id = b."userId" and d.entity_id = b."entityId" and d.session_entity_id = b."sessionEntityId"
							and d.event_schema_plugin_id is not distinct from ${declaration.pluginId}
							and d.event_schema_slug = ${dependent.eventSchemaSlug}
							and ${sameProperties(sql`d.properties`, sql`b.properties`, dependent.matchProperties)}
						where d.id not in (${valuesSql([...captured.eventIds, ...captured.createdEventIds])})
						and not exists(select 1 from event a where a.id = b.id and ${matchingRows(sql`d`, sql`a`, dependent)})
					`,
							"a retained dependent cannot bind to another anchor event",
						);
						yield* invalid(
							sql`
						select 1 from jsonb_to_recordset(${stableStringify(captured.bindings)}::jsonb) as b("eventId" text, "anchorId" text)
						join event d on d.id = b."eventId" where ${inScope(sql`d`)} and d.event_schema_slug = ${dependent.eventSchemaSlug}
						and not exists(select 1 from event a where a.id = b."anchorId" and ${matchingRows(sql`d`, sql`a`, dependent)})
					`,
							"a retained dependent cannot bind to another anchor event",
						);
					}
				}
			});
			const validateHistorical = Effect.fn("EventGroupConstraints.validateHistorical")(function* (
				userId: UserId,
				declarations: ReadonlyArray<EventGroupDeclaration>,
			) {
				return yield* validate({
					userId,
					before: [],
					bindings: [],
					eventIds: [],
					declarations,
					entityIds: [],
					sessionIds: [],
					allSessions: true,
					createdEventIds: [],
				});
			});
			const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
				runRootTransaction(
					session,
					Effect.gen(function* () {
						const pending = new Map<UserId, PendingGroups>();
						const result = yield* work.pipe(Effect.provideService(PendingEventGroups, pending));
						for (const [userId, captured] of [...pending].sort(([left], [right]) =>
							left.localeCompare(right),
						)) {
							yield* validate({
								userId,
								allSessions: false,
								bindings: captured.bindings,
								eventIds: [...captured.eventIds],
								entityIds: [...captured.entityIds],
								sessionIds: [...captured.sessionIds],
								before: [...captured.before.values()],
								createdEventIds: [...captured.createdEventIds],
								declarations: [...captured.declarations.values()],
							});
						}
						return result;
					}),
				);
			return { capture, isCaptured, transaction, validateHistorical };
		}),
	},
) {}
