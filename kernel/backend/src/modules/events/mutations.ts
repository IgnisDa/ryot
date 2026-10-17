import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEntityDraft,
	AutomationEventDraft,
	AutomationEventSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { EventMutationChange } from "@ryot-app/contract/modules/events/mutations";
import {
	EventBadRequest,
	EventCreateFailureReason,
	EventNotFound,
	EventStale,
} from "@ryot-app/contract/modules/events/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { EntityId, EventId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import {
	type LifecycleBatchInput,
	LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import type { PolicyBatchResult } from "#modules/automations/lifecycle/policy-batch";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { assertStableUnder, DomainWriteChecks } from "#modules/entities/write-context";
import {
	MutationReceiptIdentity,
	mutationReceiptIdentity,
	MutationReceipts,
} from "#modules/mutations/receipts";
import {
	CatalogDefinitionFingerprint,
	catalogDefinitionFingerprint,
} from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";

import { readEventCreateChunkScopes } from "./event-creation";
import { EventsRepository } from "./repository";

export const PreparedEventChange = Schema.Struct({
	position: Schema.Int,
	change: EventMutationChange,
	draft: AutomationEventDraft,
	propertiesSchema: AppSchema,
	receipt: MutationReceiptIdentity,
	schemaFingerprint: CatalogDefinitionFingerprint,
	source: Schema.NullOr(Schema.Struct({ revision: Schema.Int, snapshot: AutomationEventSnapshot })),
});
export const PreparedEventChanges = Schema.Struct({
	items: Schema.Array(PreparedEventChange),
	references: Schema.Record(EntityId, AutomationEntityDraft),
	failures: Schema.Array(
		Schema.Struct({ itemIdentity: Schema.String, reason: EventCreateFailureReason }),
	),
});
export type PreparedEventChanges = typeof PreparedEventChanges.Type;

export const eventPolicyItems = Effect.fnUntraced(function* (prepared: PreparedEventChanges) {
	return yield* Effect.forEach(prepared.items, (item) =>
		Effect.gen(function* () {
			const common = {
				itemIdentity: item.change.itemIdentity,
				propertiesSchema: item.propertiesSchema,
			};
			if (item.change.kind === "create") {
				return {
					...common,
					request: {
						draft: item.draft,
						resource: "event" as const,
						category: "request" as const,
						operation: "create" as const,
					},
				};
			}
			if (!item.source) {
				return yield* new DbError({ message: "Prepared event snapshot is unavailable" });
			}
			if (item.change.kind === "delete") {
				return {
					...common,
					request: {
						resource: "event" as const,
						draft: item.source.snapshot,
						category: "request" as const,
						operation: "delete" as const,
					},
				};
			}
			return {
				...common,
				request: {
					draft: item.draft,
					resource: "event" as const,
					before: item.source.snapshot,
					category: "request" as const,
					operation: "update" as const,
				},
			};
		}),
	);
});

const bad = (
	code: "invalid-properties" | "invalid-policy-transform" | "policy-rejected" | "mutation-conflict",
	message: string,
) => new EventBadRequest({ reason: { code, message } });
const commandFor = (
	command: DomainLifecycleCommand,
	itemIdentity: string,
): DomainLifecycleCommand => ({
	...command,
	itemIdentity: `${command.itemIdentity}:${itemIdentity}`,
});
const scopeKey = (
	draft: Pick<
		AutomationEventDraft,
		"entitySchemaPluginId" | "entitySchemaSlug" | "eventSchemaSlug"
	>,
) => stableStringify([draft.entitySchemaPluginId, draft.entitySchemaSlug, draft.eventSchemaSlug]);
const sameExpected = (
	before: AutomationEventSnapshot,
	expected: NonNullable<Extract<EventMutationChange, { kind: "delete" }>["expected"]>,
) =>
	before.entityId === expected.entityId &&
	before.sessionEntityId === expected.sessionEntityId &&
	before.occurredAt === expected.occurredAt &&
	Object.entries(expected.properties).every(
		([key, value]) =>
			Object.hasOwn(before.properties, key) &&
			stableStringify(before.properties[key]) === stableStringify(value),
	) &&
	expected.absentProperties.every((key) => !Object.hasOwn(before.properties, key));

export class EventMutations extends Context.Service<EventMutations>()("EventMutations", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const repository = yield* EventsRepository;
		const entities = yield* EntitiesRepository;
		const schemas = yield* EventSchemaReader;
		const writes = yield* DomainWriteChecks;
		const planner = yield* LifecyclePlanner;
		const receipts = yield* MutationReceipts.make;
		const assets = yield* ManagedAssetReferenceLocker.make;
		const prepare = Effect.fn("EventMutations.prepare")(function* (input: {
			userId: UserId;
			command: DomainLifecycleCommand;
			changes: ReadonlyArray<EventMutationChange>;
			proposedEntities?: Readonly<Record<string, AutomationEntityDraft>>;
			independent?: boolean;
			positionOffset?: number;
		}) {
			const writer = input.command.writeContext?.pluginRevision;
			if (writer) {
				yield* writes
					.check(input.command, definitionOwner(writer.id), input.userId, true)
					.pipe(
						Effect.catchTag(
							"DomainWriteConflict",
							(error) => new DbError({ message: error.message }),
						),
					);
			}
			const changes = yield* Effect.forEach(input.changes, (change) =>
				Effect.gen(function* () {
					if (change.kind === "create") {
						return { change, source: null, item: change.item };
					}
					const eventId = change.kind === "delete" ? change.eventId : change.item.eventId;
					const source = yield* repository.getEventSnapshot({ eventId, userId: input.userId });
					if (!source) {
						return yield* new EventNotFound({ reason: { eventId, code: "event-not-found" } });
					}
					const { snapshot: before } = source;
					const expected = change.kind === "delete" ? change.expected : change.item.expected;
					if (expected && !sameExpected(before, expected)) {
						return yield* new EventStale({ reason: { eventId, code: "event-stale" } });
					}
					const patch = change.kind === "update" ? change.item.patch : {};
					const properties = { ...before.properties };
					for (const key of patch.properties?.remove ?? []) {
						delete properties[key];
					}
					Object.assign(properties, patch.properties?.set);
					return {
						change,
						source,
						item: {
							properties,
							eventSchemaSlug: before.eventSchemaSlug,
							entityId: patch.entityId ?? before.entityId,
							occurredAt: patch.occurredAt ?? before.occurredAt,
							sessionEntityId:
								patch.sessionEntityId === undefined
									? (before.sessionEntityId ?? undefined)
									: (patch.sessionEntityId ?? undefined),
						},
					};
				}),
			);
			const scopes = yield* readEventCreateChunkScopes({
				...input,
				commands: [input.command],
				writeCommand: input.command,
				items: changes.map((item) => item.item),
			}).pipe(
				Effect.provideService(EventSchemaReader, schemas),
				Effect.provideService(EntitiesRepository, entities),
				Effect.provideService(DomainWriteChecks, writes),
			);
			const prepared = yield* Effect.forEach(changes, (item, index) =>
				Effect.gen(function* () {
					const command = commandFor(input.command, item.change.itemIdentity);
					const scope = yield* scopes.resolve(
						{ ...item.item, occurredAt: item.item.occurredAt ?? input.command.occurredAt },
						command,
					);
					const properties = yield* parseAppSchemaProperties({
						kind: "Event",
						properties: item.item.properties,
						propertiesSchema: scope.eventSchemaScope.propertiesSchema,
						allowedMissingRequiredPaths: Object.keys(
							scope.eventSchemaScope.propertiesSchema.fields,
						).map((key) => [key]),
					}).pipe(Effect.mapError(() => bad("invalid-properties", "Event properties are invalid")));
					const draft = yield* Schema.decodeUnknownEffect(AutomationEventDraft)({
						properties,
						entityId: scope.entityId,
						occurredAt: scope.occurredAt.toISOString(),
						eventSchemaSlug: scope.eventSchemaScope.id,
						sessionEntityId: scope.sessionEntityId ?? null,
						entitySchemaSlug: scope.entityScope.entitySchemaSlug,
						eventSchemaPluginId: scope.eventSchemaScope.pluginId,
						entitySchemaPluginId: scope.entityScope.entitySchemaPluginId,
					}).pipe(Effect.mapError(() => bad("invalid-properties", "Event draft is invalid")));
					return {
						draft,
						change: item.change,
						source: item.source,
						position: (input.positionOffset ?? 0) + index,
						propertiesSchema: scope.eventSchemaScope.propertiesSchema,
						schemaFingerprint: catalogDefinitionFingerprint(scope.eventSchemaScope),
						receipt: mutationReceiptIdentity({
							command,
							input: item.change,
							ownerUserId: input.userId,
							scopeUserId: input.userId,
							commandKind: `event:${item.change.kind}`,
						}),
					};
				}).pipe(Effect.result),
			);
			const items: Array<typeof PreparedEventChange.Type> = [];
			const failures: Array<(typeof PreparedEventChanges.Type.failures)[number]> = [];
			for (const [index, result] of prepared.entries()) {
				if (result._tag === "Success") {
					items.push(result.success);
					continue;
				}
				const error = result.failure;
				if (!input.independent || error._tag === "DbError") {
					return yield* error;
				}
				const change = changes[index];
				if (!change) {
					return yield* Effect.die("Prepared change index is unavailable");
				}
				failures.push({
					itemIdentity: change.change.itemIdentity,
					reason:
						error._tag === "EventCreateItemError" ? error.reason : { code: "invalid-properties" },
				});
			}
			return { items, failures, references: scopes.references };
		});
		const persist = Effect.fn("EventMutations.persist")(function* (input: {
			userId: UserId;
			command: DomainLifecycleCommand;
			prepared: PreparedEventChanges;
			validated: PolicyBatchResult;
			batch?: LifecycleBatchInput;
			batchIndexOffset?: number;
			sealBatch?: boolean;
		}) {
			yield* session.requireTransaction.pipe(Effect.orDie);
			const prior = yield* receipts
				.lookupMany(
					input.prepared.items.map((row) => row.receipt),
					Schema.Struct({ eventId: EventId }),
				)
				.pipe(
					Effect.catchTag("MutationReceiptIdentityConflict", () =>
						bad("mutation-conflict", "Event identity reused with different input"),
					),
				);
			if (prior.length > 0 && prior.every((item) => item !== null)) {
				return {
					dispatch: prior.flatMap((item) => item.dispatch),
					results: input.prepared.items.flatMap((row, index) => {
						const replay = prior[index];
						return replay
							? [{ eventId: replay.result.eventId, itemIdentity: row.change.itemIdentity }]
							: [];
					}),
				};
			}
			yield* schemas.lockCatalog();
			const rows = input.prepared.items;
			const referencedIds = new Set(
				rows.flatMap((row) => {
					const accepted = input.validated.items.find(
						(item) => item.itemIdentity === row.change.itemIdentity,
					);
					return accepted?.request.resource === "event"
						? [
								row.draft.entityId,
								row.draft.sessionEntityId,
								accepted.request.draft.entityId,
								accepted.request.draft.sessionEntityId,
							].filter((id) => id !== null)
						: [];
				}),
			);
			const references = Object.fromEntries(
				Object.entries(input.validated.references).filter(([id]) =>
					referencedIds.has(EntityId.make(id)),
				),
			);
			const eventIds = rows.flatMap((row) => (row.source ? [row.source.snapshot.id] : []));
			yield* entities.lockEntityReferencesByIds(
				Object.keys(references)
					.map((id) => EntityId.make(id))
					.sort(),
			);
			yield* repository.lockEventRows({ eventIds, userId: input.userId });
			const currentReferences = yield* entities.getByIdsForUser({
				userId: input.userId,
				entityIds: Object.keys(references).map((id) => EntityId.make(id)),
			});
			for (const [id, expected] of Object.entries(references)) {
				const reference = currentReferences.get(EntityId.make(id));
				if (
					!reference ||
					stableStringify({
						properties: reference.properties,
						entitySchemaSlug: reference.entitySchemaSlug,
						entitySchemaPluginId: reference.entitySchemaPluginId,
					}) !==
						stableStringify({
							properties: expected.properties,
							entitySchemaSlug: expected.entitySchemaSlug,
							entitySchemaPluginId: expected.entitySchemaPluginId,
						})
				) {
					return yield* bad("mutation-conflict", "Event reference changed during validation");
				}
			}
			const batch = input.batch ?? {
				identity: ["events"],
				command: input.command,
				resource: "event" as const,
			};
			const preparedBatch = yield* planner.prepareBatch({ ...batch, scopes: [input.userId] });
			const selections = new Map(
				input.validated.items.flatMap((item) =>
					item.request.resource === "event"
						? [
								[
									scopeKey(item.request.draft),
									{
										eventSchemaSlug: item.request.draft.eventSchemaSlug,
										entitySchemaSlug: item.request.draft.entitySchemaSlug,
										entitySchemaPluginId: item.request.draft.entitySchemaPluginId,
									},
								] as const,
							]
						: [],
				),
			);
			const currentSchemas = yield* schemas.getScopesForUser(input.userId, [
				...selections.values(),
			]);
			const schemasByScope = new Map(
				[...selections.keys()].map((key, index) => [key, currentSchemas[index] ?? null]),
			);
			const results = [];
			const dispatch = [];
			const recorded: Array<Parameters<typeof receipts.insertMany>[0][number]> = [];
			const checkedOwners = new Set<string | null>();
			for (const [index, row] of rows.entries()) {
				const replay = prior[index];
				if (replay) {
					results.push({ eventId: replay.result.eventId, itemIdentity: row.change.itemIdentity });
					dispatch.push(...replay.dispatch);
					continue;
				}
				const accepted = input.validated.items.find(
					(item) => item.itemIdentity === row.change.itemIdentity,
				);
				if (accepted?.error) {
					return yield* bad(
						accepted.error.code === "reference-not-found"
							? "invalid-policy-transform"
							: accepted.error.code,
						"Event draft validation failed",
					);
				}
				if (accepted?.rejected !== null || accepted.request.resource !== "event") {
					return yield* bad(
						"policy-rejected",
						accepted?.rejected ?? "Event policy approval is unavailable",
					);
				}
				const draft = accepted.request.draft;
				const command = {
					...commandFor(input.command, row.change.itemIdentity),
					causation: {
						...input.command.causation,
						parentTriggerId: input.validated.triggerId ?? input.command.causation.parentTriggerId,
					},
				};
				if (!checkedOwners.has(draft.eventSchemaPluginId)) {
					yield* writes
						.check(command, definitionOwner(draft.eventSchemaPluginId), input.userId, true)
						.pipe(Effect.mapError((error) => bad("mutation-conflict", error.message)));
					checkedOwners.add(draft.eventSchemaPluginId);
				}
				const schema = schemasByScope.get(scopeKey(draft));
				if (
					!schema ||
					stableStringify(catalogDefinitionFingerprint(schema)) !==
						stableStringify(row.schemaFingerprint)
				) {
					return yield* bad("mutation-conflict", "Event schema changed during validation");
				}
				yield* assertStableUnder("Event", schema.propertiesSchema, draft.properties, () =>
					bad("invalid-properties", "Event properties changed during validation"),
				);
				yield* assets
					.lock([
						{
							ownerUserId: input.userId,
							properties: draft.properties,
							propertiesSchema: schema.propertiesSchema,
						},
					])
					.pipe(
						Effect.catchTag(
							"ManagedAssetReferenceRejected",
							() => new EventBadRequest({ reason: { code: "asset-forbidden" } }),
						),
					);
				let change;
				let eventId: EventId;
				if (row.change.kind === "create") {
					const event = yield* repository.createEvent({
						...draft,
						userId: input.userId,
						eventSchemaName: schema.name,
						sessionEntityId: draft.sessionEntityId ?? undefined,
						occurredAt: DateTime.toDate(DateTime.makeUnsafe(draft.occurredAt)),
						id: EventId.make(
							`event_${row.position.toString(36).padStart(4, "0")}_${sha256Base64Url(stableStringify([command.causation.executionId, command.itemIdentity]))}`,
						),
					});
					eventId = event.id;
					const after = yield* repository.getEventSnapshot({ eventId, userId: input.userId });
					if (!after) {
						return yield* new DbError({ message: "Created event disappeared" });
					}
					change = {
						after: after.snapshot,
						resource: "event" as const,
						category: "change" as const,
						operation: "create" as const,
					};
				} else {
					if (!row.source) {
						return yield* new DbError({ message: "Prepared event snapshot is unavailable" });
					}
					eventId = row.source.snapshot.id;
					const identity = { eventId, userId: input.userId, expectedRevision: row.source.revision };
					if (row.change.kind === "delete") {
						if (!(yield* repository.deletePreparedEvent(identity))) {
							return yield* new EventStale({ reason: { eventId, code: "event-stale" } });
						}
						change = {
							resource: "event" as const,
							before: row.source.snapshot,
							category: "change" as const,
							operation: "delete" as const,
						};
					} else {
						if (
							!(yield* repository.updatePreparedEvent({
								...identity,
								draft,
								updatedAt: DateTime.toDate(DateTime.makeUnsafe(command.occurredAt)),
							}))
						) {
							return yield* new EventStale({ reason: { eventId, code: "event-stale" } });
						}
						const after = yield* repository.getEventSnapshot({ eventId, userId: input.userId });
						if (!after) {
							return yield* new DbError({ message: "Updated event disappeared" });
						}
						change = {
							after: after.snapshot,
							resource: "event" as const,
							before: row.source.snapshot,
							category: "change" as const,
							operation: "update" as const,
						};
					}
				}
				const plan = yield* planner.plan({
					trigger: lifecycleTrigger(command, input.userId, change),
				});
				const planned = plan.trigger ? [toLifecycleDispatchPlan(plan)] : [];
				dispatch.push(...planned);
				recorded.push({
					dispatch: planned,
					identity: row.receipt,
					batchId: preparedBatch.id,
					batchIndex: (input.batchIndexOffset ?? 0) + index,
					evidence: preparedBatch.hasCandidates ? change : undefined,
					result:
						row.change.kind === "create" ? { eventId, processed: accepted.processed } : { eventId },
				});
				results.push({ eventId, itemIdentity: row.change.itemIdentity });
			}
			yield* receipts.insertMany(recorded);
			if (input.sealBatch !== false) {
				dispatch.push(...(yield* planner.planBatch(batch)));
			}
			return { results, dispatch };
		});
		return { prepare, persist };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
