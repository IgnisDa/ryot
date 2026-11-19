import { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationEventChangePayload,
	AutomationEventDraft,
	type AutomationEventSnapshot,
	type AutomationRequestPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EventBadRequest,
	type EventCreateItemError,
	EventStale,
} from "@ryot-app/contract/modules/events/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { EntityId, EventId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { parseAppSchemaProperties } from "@ryot-app/contract/schema/property-values";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { rejectWithLoggedCause } from "#lib/domain/logged-rejection";
import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type CommittedLifecycleWork,
	LifecyclePersistenceError,
	LifecyclePlanner,
} from "#modules/automations/lifecycle/planning";
import { LifecyclePolicies, runItemPolicy } from "#modules/automations/lifecycle/policies";
import { applyLifecyclePolicyPatch } from "#modules/automations/lifecycle/policy-patch";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { definitionText } from "#modules/definitions/text";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	assertStableUnder,
	DomainLifecycleCommand,
	DomainWriteChecks,
	DomainWriteConflict,
	type DomainWritePin,
	writerPropertiesSchema,
} from "#modules/entities/write-context";
import { AccountAdmission } from "#modules/mutations/account-admission";
import {
	type CatalogDefinitionFingerprint,
	catalogDefinitionFingerprint,
} from "#modules/plugins/catalog/runtime-resolver";
import { principalOwner } from "#modules/scripts/authorization/principal";
import { DatabaseSession } from "#platform/db/session";

import {
	capturedEventReferences,
	resolveEventCreateItemScopes,
	validateCapturedEventReferences,
} from "./event-creation";
import type { CapturedEventReferences } from "./event-creation";
import { EventGroupConstraints } from "./event-group-constraints";
import { eventReferenceBadRequest } from "./event-references";
import { EventMutations, matchesExpectedFields } from "./mutations";
import {
	type EventIdentityInput,
	EventsRepository,
	type UpdateEventEntityReferencesInput,
} from "./repository";

type EventRequest = Extract<
	AutomationRequestPayload,
	{ resource: "event"; operation: "update" | "delete" }
>;
type PreparedEventMutationData = {
	readonly expectedRevision: number;
	readonly input: EventIdentityInput;
	readonly before: AutomationEventSnapshot;
	readonly command: DomainLifecycleCommand;
} & (
	| { readonly operation: "delete"; readonly cascadeEntityIds?: ReadonlyArray<EntityId> }
	| {
			readonly operation: "move";
			readonly draft: AutomationEventDraft;
			readonly propertiesSchema: AppSchema;
			readonly referenceContextFingerprint: string;
			readonly move: UpdateEventEntityReferencesInput;
			readonly capturedReferences: CapturedEventReferences;
			readonly eventSchemaFingerprint: CatalogDefinitionFingerprint;
	  }
);
const preparedEventMoveReferences = Symbol("PreparedEventMoveReferences");
const preparedEventDelete = Symbol("PreparedEventDelete");
export type PreparedEventDelete = {
	readonly [preparedEventDelete]: Extract<PreparedEventMutationData, { operation: "delete" }>;
};
export type PreparedEventMoveReferences = {
	readonly [preparedEventMoveReferences]: Extract<PreparedEventMutationData, { operation: "move" }>;
};

type PreparedEventMutationResult =
	| PreparedEventMutationData
	| { readonly _tag: "Committed"; readonly work: CommittedLifecycleWork<null | EventId> };
const eventDraft = ({
	id: _id,
	createdAt: _createdAt,
	updatedAt: _updatedAt,
	...draft
}: AutomationEventSnapshot) => draft;

const eventBadRequest = (
	code:
		| "owner-mismatch"
		| "automation-limit"
		| "mutation-conflict"
		| "invalid-properties"
		| "global-scope-forbidden"
		| "policy-execution-failed"
		| "invalid-policy-transform",
) => new EventBadRequest({ reason: { code } });
const rejected = (code: "mutation-conflict" | "invalid-policy-transform", cause: string) =>
	rejectWithLoggedCause(eventBadRequest(code), cause);
const eventCreateFailure = (error: EventCreateItemError) =>
	rejected("mutation-conflict", `Event reference is not writable: ${error.reason.code}`);
const moveContextFailure = (error: { readonly _tag: string; readonly message: string }) =>
	new DbError({
		message: `Invalid event move context: ${error instanceof DbError ? error.message : error._tag}`,
	});
const eventWriteFailure = (error: DbError | DomainWriteConflict) =>
	error instanceof DomainWriteConflict
		? Effect.fail(eventBadRequest(error.reason.code))
		: rejected("mutation-conflict", error.message);

const mutationSources = (item: PreparedEventMutationData) =>
	item.operation === "delete" ? [item.before] : [item.before, item.draft];

export class EventsService extends Context.Service<EventsService>()(
	"@ryot-app/kernel-backend/modules/events/service/EventsService",
	{
		make: Effect.gen(function* () {
			const repository = yield* EventsRepository;
			const entities = yield* EntitiesRepository;
			const eventSchemas = yield* EventSchemaReader;
			const session = yield* DatabaseSession;
			const assetReferences = yield* ManagedAssetReferenceLocker.make;
			const writeChecks = yield* DomainWriteChecks;
			const groups = yield* EventGroupConstraints.make;
			const mutations = yield* EventMutations;
			const captureGroupMutations = Effect.fnUntraced(function* (
				items: ReadonlyArray<PreparedEventMutationData>,
				entityIds: ReadonlyArray<EntityId>,
			) {
				const userIds = [...new Set(items.map((item) => item.input.userId))].sort();
				for (const userId of userIds) {
					const account = items.find((item) => item.input.userId === userId)?.command.accountUserId;
					if (account !== userId) {
						return yield* new DbError({ message: "Event mutation account is unavailable" });
					}
					yield* admission.admitAccount(account);
				}
				yield* eventSchemas.lockCatalog(userIds);
				yield* repository.lockMutationReferences({
					eventIds: items.map((item) => item.input.eventId),
					sources: items.flatMap((item) =>
						mutationSources(item).map((draft) =>
							Object.assign({}, draft, { userId: item.input.userId }),
						),
					),
				});
				const lockedEntityIds = [
					...new Set([
						...entityIds,
						...items.flatMap((item) =>
							mutationSources(item).flatMap((draft) =>
								draft.sessionEntityId === null
									? [draft.entityId]
									: [draft.entityId, draft.sessionEntityId],
							),
						),
					]),
				].sort();
				for (const userId of userIds) {
					const userItems = items.filter((item) => item.input.userId === userId);
					yield* groups.capture({
						userId,
						entityIds: lockedEntityIds,
						drafts: userItems.flatMap(mutationSources),
						eventIds: userItems.map((item) => item.input.eventId),
						expectedRevisions: new Map(
							userItems.map((item) => [item.input.eventId, item.expectedRevision]),
						),
					});
				}
				return undefined;
			});
			const captureEventGroups = Effect.fn("EventsService.captureEventGroups")(function* (input: {
				readonly entityIds?: ReadonlyArray<EntityId>;
				readonly items: ReadonlyArray<PreparedEventDelete | PreparedEventMoveReferences>;
			}) {
				yield* captureGroupMutations(
					input.items.map((item) => {
						if (preparedEventDelete in item) {
							return item[preparedEventDelete];
						}
						return item[preparedEventMoveReferences];
					}),
					input.entityIds ?? [],
				);
			});
			const authorizeEventDelete = Effect.fnUntraced(function* (
				command: DomainLifecycleCommand,
				input: EventIdentityInput,
				before: AutomationEventSnapshot,
				cascadeEntityIds?: ReadonlyArray<EntityId>,
				lock?: boolean,
			) {
				if (!cascadeEntityIds) {
					return yield* writeChecks
						.check(command, definitionOwner(before.eventSchemaPluginId), input.userId, lock)
						.pipe(Effect.catch(eventWriteFailure));
				}
				const entityId = cascadeEntityIds.find(
					(id) => id === before.entityId || id === before.sessionEntityId,
				);
				const source = entityId ? yield* entities.getMutationEntity(entityId) : null;
				if (
					!source ||
					(source.userId !== null && source.userId !== input.userId) ||
					(before.eventSchemaPluginId !== source.entity.entitySchemaPluginId &&
						!(before.eventSchemaPluginId === null && before.entitySchemaSlug === "collection"))
				) {
					return yield* new DbError({
						message: "Event cascade does not match the authorized entity graph",
					});
				}
				return yield* writeChecks
					.check(command, definitionOwner(source.entity.entitySchemaPluginId), source.userId, lock)
					.pipe(Effect.catch(eventWriteFailure));
			});
			const validateEventDeleteValue = Effect.fnUntraced(function* (
				before: AutomationEventSnapshot,
				pin: null | DomainWritePin,
			) {
				if (!pin || before.eventSchemaPluginId === null) {
					return yield* Effect.void;
				}
				const { pinned, active } = yield* writeChecks.resolvePinnedDeclaration(
					"event",
					pin,
					definitionOwner(before.eventSchemaPluginId),
					{ eventSchemaSlug: before.eventSchemaSlug, entitySchemaSlug: before.entitySchemaSlug },
				);
				if (!pinned) {
					return yield* rejected(
						"mutation-conflict",
						"Event schema conflict: the pinned event definition is unavailable",
					);
				}
				yield* assertStableUnder(
					"Event",
					writerPropertiesSchema(pinned.propertiesSchema),
					before.properties,
					(reason) => reason,
				).pipe(
					Effect.catch((reason) =>
						rejected(
							"mutation-conflict",
							reason === "invalid"
								? "Event schema conflict: current event cannot be processed by the pinned writer"
								: "Event schema conflict: pinned constraints would change the current stored value",
						),
					),
				);
				if (!active) {
					return yield* rejected(
						"mutation-conflict",
						"Event schema conflict: active storage constraints are unavailable",
					);
				}
				yield* parseAppSchemaProperties({
					kind: "Event",
					properties: before.properties,
					propertiesSchema: writerPropertiesSchema(active.propertiesSchema),
				}).pipe(
					Effect.catch(() =>
						rejected(
							"mutation-conflict",
							"Event schema conflict: current event violates active storage constraints",
						),
					),
				);
				return yield* Effect.void;
			});
			const planner = yield* LifecyclePlanner;
			const admission = yield* AccountAdmission.make;
			const execution = yield* LifecycleExecution;
			const policies = yield* LifecyclePolicies;
			const transaction = <A, E, R>(work: Effect.Effect<A, E, R>, userIds: ReadonlyArray<UserId>) =>
				mutations
					.transaction(eventSchemas.lockCatalog(userIds).pipe(Effect.andThen(work)))
					.pipe(
						Effect.catchTag("DatabaseSessionStateError", () =>
							Effect.fail(
								new DbError({
									message: "Event lifecycle mutations require a root transaction boundary",
								}),
							),
						),
					);
			const assertRootTransaction = session.requireRoot.pipe(
				Effect.mapError(
					() =>
						new DbError({
							message: "Event lifecycle mutations require a root transaction boundary",
						}),
				),
			);
			const assertActiveTransaction = session.requireTransaction.pipe(
				Effect.mapError(
					() => new LifecyclePersistenceError({ code: "active-transaction-required" }),
				),
			);
			const resolveEventScopes = (input: Parameters<typeof resolveEventCreateItemScopes>[0]) =>
				resolveEventCreateItemScopes(input).pipe(
					Effect.provideService(DomainWriteChecks, writeChecks),
					Effect.provideService(EntitiesRepository, entities),
					Effect.provideService(EventSchemaReader, eventSchemas),
				);
			const resolveEditContext = Effect.fnUntraced(function* (
				userId: UserId,
				before: AutomationEventSnapshot,
				draftInput: AutomationEventDraft,
				command: DomainLifecycleCommand,
				previousReferences: CapturedEventReferences = {},
				pinnedSchema?: {
					propertiesSchema: AppSchema;
					eventSchemaFingerprint: CatalogDefinitionFingerprint;
				},
				commit?: boolean,
			) {
				if (
					draftInput.eventSchemaSlug !== before.eventSchemaSlug ||
					draftInput.entitySchemaSlug !== before.entitySchemaSlug
				) {
					return yield* rejected("invalid-policy-transform", "Event schema identity is immutable");
				}
				const scope = yield* resolveEventScopes({
					userId,
					command,
					commit: commit ?? false,
					item: { ...draftInput, sessionEntityId: draftInput.sessionEntityId ?? undefined },
				}).pipe(Effect.catchTag("EventCreateItemError", eventCreateFailure));
				if (
					scope.entityScope.entitySchemaSlug !== before.entitySchemaSlug ||
					scope.entityScope.entitySchemaPluginId !== before.eventSchemaPluginId
				) {
					return yield* rejected(
						"mutation-conflict",
						"Event entity schema does not match its event schema",
					);
				}
				const eventSchemaFingerprint = catalogDefinitionFingerprint(scope.eventSchemaScope);
				if (
					pinnedSchema &&
					stableStringify(eventSchemaFingerprint) !==
						stableStringify(pinnedSchema.eventSchemaFingerprint)
				) {
					return yield* rejected(
						"invalid-policy-transform",
						"Event schema changed while lifecycle policies ran",
					);
				}
				const propertiesSchema =
					pinnedSchema?.propertiesSchema ?? scope.eventSchemaScope.propertiesSchema;
				const properties = yield* parseAppSchemaProperties({
					kind: "Event",
					properties: draftInput.properties,
					propertiesSchema:
						command.writeContext?.pluginRevision && before.eventSchemaPluginId !== null
							? writerPropertiesSchema(propertiesSchema)
							: propertiesSchema,
				}).pipe(Effect.mapError(() => eventBadRequest("invalid-properties")));
				if (command.writeContext?.pluginRevision) {
					yield* assertStableUnder(
						"Event",
						writerPropertiesSchema(propertiesSchema),
						before.properties,
						(reason) => reason,
					).pipe(
						Effect.catch((reason) =>
							rejected(
								"mutation-conflict",
								reason === "invalid"
									? "Current event cannot be processed by the pinned writer"
									: "Pinned event constraints would change the current stored value",
							),
						),
					);
				}
				if (commit) {
					yield* assertStableUnder(
						"Event",
						command.writeContext?.pluginRevision && before.eventSchemaPluginId !== null
							? writerPropertiesSchema(scope.activePropertiesSchema)
							: scope.activePropertiesSchema,
						properties,
						(reason) => reason,
					).pipe(
						Effect.catch((reason) =>
							rejected(
								"mutation-conflict",
								reason === "invalid"
									? "Pinned event payload violates active storage constraints"
									: "Active event constraints would change the pinned payload",
							),
						),
					);
				}
				const draft = yield* Schema.decodeUnknownEffect(AutomationEventDraft)({
					...draftInput,
					properties,
					entityId: scope.entityId,
					eventSchemaSlug: scope.eventSchemaScope.id,
					occurredAt: scope.occurredAt.toISOString(),
					sessionEntityId: scope.sessionEntityId ?? null,
					eventSchemaPluginId: scope.eventSchemaScope.pluginId,
					entitySchemaSlug: scope.entityScope.entitySchemaSlug,
					entitySchemaPluginId: scope.entityScope.entitySchemaPluginId,
				}).pipe(Effect.mapError(() => eventBadRequest("invalid-properties")));
				const capturedReferences = yield* capturedEventReferences(
					userId,
					draft,
					previousReferences,
				).pipe(
					Effect.provideService(EntitiesRepository, entities),
					Effect.catchTag("EventCreateItemError", eventCreateFailure),
				);
				const referenceIds = [
					...new Set([
						draft.entityId,
						...(draft.sessionEntityId === null ? [] : [draft.sessionEntityId]),
					]),
				].sort();
				const references = referenceIds.map((entityId) => ({
					entityId,
					fingerprint: capturedReferences[entityId],
				}));
				return {
					draft,
					propertiesSchema,
					capturedReferences,
					eventSchemaFingerprint,
					referenceContextFingerprint: stableStringify({
						references,
						eventSchema: eventSchemaFingerprint,
					}),
				};
			});
			const prepareMoveOrDelete = Effect.fnUntraced(function* (
				input: EventIdentityInput,
				commandInput: DomainLifecycleCommand,
				move?: UpdateEventEntityReferencesInput,
				inline?: boolean,
				cascadeEntityIds?: ReadonlyArray<EntityId>,
			): Effect.fn.Return<
				null | PreparedEventMutationResult,
				DbError | EventStale | EventBadRequest | LifecyclePersistenceError
			> {
				yield* assertRootTransaction;
				const command = yield* Schema.decodeEffect(DomainLifecycleCommand)(commandInput).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid event lifecycle command" })),
				);
				const planned = yield* transaction(
					Effect.gen(function* () {
						let scopeUserId: null | UserId = input.userId;
						if (cascadeEntityIds) {
							const pluginRevision = command.writeContext?.pluginRevision;
							if (pluginRevision) {
								if (pluginRevision.scope === "user") {
									scopeUserId = pluginRevision.ownerId;
								} else {
									scopeUserId = null;
								}
							}
						}
						yield* writeChecks
							.check(command, principalOwner(command.writeContext), scopeUserId, true)
							.pipe(Effect.catch(eventWriteFailure));
						const current = yield* repository.getEventSnapshot(input);
						if (!current) {
							if (input.expected) {
								return yield* new EventStale({
									reason: { code: "event-stale", eventId: input.eventId },
								});
							}
							return inline
								? { _tag: "Committed" as const, work: { result: null, dispatch: [] } }
								: null;
						}
						const { snapshot: before, revision: expectedRevision } = current;
						if (input.expected && !matchesExpectedFields(before, input.expected)) {
							return yield* new EventStale({
								reason: { code: "event-stale", eventId: input.eventId },
							});
						}
						const pin = yield* authorizeEventDelete(command, input, before, cascadeEntityIds);
						if (!move) {
							yield* validateEventDeleteValue(before, pin);
						}
						let request: EventRequest;
						let draft: undefined | AutomationEventDraft;
						let referenceContextFingerprint: string | undefined;
						let eventSchemaFingerprint: undefined | CatalogDefinitionFingerprint;
						let propertiesSchema: AppSchema | undefined;
						let capturedReferences: undefined | CapturedEventReferences;
						if (move) {
							const references = new Map([
								[move.mergeFrom, move.mergeInto],
								...(move.references ?? []).map(({ from, into }) => [from, into] as const),
							]);
							if (
								move.mergeFrom === move.mergeInto ||
								(!references.has(before.entityId) &&
									(before.sessionEntityId === null || !references.has(before.sessionEntityId)) &&
									move.properties === undefined)
							) {
								return inline
									? { _tag: "Committed" as const, work: { result: null, dispatch: [] } }
									: null;
							}
							const draftInput = yield* Schema.decodeUnknownEffect(AutomationEventDraft)({
								...eventDraft(before),
								entityId: references.get(before.entityId) ?? before.entityId,
								sessionEntityId:
									before.sessionEntityId === null
										? null
										: (references.get(before.sessionEntityId) ?? before.sessionEntityId),
								...(move.properties === undefined ? {} : { properties: move.properties }),
							}).pipe(
								Effect.mapError(() => new DbError({ message: "Invalid event update draft" })),
							);
							const context = yield* resolveEditContext(
								input.userId,
								before,
								draftInput,
								command,
							).pipe(Effect.mapError(moveContextFailure));
							draft = context.draft;
							referenceContextFingerprint = context.referenceContextFingerprint;
							eventSchemaFingerprint = context.eventSchemaFingerprint;
							propertiesSchema = context.propertiesSchema;
							capturedReferences = context.capturedReferences;
							request = {
								before,
								resource: "event",
								category: "request",
								operation: "update",
								draft: context.draft,
							};
						} else {
							request = {
								draft: before,
								resource: "event",
								category: "request",
								operation: "delete",
							};
						}
						const discriminator = input.expected
							? stableStringify([
									move ? "event-move" : "event-delete",
									expectedRevision,
									referenceContextFingerprint ?? stableStringify(before),
								])
							: undefined;
						const trigger =
							discriminator === undefined
								? yield* lifecycleTrigger(command, input.userId, request)
								: yield* lifecycleTrigger(command, input.userId, request, discriminator);
						const matched = yield* policies.match(trigger);
						const makePrepared = (): null | PreparedEventMutationData => {
							if (!move) {
								return {
									input,
									before,
									command,
									expectedRevision,
									operation: "delete",
									...(cascadeEntityIds ? { cascadeEntityIds } : {}),
								};
							}
							if (
								!draft ||
								referenceContextFingerprint === undefined ||
								eventSchemaFingerprint === undefined ||
								propertiesSchema === undefined ||
								capturedReferences === undefined
							) {
								return null;
							}
							return {
								move,
								input,
								draft,
								before,
								command,
								expectedRevision,
								propertiesSchema,
								operation: "move",
								capturedReferences,
								eventSchemaFingerprint,
								referenceContextFingerprint,
							};
						};
						if (inline && matched.length === 0) {
							const prepared = makePrepared();
							if (!prepared) {
								return yield* new DbError({ message: "Missing validated event move context" });
							}
							return {
								_tag: "Committed" as const,
								work: yield* withBatch(command, persist(prepared)),
							};
						}
						return {
							input,
							draft,
							before,
							trigger,
							command,
							request,
							expectedRevision,
							propertiesSchema,
							policies: matched,
							capturedReferences,
							eventSchemaFingerprint,
							_tag: "Planned" as const,
							referenceContextFingerprint,
						};
					}),
					[input.userId],
				);
				if (!planned) {
					return null;
				}
				if (planned._tag === "Committed") {
					return planned;
				}
				let request = planned.request;
				let draft = planned.draft;
				let referenceContextFingerprint = planned.referenceContextFingerprint;
				let capturedReferences = planned.capturedReferences;
				for (const policy of planned.policies) {
					const output = yield* runItemPolicy(policies, {
						policy,
						request,
						trigger: planned.trigger,
					}).pipe(
						Effect.catchTag("AutomationPolicyExecutionError", () =>
							Effect.fail(eventBadRequest("policy-execution-failed")),
						),
					);
					if (output.action === "reject") {
						return yield* new EventBadRequest({
							reason: {
								code: "policy-rejected",
								message: definitionText(policy.pluginId, output.reason),
							},
						});
					}
					if (output.action === "transform") {
						if (!move || request.operation !== "update") {
							return yield* rejected(
								"invalid-policy-transform",
								"Event policy cannot transform this mutation",
							);
						}
						const patched = applyLifecyclePolicyPatch(request, output.patch);
						if (!patched.ok) {
							return yield* rejected("invalid-policy-transform", patched.reason);
						}
						if (
							planned.eventSchemaFingerprint === undefined ||
							planned.propertiesSchema === undefined ||
							capturedReferences === undefined
						) {
							return yield* new DbError({ message: "Missing validated event move context" });
						}
						const context = yield* resolveEditContext(
							input.userId,
							planned.before,
							patched.request.draft,
							command,
							capturedReferences,
							{
								propertiesSchema: planned.propertiesSchema,
								eventSchemaFingerprint: planned.eventSchemaFingerprint,
							},
						).pipe(Effect.mapError(moveContextFailure));
						request = { ...patched.request, draft: context.draft };
						draft = context.draft;
						referenceContextFingerprint = context.referenceContextFingerprint;
						capturedReferences = context.capturedReferences;
					}
				}
				if (move) {
					if (
						!draft ||
						referenceContextFingerprint === undefined ||
						planned.eventSchemaFingerprint === undefined ||
						planned.propertiesSchema === undefined ||
						capturedReferences === undefined
					) {
						return yield* new DbError({ message: "Missing validated event move context" });
					}
					return {
						move,
						draft,
						capturedReferences,
						input: planned.input,
						before: planned.before,
						command: planned.command,
						operation: "move" as const,
						referenceContextFingerprint,
						propertiesSchema: planned.propertiesSchema,
						expectedRevision: planned.expectedRevision,
						eventSchemaFingerprint: planned.eventSchemaFingerprint,
					};
				}
				return {
					input: planned.input,
					before: planned.before,
					command: planned.command,
					operation: "delete" as const,
					...(cascadeEntityIds ? { cascadeEntityIds } : {}),
					expectedRevision: planned.expectedRevision,
				};
			});

			const prepareMoveReferences = Effect.fn("EventsService.prepareMoveReferences")(function* (
				input: UpdateEventEntityReferencesInput,
				command: DomainLifecycleCommand,
			) {
				const value = yield* prepareMoveOrDelete(input, command, input);
				return value && !("_tag" in value) && value.operation === "move"
					? Object.freeze({ [preparedEventMoveReferences]: value })
					: null;
			});
			const prepareDelete = Effect.fn("EventsService.prepareDelete")(function* (
				input: EventIdentityInput,
				command: DomainLifecycleCommand,
			) {
				const value = yield* prepareMoveOrDelete(input, command);
				return value && !("_tag" in value) && value.operation === "delete"
					? Object.freeze({ [preparedEventDelete]: value })
					: null;
			});
			const prepareEntityCascadeDelete = Effect.fn("EventsService.prepareEntityCascadeDelete")(
				function* (
					input: EventIdentityInput,
					entityIds: ReadonlyArray<EntityId>,
					command: DomainLifecycleCommand,
				) {
					const value = yield* prepareMoveOrDelete(input, command, undefined, false, entityIds);
					return value && !("_tag" in value) && value.operation === "delete"
						? Object.freeze({ [preparedEventDelete]: value })
						: null;
				},
			);

			const verifyPreparedEditContext = Effect.fnUntraced(function* (
				prepared: Extract<PreparedEventMutationData, { operation: "move" }>,
			) {
				yield* entities.lockEntityReferencesByIds([
					prepared.before.entityId,
					...(prepared.before.sessionEntityId === null ? [] : [prepared.before.sessionEntityId]),
					prepared.draft.entityId,
					...(prepared.draft.sessionEntityId === null ? [] : [prepared.draft.sessionEntityId]),
				]);
				yield* eventSchemas.lockCatalog([prepared.input.userId]);
				const current = yield* resolveEditContext(
					prepared.input.userId,
					prepared.before,
					prepared.draft,
					prepared.command,
					prepared.capturedReferences,
					{
						propertiesSchema: prepared.propertiesSchema,
						eventSchemaFingerprint: prepared.eventSchemaFingerprint,
					},
					true,
				).pipe(
					Effect.catchTag("EventBadRequest", () =>
						Effect.fail(
							new EventStale({ reason: { code: "event-stale", eventId: prepared.input.eventId } }),
						),
					),
				);
				if (current.referenceContextFingerprint !== prepared.referenceContextFingerprint) {
					return yield* new EventStale({
						reason: { code: "event-stale", eventId: prepared.input.eventId },
					});
				}
				yield* validateCapturedEventReferences(
					prepared.input.userId,
					prepared.draft,
					prepared.capturedReferences,
				).pipe(
					Effect.provideService(EntitiesRepository, entities),
					Effect.catchTag("EventCreateItemError", () =>
						Effect.fail(
							new EventStale({ reason: { code: "event-stale", eventId: prepared.input.eventId } }),
						),
					),
				);
				return undefined;
			});
			const persist = Effect.fnUntraced(function* (
				prepared: PreparedEventMutationData,
				batchInput?: {
					index: number;
					commandInput?: unknown;
					command: DomainLifecycleCommand;
					identity: ReadonlyArray<string>;
				},
			) {
				yield* assertActiveTransaction;
				yield* eventSchemas.lockCatalog([prepared.input.userId]);
				const deletePin =
					prepared.operation === "delete"
						? yield* authorizeEventDelete(
								prepared.command,
								prepared.input,
								prepared.before,
								prepared.cascadeEntityIds,
								true,
							)
						: null;
				if (prepared.operation !== "delete") {
					yield* writeChecks
						.check(
							prepared.command,
							definitionOwner(prepared.before.eventSchemaPluginId),
							prepared.input.userId,
							true,
						)
						.pipe(Effect.catch(eventWriteFailure));
				}
				if (
					!(yield* groups.isCaptured({
						userId: prepared.input.userId,
						drafts: mutationSources(prepared),
						eventIds: [prepared.input.eventId],
					}))
				) {
					yield* captureGroupMutations([prepared], []);
				}
				yield* entities.lockEntityReferencesByIds([
					prepared.before.entityId,
					...(prepared.before.sessionEntityId === null ? [] : [prepared.before.sessionEntityId]),
					...(prepared.operation === "delete"
						? []
						: [
								prepared.draft.entityId,
								...(prepared.draft.sessionEntityId === null
									? []
									: [prepared.draft.sessionEntityId]),
							]),
				]);
				if (prepared.operation === "delete") {
					const current = yield* repository.getEventSnapshot(prepared.input);
					if (current) {
						yield* validateEventDeleteValue(current.snapshot, deletePin);
					}
				}
				const batchScope = {
					resource: "event" as const,
					command: batchInput?.command ?? prepared.command,
					identity: batchInput?.identity ?? [prepared.command.itemIdentity],
				};
				const batch = yield* planner.prepareBatch({
					...batchScope,
					scopes: [prepared.input.userId],
				});
				let eventId: EventId;
				let change: AutomationEventChangePayload;
				if (prepared.operation === "move") {
					yield* verifyPreparedEditContext(prepared);
					yield* assetReferences
						.lock([
							{
								ownerUserId: prepared.input.userId,
								properties: prepared.draft.properties,
								propertiesSchema: prepared.propertiesSchema,
							},
						])
						.pipe(
							Effect.catchTag(
								"ManagedAssetReferenceRejected",
								() => new EventBadRequest({ reason: { code: "asset-forbidden" } }),
							),
						);
					const updated = yield* repository
						.updatePreparedEvent({
							...prepared.input,
							draft: prepared.draft,
							expectedRevision: prepared.expectedRevision,
							propertiesSchema: prepared.propertiesSchema,
							updatedAt: DateTime.toDate(DateTime.makeUnsafe(prepared.command.occurredAt)),
						})
						.pipe(Effect.catchTag("EventReferenceUnavailable", eventReferenceBadRequest));
					if (!updated) {
						return yield* new EventStale({
							reason: { code: "event-stale", eventId: prepared.input.eventId },
						});
					}
					const after = yield* repository.getEventSnapshot(prepared.input);
					if (!after) {
						return yield* new DbError({ message: "Updated event disappeared" });
					}
					eventId = updated;
					change = {
						resource: "event",
						category: "change",
						operation: "update",
						after: after.snapshot,
						before: prepared.before,
					};
				} else {
					const deleted = yield* repository.deletePreparedEvent({
						...prepared.input,
						expectedRevision: prepared.expectedRevision,
					});
					if (!deleted) {
						return yield* new EventStale({
							reason: { code: "event-stale", eventId: prepared.input.eventId },
						});
					}
					eventId = deleted;
					change = {
						resource: "event",
						category: "change",
						operation: "delete",
						before: prepared.before,
					};
				}
				const dispatch = yield* planner.planChange({
					trigger: yield* lifecycleTrigger(prepared.command, prepared.input.userId, change),
				});
				yield* planner.recordBatchChange(batch.id, {
					payload: change,
					index: batchInput?.index ?? 0,
					scopeUserId: prepared.input.userId,
				});
				return { dispatch, result: eventId } satisfies CommittedLifecycleWork<null | EventId>;
			});

			const persistPreparedMoveReferences = Effect.fn(
				"EventsService.persistPreparedMoveReferences",
			)(function* (
				prepared: PreparedEventMoveReferences,
				batch?: { index: number; command: DomainLifecycleCommand; identity: ReadonlyArray<string> },
			) {
				return yield* persist(prepared[preparedEventMoveReferences], batch);
			});
			const persistPreparedDelete = Effect.fn("EventsService.persistPreparedDelete")(function* (
				prepared: PreparedEventDelete,
				batch?: { index: number; command: DomainLifecycleCommand; identity: ReadonlyArray<string> },
			) {
				return yield* persist(prepared[preparedEventDelete], batch);
			});
			const withBatch = Effect.fnUntraced(function* (
				command: DomainLifecycleCommand,
				persisted: Effect.Effect<
					CommittedLifecycleWork<null | EventId>,
					Effect.Error<ReturnType<typeof persist>>
				>,
				commandInput?: unknown,
			) {
				const work = yield* persisted;
				const batch = yield* planner.planBatch({
					command,
					resource: "event",
					identity: [command.itemIdentity],
					...(commandInput === undefined ? {} : { commandInput }),
				});
				return { ...work, dispatch: [...work.dispatch, ...batch] };
			});
			const moveReferences = Effect.fn("EventsService.moveReferences")(function* (
				input: UpdateEventEntityReferencesInput,
				command: DomainLifecycleCommand,
			) {
				const prepared = yield* prepareMoveOrDelete(input, command, input, true);
				if (!prepared) {
					return { eventId: null };
				}
				const work =
					"_tag" in prepared
						? prepared.work
						: yield* transaction(withBatch(command, persist(prepared)), [input.userId]);
				yield* execution.dispatch(work.dispatch);
				return { eventId: work.result };
			});

			return {
				prepareDelete,
				moveReferences,
				captureEventGroups,
				prepareMoveReferences,
				persistPreparedDelete,
				prepareEntityCascadeDelete,
				persistPreparedMoveReferences,
				transaction: mutations.transaction,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(EventMutations.layer));
}
