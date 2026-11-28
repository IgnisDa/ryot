import { DbError, unknownToDbError } from "@ryot-app/contract/errors";
import type { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationEntityDraft,
	AutomationEventDraft,
	AutomationEventSnapshot,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { PolicyRejected } from "@ryot-app/contract/modules/changes/policies";
import { EventDelete, EventUpdate } from "@ryot-app/contract/modules/events/mutations";
import {
	CreateEventItem,
	EventBadRequest,
	EventCreateFailureReason,
	EventNotFound,
	EventStale,
	type EventWritePrecondition,
} from "@ryot-app/contract/modules/events/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { EntityId, EventId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { parseAppSchemaProperties } from "@ryot-app/contract/schema/property-values";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Array as Arr, Context, DateTime, Effect, Layer, Schema } from "effect";

import { rejectWithLoggedCause } from "#lib/domain/logged-rejection";
import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import {
	type LifecycleBatchInput,
	type LifecycleDispatchPlan,
	LifecyclePlanner,
} from "#modules/automations/lifecycle/planning";
import {
	acceptedPolicyRequests,
	matchPolicies,
	type PolicyDecisions,
	policyFailureReason,
	type PolicyItem,
	unchangedPolicies,
} from "#modules/automations/lifecycle/policies";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import {
	type ApplyFoldChanges,
	type FoldMode,
	Folds,
	type FoldWriter,
} from "#modules/derived-values/service";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	assertStableUnder,
	type DomainLifecycleCommand,
	DomainWriteChecks,
	type DomainWriteConflict,
	kernelCollectionLifecycleCommand,
} from "#modules/entities/write-context";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import {
	CatalogDefinitionFingerprint,
	catalogDefinitionFingerprint,
} from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";
import { runRootTransaction } from "#platform/db/transaction";
import { type WritePreparation, WriteTransaction } from "#platform/db/write-transaction";

import { readEventCreateChunkScopes } from "./event-creation";
import { EventGroupConstraints } from "./event-group-constraints";
import { eventReferenceBadRequest, pendingReferenceClears } from "./event-references";
import { EventsRepository } from "./repository";

const EventWriteIdentity = Schema.Struct({
	itemIdentity: Schema.String,
	accountUserId: LifecycleCommand.fields.accountUserId,
	executionId: LifecycleCommand.fields.causation.fields.executionId,
});

const eventWriteIdentity = (command: LifecycleCommand) => ({
	itemIdentity: command.itemIdentity,
	accountUserId: command.accountUserId,
	executionId: command.causation.executionId,
});

/**
 * An event change a kernel writer prepares: the contract's changes, a delete authorized by the
 * entities it cascades from, and a move of an event's entity references. `kernelCollection` lets a
 * plugin writer record a kernel collection membership event and change the kernel collection events
 * the user data it owns carries.
 */
export const EventMutation = Schema.Union([
	Schema.Struct({
		item: CreateEventItem,
		kind: Schema.Literal("create"),
		itemIdentity: Schema.NonEmptyString,
		kernelCollection: Schema.optionalKey(Schema.Literal(true)),
	}),
	EventUpdate,
	Schema.Struct({
		...EventDelete.fields,
		kernelCollection: Schema.optionalKey(Schema.Literal(true)),
		cascadeEntityIds: Schema.optionalKey(Schema.Array(EntityId)),
	}),
	Schema.Struct({
		eventId: EventId,
		mergeFrom: EntityId,
		mergeInto: EntityId,
		kind: Schema.Literal("move"),
		itemIdentity: Schema.NonEmptyString,
		kernelCollection: Schema.optionalKey(Schema.Literal(true)),
		properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
		references: Schema.optionalKey(Schema.Array(Schema.Struct({ from: EntityId, into: EntityId }))),
	}),
]);
export type EventMutation = typeof EventMutation.Type;

export const PreparedEventChange = Schema.Struct({
	position: Schema.Int,
	change: EventMutation,
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
		readonly validated: PolicyDecisions;
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

/** The request each prepared change asks its policies to decide, its entity as the subject. */
export const eventPolicyItems = (prepared: PreparedEventChanges) =>
	Effect.forEach(prepared.items, (item): Effect.Effect<PolicyItem> => {
		const common = {
			subject: item.draft.entityId,
			itemIdentity: item.change.itemIdentity,
			propertiesSchema: prepared.propertiesSchemas[item.schemaFingerprint.digest] ?? null,
		};
		if (item.change.kind === "create") {
			return Effect.succeed({
				...common,
				request: { draft: item.draft, resource: "event", category: "request", operation: "create" },
			});
		}
		if (!item.source) {
			return Effect.die("A prepared event change has no captured snapshot");
		}
		return Effect.succeed({
			...common,
			request:
				item.change.kind === "delete"
					? {
							resource: "event",
							category: "request",
							operation: "delete",
							draft: item.source.snapshot,
						}
					: {
							draft: item.draft,
							resource: "event",
							category: "request",
							operation: "update",
							before: item.source.snapshot,
						},
		});
	});

/** Matches the policies of each subject chunk, in the transaction that prepared the changes. */
export const matchEventPolicies = Effect.fnUntraced(function* (input: {
	readonly userId: UserId;
	readonly transaction: WriteTransaction;
	readonly prepared: PreparedEventChanges;
	readonly command: DomainLifecycleCommand;
}) {
	const items = Arr.zip(input.prepared.items, yield* eventPolicyItems(input.prepared));
	const chunks = yield* matchPolicies(
		{
			items,
			resource: "event",
			userId: input.userId,
			command: input.command,
			references: input.prepared.references,
			policyItem: ([, policyItem]: (typeof items)[number]) => policyItem,
		},
		input.transaction,
	);
	return chunks.map(({ request, policies, decisions, items: matched }) => ({
		request,
		policies,
		decisions,
		items: matched.map(([change]) => change),
	}));
});

/** Each chunk's items as one persistable batch; an item its policies refused fails them all. */
export const acceptedEventBatches = Effect.fnUntraced(function* (input: {
	readonly prepared: PreparedEventChanges;
	readonly command: DomainLifecycleCommand;
	readonly chunks: ReadonlyArray<{
		readonly decisions: PolicyDecisions;
		readonly items: ReadonlyArray<typeof PreparedEventChange.Type>;
	}>;
}) {
	const accepted = acceptedPolicyRequests(input.chunks);
	const batches: Array<{
		validated: PolicyDecisions;
		prepared: PreparedEventChanges;
		command: DomainLifecycleCommand;
	}> = [];
	for (const chunk of input.chunks) {
		for (const item of chunk.decisions.items) {
			yield* accepted(item.itemIdentity);
		}
		batches.push({
			command: input.command,
			validated: chunk.decisions,
			prepared: { ...input.prepared, items: chunk.items },
		});
	}
	return batches;
});

const bad = (code: "mutation-conflict" | "invalid-properties") =>
	new EventBadRequest({ reason: { code } });
const conflict = (cause: string) => rejectWithLoggedCause(bad("mutation-conflict"), cause);
const commandFor = (
	command: DomainLifecycleCommand,
	itemIdentity: string,
): DomainLifecycleCommand => ({
	...command,
	itemIdentity: `${command.itemIdentity}:${itemIdentity}`,
});
const writeFailure = (error: DbError | DomainWriteConflict) =>
	error._tag === "DomainWriteConflict"
		? Effect.fail(new EventBadRequest({ reason: { code: error.reason.code } }))
		: conflict(error.message);
const checkCommand = (command: DomainLifecycleCommand, change: EventMutation) =>
	change.kind !== "update" && change.kernelCollection === true
		? kernelCollectionLifecycleCommand(command)
		: command;
const scopeKey = (
	draft: Pick<
		AutomationEventDraft,
		"eventSchemaSlug" | "entitySchemaSlug" | "entitySchemaPluginId"
	>,
) => stableStringify([draft.entitySchemaPluginId, draft.entitySchemaSlug, draft.eventSchemaSlug]);
export const matchesExpectedFields = (
	before: AutomationEventSnapshot,
	expected: EventWritePrecondition,
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
			const captureGroups = Effect.fn("EventMutations.captureGroups")(function* (
				transaction: WriteTransaction,
				input: {
					readonly userId: UserId;
					readonly entityIds?: ReadonlyArray<EntityId>;
					readonly batches: ReadonlyArray<{
						readonly validated: PolicyDecisions;
						readonly prepared: PreparedEventChanges;
					}>;
				},
			) {
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
					yield* admission.admitAccount(account, transaction);
				}
				yield* schemas.lockCatalog([input.userId, ...accounts.keys()], transaction);
				const mutationReferences = preparedMutationReferences(input);
				yield* repository.lockMutationReferences(mutationReferences);
				return yield* groups.capture(transaction, {
					expectedRevisions,
					userId: input.userId,
					entityIds: input.entityIds ?? [],
					drafts: mutationReferences.sources,
					eventIds: capturedEventIds(input.batches),
					createdEventIds: createdEventIds(input.batches),
				});
			});
			const authorizeCascade = Effect.fnUntraced(function* (
				transaction: WriteTransaction,
				command: DomainLifecycleCommand,
				userId: UserId,
				cascadeEntityIds: ReadonlyArray<EntityId>,
				before: AutomationEventSnapshot,
			) {
				const entityId = cascadeEntityIds.find(
					(id) => id === before.entityId || id === before.sessionEntityId,
				);
				const source = entityId === undefined ? null : yield* entities.getMutationEntity(entityId);
				if (
					!source ||
					(source.userId !== null && source.userId !== userId) ||
					(before.eventSchemaPluginId !== source.entity.entitySchemaPluginId &&
						!(before.eventSchemaPluginId === null && before.entitySchemaSlug === "collection"))
				) {
					return yield* new DbError({
						message: "Event cascade does not match the authorized entity graph",
					});
				}
				yield* writes
					.check(
						command,
						definitionOwner(source.entity.entitySchemaPluginId),
						source.userId,
						transaction,
					)
					.pipe(Effect.catch(writeFailure));
				return yield* Effect.void;
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
			const prepare = Effect.fn("EventMutations.prepare")(function* (
				transaction: WriteTransaction,
				input: {
					userId: UserId;
					independent?: boolean;
					verbatimIdentities?: boolean;
					command: DomainLifecycleCommand;
					changes: ReadonlyArray<EventMutation>;
					proposedEntities?: Readonly<Record<string, AutomationEntityDraft>>;
				},
			) {
				const writer = input.command.writeContext?.pluginRevision;
				if (writer) {
					yield* writes
						.check(input.command, definitionOwner(writer.id), input.userId, transaction)
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
						const eventId = change.kind === "update" ? change.item.eventId : change.eventId;
						const source = yield* repository.getEventSnapshot({ eventId, userId: input.userId });
						if (!source) {
							return yield* new EventNotFound({ reason: { eventId, code: "event-not-found" } });
						}
						const { snapshot: before } = source;
						let expected: undefined | EventWritePrecondition;
						if (change.kind === "update") {
							expected = change.item.expected;
						} else if (change.kind === "delete") {
							expected = change.expected;
						}
						if (expected && !matchesExpectedFields(before, expected)) {
							return yield* new EventStale({ reason: { eventId, code: "event-stale" } });
						}
						if (change.kind === "delete" && change.cascadeEntityIds) {
							yield* authorizeCascade(
								transaction,
								input.command,
								input.userId,
								change.cascadeEntityIds,
								before,
							);
						}
						if (change.kind === "move") {
							const references = new Map<EntityId, EntityId>([
								[change.mergeFrom, change.mergeInto],
								...(change.references ?? []).map(({ from, into }) => [from, into] as const),
							]);
							const entityId = references.get(before.entityId) ?? before.entityId;
							const sessionEntityId =
								before.sessionEntityId === null
									? null
									: (references.get(before.sessionEntityId) ?? before.sessionEntityId);
							if (
								change.mergeFrom === change.mergeInto ||
								(entityId === before.entityId &&
									sessionEntityId === before.sessionEntityId &&
									change.properties === undefined)
							) {
								return null;
							}
							return {
								change,
								source,
								item: {
									entityId,
									occurredAt: before.occurredAt,
									eventSchemaSlug: before.eventSchemaSlug,
									sessionEntityId: sessionEntityId ?? undefined,
									properties: change.properties ?? before.properties,
								},
							};
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
				const pending = changes.flatMap((item, position) =>
					item === null ? [] : [{ ...item, position }],
				);
				const scopes = yield* readEventCreateChunkScopes({
					...input,
					transaction,
					commands: [input.command],
					writeCommand: input.command,
					items: pending.map((item) => item.item),
				}).pipe(
					Effect.provideService(EventSchemaReader, schemas),
					Effect.provideService(EntitiesRepository, entities),
					Effect.provideService(DomainWriteChecks, writes),
					Effect.provideService(EventsRepository, repository),
				);
				const prepared = yield* Effect.forEach(pending, (item) =>
					Effect.gen(function* () {
						const command = commandFor(input.command, item.change.itemIdentity);
						const scope = yield* scopes.resolve(
							{ ...item.item, occurredAt: item.item.occurredAt ?? input.command.occurredAt },
							checkCommand(command, item.change),
						);
						const before = item.source?.snapshot;
						if (
							before &&
							(scope.entityScope.entitySchemaSlug !== before.entitySchemaSlug ||
								scope.entityScope.entitySchemaPluginId !== before.entitySchemaPluginId)
						) {
							return yield* conflict("Event entity schema does not match its event schema");
						}
						const properties = yield* parseAppSchemaProperties({
							kind: "Event",
							properties: item.item.properties,
							propertiesSchema: scope.eventSchemaScope.propertiesSchema,
							allowedMissingRequiredPaths: Object.keys(
								scope.eventSchemaScope.propertiesSchema.fields,
							).map((key) => [key]),
						}).pipe(Effect.mapError(() => bad("invalid-properties")));
						const draft = yield* Schema.decodeUnknownEffect(AutomationEventDraft)({
							properties,
							entityId: scope.entityId,
							occurredAt: scope.occurredAt.toISOString(),
							eventSchemaSlug: scope.eventSchemaScope.id,
							sessionEntityId: scope.sessionEntityId ?? null,
							entitySchemaSlug: scope.entityScope.entitySchemaSlug,
							eventSchemaPluginId: scope.eventSchemaScope.pluginId,
							entitySchemaPluginId: scope.entityScope.entitySchemaPluginId,
						}).pipe(Effect.mapError(() => bad("invalid-properties")));
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
								return yield* conflict("Event order anchor is outside the command scope");
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
							position: item.position,
							propertiesSchema: scope.eventSchemaScope.propertiesSchema,
							schemaFingerprint: catalogDefinitionFingerprint(scope.eventSchemaScope),
							identity: eventWriteIdentity(
								input.verbatimIdentities
									? { ...input.command, itemIdentity: item.change.itemIdentity }
									: command,
							),
						};
					}).pipe(Effect.result),
				);
				const items: Array<typeof PreparedEventChange.Type> = [];
				const propertiesSchemas: Record<string, AppSchema> = {};
				const failures: Array<(typeof PreparedEventChanges.Type.failures)[number]> = [];
				// An independent change naming an asset it may not reference fails alone; the commit's lock
				// still fails every change of an asset that changes after this check.
				const checked = input.independent
					? prepared.flatMap((result, index) =>
							result._tag === "Success"
								? [
										{
											index,
											ownerUserId: input.userId,
											properties: result.success.draft.properties,
											propertiesSchema: result.success.propertiesSchema,
										},
									]
								: [],
						)
					: [];
				const assetForbidden = new Set(
					[...(yield* assets.rejected(checked))].map((position) => checked[position]?.index),
				);
				for (const [index, result] of prepared.entries()) {
					const change = pending[index];
					if (!change) {
						return yield* Effect.die("Prepared change index is unavailable");
					}
					if (assetForbidden.has(index)) {
						failures.push({
							itemIdentity: change.change.itemIdentity,
							reason: { code: "asset-forbidden" },
						});
						continue;
					}
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
					failures.push({
						itemIdentity: change.change.itemIdentity,
						reason:
							error._tag === "EventCreateItemError" ? error.reason : { code: "invalid-properties" },
					});
				}
				return { items, failures, propertiesSchemas, references: scopes.references };
			});
			const persist = Effect.fn("EventMutations.persist")(function* (
				transaction: WriteTransaction,
				input: {
					userId: UserId;
					derived?: boolean;
					sealBatch?: boolean;
					batchIndexOffset?: number;
					validated: PolicyDecisions;
					batch?: LifecycleBatchInput;
					prepared: PreparedEventChanges;
					command: DomainLifecycleCommand;
				},
			) {
				yield* session.requireTransaction.pipe(Effect.orDie);
				yield* schemas.lockCatalog([input.userId], transaction);
				const mutationReferences = preparedMutationReferences({
					batches: [input],
					userId: input.userId,
				});
				if (
					!groups.isCaptured(transaction, {
						userId: input.userId,
						drafts: mutationReferences.sources,
						eventIds: capturedEventIds([input]),
						createdEventIds: createdEventIds([input]),
					})
				) {
					yield* captureGroups(transaction, {
						batches: [input],
						userId: input.userId,
						entityIds: Object.keys(input.validated.references).map((id) => EntityId.make(id)),
					});
				}
				const rows = input.prepared.items;
				const referencingRows = rows.map((row) => {
					const accepted = input.validated.items.find(
						(item) => item.itemIdentity === row.change.itemIdentity,
					);
					const ids =
						accepted?.request.resource === "event"
							? [
									row.draft.entityId,
									row.draft.sessionEntityId,
									accepted.request.draft.entityId,
									accepted.request.draft.sessionEntityId,
								].filter((id) => id !== null)
							: [];
					return { ids, eventId: row.source?.snapshot.id ?? null };
				});
				const referencedIds = new Set(referencingRows.flatMap((row) => row.ids));
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
						const changed = referencingRows.find(
							(row) => row.eventId !== null && row.ids.includes(EntityId.make(id)),
						)?.eventId;
						if (changed) {
							return yield* new EventStale({ reason: { eventId: changed, code: "event-stale" } });
						}
						return yield* conflict("Event reference changed during validation");
					}
				}
				const batch = input.batch ?? {
					identity: ["events"],
					command: input.command,
					resource: "event" as const,
				};
				const preparedBatch = input.derived
					? null
					: yield* planner.prepareBatch(transaction, { ...batch, scopes: [input.userId] });
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
				const currentSchemas = yield* schemas.getScopesForUser(
					input.userId,
					[...selections.values()],
					transaction,
				);
				const schemasByScope = new Map(
					[...selections.keys()].map((key, index) => [key, currentSchemas[index] ?? null]),
				);
				const results = [];
				const dispatch: Array<LifecycleDispatchPlan> = [];
				const triggers: Array<AutomationTrigger> = [];
				const assetOwners: Array<Parameters<typeof assets.lock>[0][number]> = [];
				const validatedRows: Array<{
					index: number;
					row: (typeof rows)[number];
					command: DomainLifecycleCommand;
					schema: NonNullable<ReturnType<typeof schemasByScope.get>>;
					draft: Extract<
						PolicyDecisions["items"][number]["request"],
						{ resource: "event" }
					>["draft"];
				}> = [];
				for (const [index, row] of rows.entries()) {
					const accepted = input.validated.items.find(
						(item) => item.itemIdentity === row.change.itemIdentity,
					);
					const refused = accepted ? policyFailureReason(accepted) : null;
					if (refused !== null) {
						return yield* new PolicyRejected({ reason: refused });
					}
					if (accepted?.request.resource !== "event") {
						return yield* conflict("Event policy approval is unavailable");
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
					const command = { ...input.command, itemIdentity: row.identity.itemIdentity };
					const owner = definitionOwner(draft.eventSchemaPluginId);
					yield* writes
						.check(checkCommand(command, row.change), owner, input.userId, transaction)
						.pipe(Effect.catch((error) => conflict(error.message)));
					const schema = schemasByScope.get(scopeKey(draft));
					if (
						!schema ||
						stableStringify(catalogDefinitionFingerprint(schema)) !==
							stableStringify(row.schemaFingerprint)
					) {
						return yield* conflict("Event schema changed during validation");
					}
					yield* assertStableUnder("Event", schema.propertiesSchema, draft.properties, () =>
						bad("invalid-properties"),
					);
					assetOwners.push({
						ownerUserId: input.userId,
						properties: draft.properties,
						propertiesSchema: schema.propertiesSchema,
					});
					validatedRows.push({ row, index, draft, schema, command });
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
					transaction,
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
							if (!(yield* repository.deletePreparedEvent(transaction, identity))) {
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
								!(yield* repository.updatePreparedEvent(transaction, {
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
					yield* planner.recordBatchChange(transaction, preparedBatch.id, {
						payload: change,
						scopeUserId: input.userId,
						index: (input.batchIndexOffset ?? 0) + index,
					});
				}
				if (preparedBatch === null) {
					return { results, dispatch };
				}
				const planned = yield* planner.planChanges(triggers, transaction);
				dispatch.push(...planned.flat());
				if (input.sealBatch !== false) {
					dispatch.push(...(yield* planner.planBatch(transaction, batch)));
				}
				return { results, dispatch };
			});
			const persistBatches = Effect.fn("EventMutations.persistBatches")(function* (
				transaction: WriteTransaction,
				input: {
					userId: UserId;
					batchIndexOffset?: number;
					batch: LifecycleBatchInput;
					batches: ReadonlyArray<{
						validated: PolicyDecisions;
						prepared: PreparedEventChanges;
						command: DomainLifecycleCommand;
					}>;
				},
			) {
				const results = [];
				const dispatch: Array<LifecycleDispatchPlan> = [];
				let offset = input.batchIndexOffset ?? 0;
				for (const prepared of input.batches) {
					const work = yield* persist(transaction, {
						...prepared,
						sealBatch: false,
						batch: input.batch,
						userId: input.userId,
						batchIndexOffset: offset,
					});
					offset += prepared.prepared.items.length;
					results.push(...work.results);
					dispatch.push(...work.dispatch);
				}
				return { results, dispatch, batchIndexOffset: offset };
			});
			const clearPendingReferences = (transaction: WriteTransaction) =>
				Effect.suspend(() =>
					repository.clearReferences(transaction, pendingReferenceClears(transaction).splice(0)),
				);
			// Fold-owned writes skip before-policies and after-hooks: they derive from changes those already saw.
			const applyFoldChanges: ApplyFoldChanges = Effect.fnUntraced(function* (transaction, input) {
				const prepared = yield* prepare(transaction, input);
				const validated = unchangedPolicies(yield* eventPolicyItems(prepared), prepared.references);
				yield* persist(transaction, { ...input, prepared, validated, derived: true }).pipe(
					Effect.catchTag("EventReferenceUnavailable", eventReferenceBadRequest),
				);
				yield* clearPendingReferences(transaction);
			});
			/**
			 * Runs event writes in one transaction with their own write state, then clears the references
			 * their deletions released, queues the folds of what they changed, and validates their event
			 * groups; returns the work's value and the queued subjects.
			 */
			const commit = <A, E, R>(
				work: (transaction: WriteTransaction) => Effect.Effect<A, E, R>,
				eager: boolean,
				preparation: null | WritePreparation,
			) =>
				runRootTransaction(
					session,
					Effect.gen(function* () {
						const state = new WriteTransaction(preparation);
						const value = yield* work(state);
						yield* clearPendingReferences(state);
						const queued = yield* folds.queue(state, eager);
						yield* groups.validateCaptured(state);
						return { value, queued };
					}),
				);
			const writer: FoldWriter = {
				apply: applyFoldChanges,
				commit: (work) =>
					commit(work, true, null).pipe(
						Effect.mapError((error) =>
							error instanceof DbError ? error : unknownToDbError(error),
						),
					),
			};
			/** Folds the user's subjects that have work, writing their results through event transactions. */
			const fold = (input: Parameters<Folds["Service"]["fold"]>[0]) => folds.fold(input, writer);
			/**
			 * Commits event writes. An `eager` commit then folds the subjects it queued on the interactive
			 * lane before returning; a fold that fails leaves its subjects pending for their jobs.
			 */
			const transaction = <A, E, R>(
				work: (transaction: WriteTransaction) => Effect.Effect<A, E, R>,
				mode: FoldMode,
				preparation: null | WritePreparation = null,
			) =>
				Effect.gen(function* () {
					const { value, queued } = yield* commit(work, mode === "eager", preparation);
					if (mode === "eager") {
						yield* Effect.forEach(
							Object.values(Arr.groupBy(queued, ({ userId }) => userId)),
							(subjects) =>
								fold({
									lane: "interactive",
									userId: subjects[0].userId,
									entityIds: subjects.map(({ entityId }) => entityId),
								}).pipe(
									Effect.catchCause((cause) =>
										Effect.logWarning("Folding a commit's subjects failed", cause),
									),
								),
							{ discard: true },
						);
					}
					return value;
				});
			return {
				fold,
				prepare,
				persist,
				transaction,
				captureGroups,
				persistBatches,
				applyFoldChanges,
				lockPreparedChanges,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Folds.layer));
}
