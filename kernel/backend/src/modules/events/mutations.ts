import { DbError } from "@ryot-app/contract/errors";
import type { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationEntityDraft,
	AutomationEventDraft,
	AutomationEventSnapshot,
	LifecycleCommand,
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
import { Context, DateTime, Duration, Effect, Layer, Schedule, Schema } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import {
	type LifecycleBatchInput,
	type LifecycleDispatchPlan,
	LifecyclePlanner,
} from "#modules/automations/lifecycle/planning";
import {
	type PolicyBatchResult,
	unchangedPolicyBatch,
} from "#modules/automations/lifecycle/policy-batch";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import {
	type ApplyFoldChanges,
	type FoldMode,
	Folds,
	isFoldBusy,
} from "#modules/derived-values/service";
import { EntitiesRepository } from "#modules/entities/repository";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { assertStableUnder, DomainWriteChecks } from "#modules/entities/write-context";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import {
	CatalogDefinitionFingerprint,
	catalogDefinitionFingerprint,
} from "#modules/plugins/catalog/runtime-resolver";
import { HeldInlineBatch } from "#modules/scripts/executions/queues";
import { DatabaseSession } from "#platform/db/session";

import { readEventCreateChunkScopes } from "./event-creation";
import { EventGroupConstraints } from "./event-group-constraints";
import {
	type ClearedEventReference,
	eventReferenceBadRequest,
	PendingEventReferenceClears,
} from "./event-references";
import { EventsRepository } from "./repository";

const EventWriteIdentity = Schema.Struct({
	itemIdentity: Schema.String,
	accountUserId: LifecycleCommand.fields.accountUserId,
	executionId: LifecycleCommand.fields.causation.fields.executionId,
});

export const eventWriteIdentity = (command: LifecycleCommand) => ({
	itemIdentity: command.itemIdentity,
	accountUserId: command.accountUserId,
	executionId: command.causation.executionId,
});

export const PreparedEventChange = Schema.Struct({
	position: Schema.Int,
	change: EventMutationChange,
	draft: AutomationEventDraft,
	identity: EventWriteIdentity,
	schemaFingerprint: CatalogDefinitionFingerprint,
	source: Schema.NullOr(Schema.Struct({ revision: Schema.Int, snapshot: AutomationEventSnapshot })),
	order: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				anchorId: EventId,
				key: Schema.String,
				revision: Schema.Int,
				createdAt: Schema.String,
			}),
		),
	),
});
export const PreparedEventChanges = Schema.Struct({
	items: Schema.Array(PreparedEventChange),
	references: Schema.Record(EntityId, AutomationEntityDraft),
	propertiesSchemas: Schema.Record(Schema.String, AppSchema),
	failures: Schema.Array(
		Schema.Struct({ itemIdentity: Schema.String, reason: EventCreateFailureReason }),
	),
});
export type PreparedEventChanges = typeof PreparedEventChanges.Type;

const preparedMutationReferences = (input: {
	readonly userId: UserId;
	readonly batches: ReadonlyArray<{
		readonly validated: PolicyBatchResult;
		readonly prepared: PreparedEventChanges;
	}>;
}) => ({
	eventIds: input.batches.flatMap(({ prepared }) =>
		prepared.items.flatMap((row) => [
			...(row.source ? [row.source.snapshot.id] : []),
			...(row.order ? [row.order.anchorId] : []),
		]),
	),
	sources: input.batches.flatMap(({ prepared, validated }) => [
		...prepared.items.flatMap((row) => [
			{ ...row.draft, userId: input.userId },
			...(row.source ? [{ ...row.source.snapshot, userId: input.userId }] : []),
		]),
		...validated.items.flatMap((row) =>
			row.request.resource === "event" ? [{ ...row.request.draft, userId: input.userId }] : [],
		),
	]),
});

const preparedEventId = (row: typeof PreparedEventChange.Type) =>
	EventId.make(
		`event_${row.position.toString(36).padStart(4, "0")}_${sha256Base64Url(stableStringify([row.identity.executionId, row.identity.itemIdentity]))}`,
	);

const capturedEventIds = (batches: ReadonlyArray<{ readonly prepared: PreparedEventChanges }>) =>
	batches.flatMap(({ prepared }) =>
		prepared.items.flatMap((row) => (row.source ? [row.source.snapshot.id] : [])),
	);
const createdEventIds = (batches: ReadonlyArray<{ readonly prepared: PreparedEventChanges }>) =>
	batches.flatMap(({ prepared }) =>
		prepared.items.flatMap((row) => (row.change.kind === "create" ? [preparedEventId(row)] : [])),
	);

export const eventPolicyItems = Effect.fnUntraced(function* (prepared: PreparedEventChanges) {
	return yield* Effect.forEach(prepared.items, (item) =>
		Effect.gen(function* () {
			const common = {
				itemIdentity: item.change.itemIdentity,
				schemaKey: item.schemaFingerprint.digest,
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
	code: "policy-rejected" | "mutation-conflict" | "invalid-properties" | "invalid-policy-transform",
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
		"eventSchemaSlug" | "entitySchemaSlug" | "entitySchemaPluginId"
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

export class EventMutations extends Context.Service<EventMutations>()(
	"@ryot-app/kernel-backend/modules/events/mutations/EventMutations",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EventsRepository;
			const entities = yield* EntitiesRepository;
			const schemas = yield* EventSchemaReader;
			const writes = yield* DomainWriteChecks;
			const planner = yield* LifecyclePlanner;
			const keys = yield* IdempotencyKeys.make;
			const admission = yield* AccountAdmission.make;
			const assets = yield* ManagedAssetReferenceLocker.make;
			const groups = yield* EventGroupConstraints.make;
			const folds = yield* Folds;
			const captureGroups = Effect.fn("EventMutations.captureGroups")(function* (input: {
				readonly userId: UserId;
				readonly entityIds?: ReadonlyArray<EntityId>;
				readonly batches: ReadonlyArray<{
					readonly validated: PolicyBatchResult;
					readonly prepared: PreparedEventChanges;
				}>;
			}) {
				const accounts = new Map<UserId, NonNullable<LifecycleCommand["accountUserId"]>>();
				const expectedRevisions = new Map<EventId, number>();
				for (const { prepared } of input.batches) {
					for (const row of prepared.items) {
						if (row.source) {
							expectedRevisions.set(row.source.snapshot.id, row.source.revision);
						}
						if (row.order) {
							expectedRevisions.set(row.order.anchorId, row.order.revision);
						}
						if (row.identity.accountUserId !== null) {
							accounts.set(row.identity.accountUserId, row.identity.accountUserId);
						}
					}
				}
				for (const [, account] of [...accounts].sort(([left], [right]) =>
					left.localeCompare(right),
				)) {
					yield* admission.admitAccount(account);
				}
				yield* schemas.lockCatalog([input.userId, ...accounts.keys()]);
				const mutationReferences = preparedMutationReferences(input);
				yield* repository.lockMutationReferences(mutationReferences);
				return yield* groups.capture({
					expectedRevisions,
					userId: input.userId,
					entityIds: input.entityIds ?? [],
					drafts: mutationReferences.sources,
					eventIds: capturedEventIds(input.batches),
					createdEventIds: createdEventIds(input.batches),
				});
			});
			const lockPreparedChanges = Effect.fn("EventMutations.lockPreparedChanges")(function* (
				input: Parameters<typeof preparedMutationReferences>[0],
			) {
				yield* session.requireTransaction.pipe(Effect.orDie);
				yield* repository.lockEventRows({
					userId: input.userId,
					...preparedMutationReferences(input),
				});
			});
			const prepare = Effect.fn("EventMutations.prepare")(function* (input: {
				userId: UserId;
				independent?: boolean;
				positionOffset?: number;
				command: DomainLifecycleCommand;
				changes: ReadonlyArray<EventMutationChange>;
				proposedEntities?: Readonly<Record<string, AutomationEntityDraft>>;
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
					Effect.provideService(EventsRepository, repository),
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
						}).pipe(
							Effect.mapError(() => bad("invalid-properties", "Event properties are invalid")),
						);
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
						let anchor;
						if (item.change.kind === "create") {
							anchor = item.change.item.orderAfter;
						}
						if (item.change.kind === "update") {
							anchor = item.change.item.patch.orderAfter;
						}
						let order: typeof PreparedEventChange.Type.order;
						if (anchor === null) {
							order = null;
						} else if (anchor) {
							const source = yield* repository.getEventOrder({
								userId: input.userId,
								eventId: anchor.eventId,
							});
							if (
								!writer ||
								!source ||
								source.eventSchemaPluginId !== writer.id ||
								![draft.entityId, draft.sessionEntityId].some(
									(id) => id !== null && (id === source.entityId || id === source.sessionEntityId),
								)
							) {
								return yield* bad(
									"mutation-conflict",
									"Event order anchor is outside the command scope",
								);
							}
							order = {
								anchorId: anchor.eventId,
								revision: source.revision,
								createdAt: source.createdAt,
								key: `${source.key}~${anchor.suffix}`,
							};
						}
						return {
							...(order === undefined ? {} : { order }),
							draft,
							change: item.change,
							source: item.source,
							identity: eventWriteIdentity(command),
							position: (input.positionOffset ?? 0) + index,
							propertiesSchema: scope.eventSchemaScope.propertiesSchema,
							schemaFingerprint: catalogDefinitionFingerprint(scope.eventSchemaScope),
						};
					}).pipe(Effect.result),
				);
				const items: Array<typeof PreparedEventChange.Type> = [];
				const propertiesSchemas: Record<string, AppSchema> = {};
				const failures: Array<(typeof PreparedEventChanges.Type.failures)[number]> = [];
				for (const [index, result] of prepared.entries()) {
					if (result._tag === "Success") {
						const { propertiesSchema, ...item } = result.success;
						items.push(item);
						propertiesSchemas[item.schemaFingerprint.digest] = propertiesSchema;
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
				return { items, failures, propertiesSchemas, references: scopes.references };
			});
			const persist = Effect.fn("EventMutations.persist")(function* (input: {
				userId: UserId;
				derived?: boolean;
				sealBatch?: boolean;
				batchIndexOffset?: number;
				batch?: LifecycleBatchInput;
				validated: PolicyBatchResult;
				prepared: PreparedEventChanges;
				command: DomainLifecycleCommand;
			}) {
				yield* session.requireTransaction.pipe(Effect.orDie);
				yield* schemas.lockCatalog([input.userId]);
				const mutationReferences = preparedMutationReferences({
					batches: [input],
					userId: input.userId,
				});
				if (
					!(yield* groups.isCaptured({
						userId: input.userId,
						drafts: mutationReferences.sources,
						eventIds: capturedEventIds([input]),
						createdEventIds: createdEventIds([input]),
					}))
				) {
					yield* captureGroups({
						batches: [input],
						userId: input.userId,
						entityIds: Object.keys(input.validated.references).map((id) => EntityId.make(id)),
					});
				}
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
				const eventIds = rows.flatMap((row) => [
					...(row.source ? [row.source.snapshot.id] : []),
					...(row.order ? [row.order.anchorId] : []),
				]);
				yield* entities.lockEntityReferencesByIds(
					Object.keys(references)
						.map((id) => EntityId.make(id))
						.sort(),
				);
				yield* repository.lockEventRows({
					eventIds,
					userId: input.userId,
					sources: input.validated.items.flatMap((item) =>
						item.request.resource === "event"
							? [{ ...item.request.draft, userId: input.userId }]
							: [],
					),
				});
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
				const preparedBatch = input.derived
					? null
					: yield* planner.prepareBatch({ ...batch, scopes: [input.userId] });
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
				const dispatch: Array<LifecycleDispatchPlan> = [];
				const triggers: Array<AutomationTrigger> = [];
				const checkedOwners = new Set<null | string>();
				const assetOwners: Array<Parameters<typeof assets.lock>[0][number]> = [];
				const validatedRows: Array<{
					index: number;
					row: (typeof rows)[number];
					command: DomainLifecycleCommand;
					schema: NonNullable<ReturnType<typeof schemasByScope.get>>;
					processed: PolicyBatchResult["items"][number]["processed"];
					draft: Extract<
						PolicyBatchResult["items"][number]["request"],
						{ resource: "event" }
					>["draft"];
				}> = [];
				for (const [index, row] of rows.entries()) {
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
					if (row.order) {
						const anchor = yield* repository.getEventOrder({
							userId: input.userId,
							eventId: row.order.anchorId,
						});
						if (
							!anchor ||
							anchor.revision !== row.order.revision ||
							anchor.eventSchemaPluginId !== draft.eventSchemaPluginId ||
							![draft.entityId, draft.sessionEntityId].some(
								(id) => id !== null && (id === anchor.entityId || id === anchor.sessionEntityId),
							)
						) {
							return yield* new EventStale({
								reason: { code: "event-stale", eventId: row.order.anchorId },
							});
						}
					}
					const command = {
						...input.command,
						itemIdentity: row.identity.itemIdentity,
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
					assetOwners.push({
						ownerUserId: input.userId,
						properties: draft.properties,
						propertiesSchema: schema.propertiesSchema,
					});
					validatedRows.push({ row, index, draft, schema, command, processed: accepted.processed });
				}
				yield* assets
					.lock(assetOwners)
					.pipe(
						Effect.catchTag(
							"ManagedAssetReferenceRejected",
							() => new EventBadRequest({ reason: { code: "asset-forbidden" } }),
						),
					);
				const creates = validatedRows.filter(({ row }) => row.change.kind === "create");
				yield* repository.createEvents(
					creates.map(({ row, draft, schema }) => ({
						order: row.order ?? undefined,
						...draft,
						userId: input.userId,
						id: preparedEventId(row),
						eventSchemaName: schema.name,
						propertiesSchema: schema.propertiesSchema,
						sessionEntityId: draft.sessionEntityId ?? undefined,
						occurredAt: DateTime.toDate(DateTime.makeUnsafe(draft.occurredAt)),
					})),
				);
				const snapshots = yield* repository.getEventSnapshots(
					input.userId,
					creates.map(({ row }) => preparedEventId(row)),
				);
				const acceptedByIndex = new Map(validatedRows.map((entry) => [entry.index, entry]));
				for (const [index, row] of rows.entries()) {
					const entry = acceptedByIndex.get(index);
					if (!entry) {
						return yield* new DbError({ message: "Validated event change is unavailable" });
					}
					const { draft, schema, command } = entry;
					let change;
					let eventId: EventId;
					if (row.change.kind === "create") {
						eventId = preparedEventId(row);
						const after = snapshots.get(eventId);
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
						const identity = {
							eventId,
							userId: input.userId,
							expectedRevision: row.source.revision,
						};
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
									order: row.order,
									propertiesSchema: schema.propertiesSchema,
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
					results.push({ eventId, itemIdentity: row.change.itemIdentity });
					if (preparedBatch === null) {
						continue;
					}
					triggers.push(yield* lifecycleTrigger(command, input.userId, change));
					if (row.change.kind === "create") {
						yield* keys.recordImportItem(command, input.userId, "created");
					}
					yield* planner.recordBatchChange(preparedBatch.id, {
						payload: change,
						scopeUserId: input.userId,
						index: (input.batchIndexOffset ?? 0) + index,
					});
				}
				if (preparedBatch === null) {
					return { results, dispatch };
				}
				const planned = yield* planner.planChanges(triggers);
				dispatch.push(...planned.flat());
				if (input.sealBatch !== false) {
					dispatch.push(...(yield* planner.planBatch(batch)));
				}
				return { results, dispatch };
			});
			// Fold-owned writes skip before-policies and after-hooks: they derive from changes those already saw.
			const applyDerived: ApplyFoldChanges = Effect.fnUntraced(function* (input) {
				const prepared = yield* prepare(input);
				const validated = unchangedPolicyBatch(
					{
						resource: "event",
						userId: input.userId,
						command: input.command,
						references: prepared.references,
						items: yield* eventPolicyItems(prepared),
						propertiesSchemas: prepared.propertiesSchemas,
					},
					null,
				);
				yield* persist({ ...input, prepared, validated, derived: true }).pipe(
					Effect.catchTag("EventReferenceUnavailable", eventReferenceBadRequest),
				);
			});
			const clearPendingReferences = Effect.gen(function* () {
				const pending = yield* PendingEventReferenceClears;
				if (pending) {
					yield* repository.clearReferences(pending.splice(0));
				}
			});
			const transaction = <A, E, R>(work: Effect.Effect<A, E, R>, mode?: FoldMode) =>
				Effect.gen(function* () {
					const held = yield* HeldInlineBatch;
					const clearing = Effect.gen(function* () {
						const pending: Array<ClearedEventReference> = [];
						return yield* folds
							.within(
								Effect.tap(work, () => clearPendingReferences),
								(input) => Effect.tap(applyDerived(input), () => clearPendingReferences),
								mode,
							)
							.pipe(Effect.provideService(PendingEventReferenceClears, pending));
					});
					return yield* groups
						.transaction(clearing)
						.pipe(
							Effect.retry({
								while: isFoldBusy,
								times: held === null ? 10 : 0,
								schedule: Schedule.spaced(Duration.millis(100)),
							}),
						);
				});
			return { prepare, persist, transaction, captureGroups, lockPreparedChanges };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Folds.layer));
}
