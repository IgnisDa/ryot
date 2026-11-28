import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEventSnapshot,
	type AutomationPolicyOutput,
	type AutomationRequestPayload,
	AutomationRun,
	type AutomationTrigger,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationHookSlug,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	ImportRunId,
	PluginId,
	PluginPackageId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { scriptsDigestOf } from "@ryot-app/sandbox/host/executor.test-support";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import {
	insertManagedAsset,
	managedAssetProperty,
} from "#lib/domain/managed-asset-writes.test-support";
import {
	noHooksFixture,
	policyFixture,
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type LifecyclePlan,
	LifecyclePlanner,
	lifecycleRunId,
} from "#modules/automations/lifecycle/planning";
import {
	AutomationPolicyExecutionError,
	LifecyclePolicies,
	type LifecyclePolicy,
	type PolicyRequest,
} from "#modules/automations/lifecycle/policies";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { Folds } from "#modules/derived-values/service";
import { unfoldedFolds } from "#modules/derived-values/test-support";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	DomainWriteChecks,
	DomainWriteChecksLive,
	DomainWriteConflict,
} from "#modules/entities/write-context";
import { EventsRepository } from "#modules/events/repository";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { importRun } from "#schema/tables/imports";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { createEvents, eventChangeSets } from "./change-sets.test-support";
import { eventCreateChanges } from "./changes";
import { ChangeSets } from "./service";

const now = IsoUtcString.make("2026-01-01T00:00:00.000Z");
const userId = UserId.make("user");
const entityId = EntityId.make("subject");
const eventSchemaSlug = EventSchemaSlug.make("rating");
const entitySchemaSlug = EntitySchemaSlug.make("record");
const command = {
	...rootLifecycleCommand({
		source: "api",
		occurredAt: now,
		lane: "interactive",
		accountUserId: userId,
		itemIdentity: "events",
		initiator: { id: userId, kind: "user" },
		executionId: AutomationExecutionId.make("batch"),
	}),
	writeContext: null,
};
const payload: Parameters<typeof createEvents>[0] = {
	userId,
	command,
	payload: [{ entityId, eventSchemaSlug, properties: { rating: 1 } }],
};
type CreatedEvent = Parameters<EventsRepository["Service"]["createEvent"]>[1];

type Policy = {
	slug: string;
	plugin?: string;
	position: number;
	frequency?: "item" | "once-per-subject";
};
type HarnessOptions = {
	noHooks?: boolean;
	blocked?: boolean;
	policies?: Policy[];
	failChange?: boolean;
	policyRatings?: number[];
	foreignEntity?: EntityId;
	blockedRatings?: number[];
	unreadableEntity?: EntityId;
	afterHookRatings?: number[];
	revokeEntityBeforeWrite?: EntityId;
	activateSchemaBeforeWrite?: boolean;
	changeEntityMetadataDuringPolicy?: EntityId;
	execute?: (input: {
		index: number;
		payload: AutomationRequestPayload;
	}) => Effect.Effect<AutomationPolicyOutput, AutomationPolicyExecutionError>;
};

const foreignPluginId = "foreign";

const visibleEntity = (
	{
		options,
		lockedEntityIds,
		changedEntityMetadata,
	}: Pick<HarnessState, "options" | "lockedEntityIds" | "changedEntityMetadata">,
	requestedId: EntityId,
) =>
	requestedId === options.unreadableEntity ||
	(requestedId === options.revokeEntityBeforeWrite &&
		lockedEntityIds.some((locked) => locked.includes(requestedId)))
		? null
		: {
				name: "Record",
				createdAt: now,
				updatedAt: now,
				id: requestedId,
				externalId: null,
				entitySchemaSlug,
				providerId: null,
				populatedAt: null,
				properties: changedEntityMetadata.has(requestedId) ? { changed: true } : {},
				entitySchemaPluginId:
					requestedId === options.foreignEntity ? PluginId.make(foreignPluginId) : null,
			};

const ratingSchema = (schemaActivated: boolean): AppSchema => ({
	fields: {
		image: managedAssetProperty,
		rating: schemaActivated
			? {
					label: "Rating",
					description: "Rating",
					type: "string" as const,
					validation: { required: true },
				}
			: {
					label: "Rating",
					description: "Rating",
					type: "number" as const,
					validation: { required: true },
					normalize: { round: { scale: 2 } },
				},
	},
});

const eventSchemaScope = (schemaDisabled: boolean, schemaActivated: boolean) =>
	schemaDisabled
		? null
		: {
				pluginId: null,
				slug: "rating",
				entitySchemaSlug,
				id: eventSchemaSlug,
				propertiesSchema: ratingSchema(schemaActivated),
				name: { key: "test.rating", namespace: "kernel" },
			};

const ratingOf = (properties: Readonly<Record<string, unknown>>) => {
	const rating = properties["rating"];
	return typeof rating === "number" ? rating : undefined;
};

const requestRating = (request: AutomationRequestPayload) =>
	request.resource === "event" && request.operation === "create"
		? ratingOf(request.draft.properties)
		: undefined;

const triggerRating = (trigger: AutomationTrigger) =>
	trigger.payload?.resource === "event" && trigger.payload.operation === "create"
		? ratingOf(trigger.payload.after.properties)
		: undefined;

const rated = (
	ratings: number[] | undefined,
	fallback: boolean,
	found: ReadonlyArray<number | undefined>,
) =>
	ratings === undefined
		? fallback
		: found.some((rating) => rating !== undefined && ratings.includes(rating));

const harnessPolicy = (policy: Policy): LifecyclePolicy => {
	const pluginId = PluginId.make(policy.plugin ?? "plugin");
	const fixture = policyFixture(
		policy.position,
		[{ eventSchemaSlug, entitySchemaSlug, resource: "event", operation: "create" }],
		userId,
	);
	return {
		...fixture,
		pluginId,
		hook: {
			...fixture.hook,
			slug: policy.slug,
			...(policy.frequency ? { batchFrequency: policy.frequency } : {}),
		},
	};
};

const hookRun = (trigger: AutomationTrigger, slug: string) => {
	const pluginId = PluginId.make("plugin");
	const hookSlug = AutomationHookSlug.make(slug);
	return Schema.decodeEffect(AutomationRun)({
		pluginId,
		hookSlug,
		queuedAt: now,
		hookName: slug,
		attemptCount: 0,
		startedAt: null,
		status: "queued",
		skipReason: null,
		finishedAt: null,
		nextAttemptAt: null,
		scriptSlug: "script",
		triggerId: trigger.id,
		artifactsExpireAt: now,
		executionUserId: userId,
		sandboxScriptId: "script",
		scriptContentHash: "hash",
		pluginRevisionId: "revision",
		pluginConfigRevisionId: "config",
		retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
		id: lifecycleRunId({ pluginId, hookSlug, triggerId: trigger.id, executionUserId: userId }),
	}).pipe(Effect.orDie);
};

type HarnessState = {
	readonly options: HarnessOptions;
	readonly schemaDisabled: boolean;
	readonly schemaActivated: boolean;
	readonly activeTransaction: boolean;
	readonly calls: ReadonlyArray<string>;
	readonly executed: ReadonlyArray<string>;
	readonly created: ReadonlyArray<CreatedEvent>;
	readonly checkedOwners: ReadonlyArray<string>;
	readonly requests: ReadonlyArray<PolicyRequest>;
	readonly triggers: ReadonlyArray<AutomationTrigger>;
	readonly planned: ReadonlyMap<string, LifecyclePlan>;
	readonly changedEntityMetadata: ReadonlySet<EntityId>;
	readonly inputs: ReadonlyArray<AutomationRequestPayload>;
	readonly lockedEntityIds: ReadonlyArray<ReadonlyArray<EntityId>>;
};

const initialState = (options: HarnessOptions): HarnessState => ({
	options,
	calls: [],
	inputs: [],
	created: [],
	triggers: [],
	requests: [],
	executed: [],
	checkedOwners: [],
	planned: new Map(),
	lockedEntityIds: [],
	schemaDisabled: false,
	schemaActivated: false,
	activeTransaction: false,
	changedEntityMetadata: new Set(),
});

class IndependentEventsHarness extends Context.Service<
	IndependentEventsHarness,
	{
		readonly calls: Effect.Effect<ReadonlyArray<string>>;
		readonly executed: Effect.Effect<ReadonlyArray<string>>;
		readonly created: Effect.Effect<ReadonlyArray<CreatedEvent>>;
		readonly checkedOwners: Effect.Effect<ReadonlyArray<string>>;
		readonly requests: Effect.Effect<ReadonlyArray<PolicyRequest>>;
		readonly reset: (options: HarnessOptions) => Effect.Effect<void>;
		readonly triggers: Effect.Effect<ReadonlyArray<AutomationTrigger>>;
		readonly inputs: Effect.Effect<ReadonlyArray<AutomationRequestPayload>>;
		readonly lockedEntityIds: Effect.Effect<ReadonlyArray<ReadonlyArray<EntityId>>>;
	}
>()("@ryot-app/kernel-backend/modules/changes/independent-events.test/IndependentEventsHarness") {}

const harnessLayer = (initialOptions: HarnessOptions = {}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const state = yield* Ref.make(initialState(initialOptions));
			const current = Ref.get(state);
			const read = <A>(select: (snapshot: HarnessState) => A) => Effect.map(current, select);
			const update = (change: (snapshot: HarnessState) => Partial<HarnessState>) =>
				Ref.update(state, (snapshot) => ({ ...snapshot, ...change(snapshot) }));
			const fakeCreateEvent = (input: CreatedEvent) =>
				Effect.gen(function* () {
					const { activeTransaction } = yield* current;
					expect(activeTransaction).toBe(true);
					yield* update(({ calls, created }) => ({
						calls: [...calls, "write"],
						created: [...created, input],
					}));
					return {
						id: input.id,
						createdAt: now,
						updatedAt: now,
						entityId: input.entityId,
						properties: input.properties,
						eventSchemaSlug: input.eventSchemaSlug,
						eventSchemaName: input.eventSchemaName,
						sessionEntityId: input.sessionEntityId,
						occurredAt: input.occurredAt.toISOString(),
						eventSchemaPluginId:
							input.eventSchemaPluginId === null ? null : PluginId.make(input.eventSchemaPluginId),
					};
				});
			const fakeEventSnapshot = ({ eventId }: { readonly eventId: string }) =>
				Effect.gen(function* () {
					const snapshot = yield* current;
					const created = snapshot.created.find(({ id }) => id === eventId);
					if (!created) {
						return null;
					}
					const entitySchemaPluginId =
						visibleEntity(snapshot, created.entityId)?.entitySchemaPluginId ?? null;
					return yield* Schema.decodeUnknownEffect(AutomationEventSnapshot)({
						id: created.id,
						createdAt: now,
						updatedAt: now,
						entitySchemaSlug,
						entitySchemaPluginId,
						entityId: created.entityId,
						properties: created.properties,
						eventSchemaSlug: created.eventSchemaSlug,
						occurredAt: created.occurredAt.toISOString(),
						sessionEntityId: created.sessionEntityId ?? null,
						eventSchemaPluginId:
							created.eventSchemaPluginId === null
								? null
								: PluginId.make(created.eventSchemaPluginId),
					}).pipe(
						Effect.mapBoth({
							onSuccess: (eventSnapshot) => ({ revision: 0, snapshot: eventSnapshot }),
							onFailure: () => new DbError({ message: "Invalid fixture event snapshot" }),
						}),
					);
				});
			const record = (call: string) => update(({ calls }) => ({ calls: [...calls, call] }));
			const recordEntityLocks = (entityIds: ReadonlyArray<EntityId>) =>
				Effect.gen(function* () {
					expect((yield* current).activeTransaction).toBe(true);
					yield* update(({ lockedEntityIds }) => ({
						lockedEntityIds: [...lockedEntityIds, [...entityIds]],
					}));
				});
			const remember = (plan: LifecyclePlan) =>
				update(({ planned }) => ({ planned: new Map([...planned, [plan.trigger.id, plan]]) })).pipe(
					Effect.as(plan),
				);
			const database = Layer.effect(
				DatabaseSession,
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						db
							.insert(user)
							.values({ id: userId, name: "User", email: "event-workflow@example.test" }),
					);
					return DatabaseSession.of({
						...session,
						transaction: (work) =>
							Effect.gen(function* () {
								const before = yield* current;
								expect(before.activeTransaction).toBe(false);
								const saved = { created: before.created.length, triggers: before.triggers.length };
								yield* update(({ calls }) => ({
									activeTransaction: true,
									calls: [...calls, "begin"],
								}));
								return yield* session.transaction(work).pipe(
									Effect.tapError(() =>
										update(({ calls, created, triggers }) => ({
											calls: [...calls, "rollback"],
											created: created.slice(0, saved.created),
											triggers: triggers.slice(0, saved.triggers),
										})),
									),
									Effect.tap(() => record("commit")),
									Effect.ensuring(update(() => ({ activeTransaction: false }))),
								);
							}),
					});
				}),
			).pipe(Layer.provide(isolatedDatabaseLayer("independent_events")));
			const planner = Layer.effect(
				LifecyclePlanner,
				Effect.map(DatabaseSession, (session) =>
					LifecyclePlanner.of(
						withLifecycleBatchPlanning({
							plan: (input) =>
								Effect.gen(function* () {
									const { options, triggers, planned: plans, activeTransaction } = yield* current;
									expect(activeTransaction).toBe(true);
									expect(yield* (yield* DatabaseSession).isTransactionActive).toBe(true);
									const trigger = input.trigger;
									expect(trigger.kind.category).toBe("change");
									const existing = triggers.find(({ id }) => id === trigger.id);
									if (existing) {
										if (!Bun.deepEquals(existing, trigger)) {
											return yield* new DbError({
												message: "Automation trigger identity conflict",
											});
										}
										yield* record("plan:change");
										const replayed = plans.get(trigger.id);
										return replayed
											? { ...replayed, wasCreated: false }
											: { runs: [], trigger: existing, wasCreated: false };
									}
									if (options.failChange) {
										return yield* new DbError({ message: "planning failed" });
									}
									const blocked =
										options.blocked &&
										rated(options.blockedRatings, true, [triggerRating(trigger)]);
									const afterHook = rated(options.afterHookRatings, false, [
										triggerRating(trigger),
									]);
									if (options.noHooks && !blocked && !afterHook) {
										yield* record("plan:change");
										return noHooksFixture();
									}
									yield* update(({ calls, triggers: planned }) => ({
										triggers: [...planned, trigger],
										calls: [...calls, "plan:change"],
									}));
									if (blocked) {
										return yield* remember({
											runs: [],
											wasCreated: true,
											trigger: {
												...trigger,
												blockedReason: {
													code: "automation-limit-reached" as const,
													omittedHooks: [
														{
															pluginId: PluginId.make("plugin"),
															hookSlug: AutomationHookSlug.make("hook"),
														},
													],
												},
											},
										});
									}
									return yield* remember({
										trigger,
										wasCreated: true,
										runs: afterHook ? [yield* hookRun(trigger, "after")] : [],
									});
								}).pipe(Effect.provideService(DatabaseSession, session)),
						}),
					),
				),
			);
			const execution = withLifecycleDispatch({
				after: () =>
					Effect.gen(function* () {
						expect((yield* current).activeTransaction).toBe(false);
						yield* record("after");
					}),
			});
			const policies = LifecyclePolicies.of({
				match: (request) =>
					Effect.gen(function* () {
						const { options, activeTransaction } = yield* current;
						expect(activeTransaction).toBe(true);
						yield* update(({ calls, requests }) => ({
							calls: [...calls, "match"],
							requests: [...requests, request],
						}));
						return rated(
							options.policyRatings,
							true,
							request.items.map((item) => requestRating(item.request)),
						)
							? (options.policies ?? []).map(harnessPolicy)
							: [];
					}),
				run: ({ policy, request: { items } }) =>
					Effect.gen(function* () {
						const { options, activeTransaction } = yield* current;
						expect(activeTransaction).toBe(false);
						const identity = `${policy.pluginId}/${policy.hook.slug}`;
						const oncePerSubject = policy.hook.batchFrequency === "once-per-subject";
						const seenEntityIds = new Set<EntityId>();
						const decided: Array<{ itemIdentity: string; decision: AutomationPolicyOutput }> = [];
						yield* record("batch-policy");
						for (const { request, itemIdentity } of items) {
							if (!rated(options.policyRatings, true, [requestRating(request)])) {
								continue;
							}
							assert(request.resource === "event" && request.operation === "create");
							if (oncePerSubject && seenEntityIds.has(request.draft.entityId)) {
								continue;
							}
							seenEntityIds.add(request.draft.entityId);
							const snapshot = yield* current;
							yield* update(({ calls, inputs, executed }) => ({
								calls: [...calls, "policy"],
								inputs: [...inputs, request],
								executed: [...executed, identity],
							}));
							const decision = yield* options.execute?.({
								payload: request,
								index: snapshot.executed.length,
							}) ?? Effect.succeed({ action: "allow" as const });
							const changedEntityId = options.changeEntityMetadataDuringPolicy;
							if (changedEntityId !== undefined) {
								yield* update(({ changedEntityMetadata }) => ({
									changedEntityMetadata: new Set([...changedEntityMetadata, changedEntityId]),
								}));
							}
							decided.push({ decision, itemIdentity });
						}
						return { items: decided };
					}),
			});
			return Layer.mergeAll(
				database,
				planner.pipe(Layer.provide(database)),
				Layer.effect(
					DomainWriteChecks,
					Effect.gen(function* () {
						const live = yield* DomainWriteChecks;
						return DomainWriteChecks.of({
							...live,
							check: (writeCommand, owner, scopeUserId, lock) =>
								Effect.gen(function* () {
									const label = owner.kind === "plugin" ? owner.pluginId : "kernel";
									yield* update(({ checkedOwners }) => ({
										checkedOwners: [...checkedOwners, label],
									}));
									if (label === foreignPluginId) {
										return yield* new DomainWriteConflict({
											message: "Domain write belongs to another definition owner",
											reason: {
												actual: owner,
												code: "owner-mismatch",
												expected: { kind: "kernel" },
											},
										});
									}
									return yield* live.check(writeCommand, owner, scopeUserId, lock);
								}),
						});
					}),
				).pipe(Layer.provide(DomainWriteChecksLive.pipe(Layer.provide(database)))),
				Layer.succeed(LifecycleExecution, execution),
				Layer.succeed(LifecyclePolicies, policies),
				Layer.mock(EntitiesRepository)({
					lockEntityReferencesByIds: recordEntityLocks,
					getByIdForUser: ({ entityId: requestedId }) =>
						read((snapshot) => visibleEntity(snapshot, requestedId)),
					getByIdsForUser: ({ entityIds }) =>
						read(
							(snapshot) =>
								new Map(
									entityIds.flatMap((requestedId) => {
										const entity = visibleEntity(snapshot, requestedId);
										return entity ? [[requestedId, entity] as const] : [];
									}),
								),
						),
					getEntityScopeForUser: ({ entityId: requestedId }) =>
						read((snapshot) => {
							const entity = visibleEntity(snapshot, requestedId);
							return entity
								? {
										entitySchemaSlug,
										isBuiltin: false,
										entityName: "Record",
										entityUserId: userId,
										entityId: requestedId,
										propertiesSchema: { fields: {} },
										entitySchemaPluginId: entity.entitySchemaPluginId,
									}
								: null;
						}),
					getMutationEntities: (entityIds, lock) =>
						Effect.gen(function* () {
							const ids = [...new Set(entityIds)].sort();
							if (lock) {
								yield* recordEntityLocks(ids);
							}
							return yield* read(
								(snapshot) =>
									new Map(
										ids.flatMap((requestedId) => {
											const entity = visibleEntity(snapshot, requestedId);
											return entity ? [[requestedId, { entity, userId }] as const] : [];
										}),
									),
							);
						}),
				}),
				Layer.mock(EventSchemaReader)({
					getScopeForUser: () =>
						read(({ schemaDisabled, schemaActivated }) =>
							eventSchemaScope(schemaDisabled, schemaActivated),
						),
					lockCatalog: () =>
						update(({ options, requests }) => ({
							schemaActivated: (options.activateSchemaBeforeWrite ?? false) && requests.length > 0,
						})),
					getScopesForUser: (_userId, inputs) =>
						read(({ schemaDisabled, schemaActivated }) =>
							inputs.map(() => eventSchemaScope(schemaDisabled, schemaActivated)),
						),
				}),
				Layer.effect(
					EventsRepository,
					Effect.gen(function* () {
						const live = yield* EventsRepository.make.pipe(
							Effect.provideServiceEffect(DefinitionCatalog, DefinitionCatalog.make),
						);
						return EventsRepository.of({
							...live,
							getEventSnapshot: fakeEventSnapshot,
							createEvent: (_transaction, input) => fakeCreateEvent(input),
							createEvents: (_transaction, inputs) => Effect.forEach(inputs, fakeCreateEvent),
							lockEventRows: ({ eventIds }) =>
								eventIds.length === 0
									? Effect.succeed([])
									: Effect.succeed(eventIds.map((id) => ({ id }))),
							getEventSnapshots: (_userId, eventIds) =>
								Effect.map(
									Effect.forEach(eventIds, (eventId) => fakeEventSnapshot({ eventId })),
									(snapshots) =>
										new Map(
											snapshots.flatMap((snapshot, index) => {
												const eventId = eventIds[index];
												return snapshot && eventId ? [[eventId, snapshot] as const] : [];
											}),
										),
								),
							lockMutationReferences: (input) =>
								Effect.gen(function* () {
									expect(input.eventIds).toEqual([]);
									yield* live.lockMutationReferences(input);
									yield* recordEntityLocks(
										[
											...new Set(
												(input.sources ?? []).flatMap((source) =>
													source.sessionEntityId
														? [
																EntityId.make(source.entityId),
																EntityId.make(source.sessionEntityId),
															]
														: [EntityId.make(source.entityId)],
												),
											),
										].sort(),
									);
								}),
						});
					}),
				).pipe(Layer.provide(database)),
				Layer.succeed(IndependentEventsHarness, {
					calls: read(({ calls }) => calls),
					inputs: read(({ inputs }) => inputs),
					created: read(({ created }) => created),
					triggers: read(({ triggers }) => triggers),
					requests: read(({ requests }) => requests),
					executed: read(({ executed }) => executed),
					checkedOwners: read(({ checkedOwners }) => checkedOwners),
					reset: (options) => Ref.set(state, initialState(options)),
					lockedEntityIds: read(({ lockedEntityIds }) => lockedEntityIds),
				}),
			);
		}),
	);

const run = (input = payload, folds = unfoldedFolds) =>
	createEvents(input).pipe(Effect.provideServiceEffect(ChangeSets, eventChangeSets(folds)));

/** Folds that record each commit's queue mode and each fold's lane, queuing one subject per commit. */
const recordingFolds = (calls: Array<string>) =>
	Folds.of({
		...unfoldedFolds,
		fold: (input) =>
			Effect.sync(() => {
				calls.push(`fold ${input.lane}`);
				return true;
			}),
		queue: (_transaction, eager) =>
			Effect.sync(() => {
				calls.push(eager ? "queue eagerly" : "queue");
				return [{ userId, entityId }];
			}),
	});

layer(harnessLayer({ afterHookRatings: [1], policies: [{ position: 1, slug: "policy" }] }))(
	"independent events",
	(test) => {
		test.effect(
			"plans an event batch before source writes and dispatches after hooks after commit",
			() =>
				Effect.gen(function* () {
					const h = yield* IndependentEventsHarness;
					const result = yield* run();
					expect(result).toMatchObject({ count: 1, failure: null });
					const calls = yield* h.calls;
					const policyIndex = calls.indexOf("batch-policy");
					const firstWriteIndex = calls.indexOf("write");
					const lastWriteIndex = calls.lastIndexOf("write");
					const afterIndex = calls.indexOf("after");
					expect(policyIndex).toBeGreaterThanOrEqual(0);
					expect(policyIndex).toBeLessThan(firstWriteIndex);
					expect(calls.filter((call) => call === "write")).toHaveLength(1);
					expect(lastWriteIndex).toBeLessThan(afterIndex);
					expect(calls.slice(lastWriteIndex + 1, afterIndex)).toContain("commit");
					expect(yield* h.executed).toEqual(["plugin/policy"]);
					const [request] = yield* h.requests;
					assert(request);
					expect(request.resource).toBe("event");
					expect(
						request.items.every(
							({ request: item }) => item.resource === "event" && item.operation === "create",
						),
					).toBe(true);
					const changeTrigger = (yield* h.triggers).find(({ kind }) => kind.category === "change");
					assert(changeTrigger);
					expect(changeTrigger.causation.parentTriggerId).toBeNull();
					expect(changeTrigger.payload).toMatchObject({
						after: {
							entityId,
							createdAt: now,
							updatedAt: now,
							eventSchemaSlug,
							occurredAt: now,
							entitySchemaSlug,
							sessionEntityId: null,
							properties: { rating: 1 },
						},
					});
				}),
			testTimeout,
		);
	},
);

layer(
	harnessLayer({
		policies: [
			{ slug: "z", plugin: "b", position: 2 },
			{ slug: "z", plugin: "a", position: 2 },
			{ slug: "a", plugin: "a", position: 2 },
			{ slug: "last", position: 10 },
		],
		execute: ({ index, payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			expect(request.draft.properties["rating"]).toBe(index + 1);
			return Effect.succeed({
				action: "transform",
				patch: {
					resource: "event",
					draft: {
						sessionEntityId: EntityId.make("session"),
						properties: { remove: [], set: { rating: index + 2 } },
					},
				},
			});
		},
	}),
)("independent events", (test) => {
	test.effect(
		"chains transforms in matched order and preserves trusted draft fields",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				yield* run();
				expect(yield* h.executed).toEqual(["b/z", "a/z", "a/a", "plugin/last"]);
				const created = yield* h.created;
				expect(created[0]).toMatchObject({
					entityId,
					eventSchemaSlug,
					properties: { rating: 5 },
					sessionEntityId: "session",
				});
				expect(created[0]?.occurredAt.toISOString()).toBe(now);
				expect(
					(yield* h.inputs).every(
						(input) =>
							input.resource === "event" &&
							input.draft.entityId === entityId &&
							input.draft.entitySchemaSlug === entitySchemaSlug,
					),
				).toBe(true);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		policies: [
			{ position: 1, slug: "first" },
			{ position: 2, slug: "second" },
		],
		execute: () => Effect.succeed({ action: "reject", reason: { key: "rejection.declined" } }),
	}),
)("independent events", (test) => {
	test.effect(
		"rejection closes remaining policies and creates no domain row or change trigger",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				expect(yield* run()).toEqual({
					count: 0,
					failure: null,
					outcomes: [
						{
							index: 0,
							status: "skipped_by_policy",
							reason: { namespace: "plugin", key: "rejection.declined" },
						},
					],
				});
				expect(yield* h.inputs).toHaveLength(1);
				expect(yield* h.created).toEqual([]);
				expect(yield* h.triggers).toEqual([]);
				expect(yield* h.requests).toHaveLength(1);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		execute: () => new AutomationPolicyExecutionError({ kind: "script-failure" }),
		policies: [
			{ position: 1, slug: "fail" },
			{ position: 2, slug: "later" },
		],
	}),
)("independent events", (test) => {
	test.effect(
		"fails the selected batch when its policy fails",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const result = yield* run();
				expect(result).toMatchObject({ count: 0, outcomes: [{ index: 0, status: "failed" }] });
				expect(result.failure).toEqual({ index: 0, reason: { code: "policy-execution-failed" } });
				expect(yield* h.created).toEqual([]);
				expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(1);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		policies: [{ position: 1, slug: "invalid" }],
		execute: ({ payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return request.draft.properties["rating"] === 2
				? Effect.succeed({
						action: "transform",
						patch: {
							resource: "event",
							draft: { properties: { remove: [], set: { rating: "invalid" } } },
						},
					})
				: Effect.succeed({ action: "allow" as const });
		},
	}),
)("independent events", (test) => {
	test.effect(
		"keeps valid events when one transformed draft fails validation",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const result = yield* run({ ...payload, payload: ratedItems([1, 2, 3]) });
				expect(result).toMatchObject({
					count: 2,
					failure: { index: 1, reason: { code: "invalid-properties" } },
				});
				expect(result.outcomes.map(({ index, status }) => [index, status])).toEqual([
					[0, "written"],
					[1, "failed"],
					[2, "written"],
				]);
				expect((yield* h.created).map(({ properties }) => properties["rating"])).toEqual([1, 3]);
				expect(yield* h.inputs).toHaveLength(3);
				expect(yield* h.executed).toHaveLength(3);
				expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(1);
			}),
		testTimeout,
	);
});

const hiddenSession = EntityId.make("hidden-session");

layer(harnessLayer({ noHooks: true, unreadableEntity: hiddenSession }))(
	"independent events",
	(test) => {
		test.effect(
			"reports an initially unreadable session reference at its item index",
			() =>
				Effect.gen(function* () {
					const h = yield* IndependentEventsHarness;
					const item = payload.payload[0];
					assert(item);
					const result = yield* run({
						...payload,
						payload: [{ ...item, sessionEntityId: hiddenSession }],
					});
					expect(result.failure).toEqual({
						index: 0,
						reason: { entityId: hiddenSession, code: "session-entity-not-found" },
					});
					expect(result.outcomes).toEqual([
						{
							index: 0,
							status: "failed",
							reason: { entityId: hiddenSession, code: "session-entity-not-found" },
						},
					]);
					expect(yield* h.created).toEqual([]);
				}),
			testTimeout,
		);
	},
);

layer(
	harnessLayer({
		unreadableEntity: hiddenSession,
		policies: [{ position: 1, slug: "session" }],
		execute: ({ payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				patch: { resource: "event", draft: { sessionEntityId: hiddenSession } },
			});
		},
	}),
)("independent events", (test) => {
	test.effect(
		"revalidates a transformed session reference before writing",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				expect((yield* run()).failure).toEqual({
					index: 0,
					reason: { entityId: hiddenSession, code: "session-entity-not-found" },
				});
				expect(yield* h.created).toEqual([]);
				expect(yield* h.triggers).toEqual([]);
				expect(yield* h.requests).toHaveLength(1);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		policies: [{ position: 1, slug: "session" }],
		execute: ({ payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				patch: { resource: "event", draft: { sessionEntityId: EntityId.make("   ") } },
			});
		},
	}),
)("independent events", (test) => {
	test.effect(
		"normalizes an empty transformed session reference before writing",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				expect(yield* run()).toMatchObject({ count: 1, failure: null });
				expect((yield* h.created)[0]?.sessionEntityId).toBeUndefined();
				expect(yield* h.lockedEntityIds).toEqual([
					[entityId],
					[entityId],
					[entityId],
					[entityId],
					[entityId],
					[entityId],
				]);
			}),
		testTimeout,
	);
});

const racingSession = EntityId.make("racing-session");

layer(
	harnessLayer({
		revokeEntityBeforeWrite: racingSession,
		policies: [{ position: 1, slug: "session" }],
		execute: ({ payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				patch: { resource: "event", draft: { sessionEntityId: racingSession } },
			});
		},
	}),
)("independent events", (test) => {
	test.effect(
		"locks and revalidates the transformed session reference in the write transaction",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				expect((yield* run()).failure).toEqual({ index: 0, reason: { code: "mutation-conflict" } });
				expect(yield* h.lockedEntityIds).toEqual([
					[entityId],
					[entityId],
					[racingSession, entityId],
					[racingSession, entityId],
					[racingSession, entityId],
					[racingSession, entityId],
				]);
				expect(yield* h.created).toEqual([]);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		changeEntityMetadataDuringPolicy: entityId,
		policies: [{ position: 1, slug: "metadata" }],
	}),
)("independent events", (test) => {
	test.effect(
		"reports a mutation conflict when an original reference changes during policy",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				expect((yield* run()).failure).toEqual({ index: 0, reason: { code: "mutation-conflict" } });
				expect(yield* h.executed).toEqual(["plugin/metadata"]);
				expect(yield* h.lockedEntityIds).toEqual([
					[entityId],
					[entityId],
					[entityId],
					[entityId],
					[entityId],
					[entityId],
				]);
				expect(yield* h.created).toEqual([]);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		policies: [{ position: 1, slug: "policy" }],
		execute: ({ payload: request }) =>
			request.draft.properties["rating"] === 2
				? new AutomationPolicyExecutionError({ kind: "script-failure" })
				: Effect.succeed({ action: "allow" as const }),
	}),
)("independent events", (test) => {
	test.effect(
		"fails the entire selected batch when a policy run fails",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const result = yield* run({ ...payload, payload: ratedItems([1, 2, 3]) });
				expect(result).toMatchObject({ count: 0 });
				expect(result.failure).toEqual({ index: 0, reason: { code: "policy-execution-failed" } });
				expect(result.outcomes.map(({ index, status }) => [index, status])).toEqual([
					[0, "failed"],
					[1, "failed"],
					[2, "failed"],
				]);
				expect(yield* h.created).toEqual([]);
				expect(yield* h.inputs).toHaveLength(2);
				expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(1);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		policies: [
			{ position: 1, slug: "first" },
			{ position: 2, slug: "repair" },
		],
		execute: ({ index, payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				patch: {
					resource: "event",
					draft: {
						properties: { remove: [], set: { rating: index === 0 ? "intermediate" : 1.2345 } },
					},
				},
			});
		},
	}),
)("independent events", (test) => {
	test.effect(
		"rejects an invalid intermediate patch before running the next policy",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				expect((yield* run()).failure).toEqual({
					index: 0,
					reason: { code: "invalid-properties" },
				});
				expect(yield* h.executed).toHaveLength(1);
				expect(yield* h.created).toEqual([]);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		policies: [
			{ position: 1, slug: "reject-once", frequency: "once-per-subject" },
			{ position: 2, slug: "later", frequency: "once-per-subject" },
		],
		execute: ({ index }) =>
			Effect.succeed(
				index === 0
					? { action: "reject" as const, reason: { key: "rejection.first-only" } }
					: { action: "allow" as const },
			),
	}),
)("independent events", (test) => {
	test.effect(
		"consumes a rejecting subject policy on the first eligible item, but keeps later unstarted policies eligible",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const result = yield* run({
					...payload,
					payload: [...payload.payload, ...payload.payload, ...payload.payload],
				});
				expect(result.count).toBe(2);
				expect(yield* h.executed).toEqual(["plugin/reject-once", "plugin/later"]);
				expect(yield* h.inputs).toHaveLength(2);
				expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(2);
				expect(result.outcomes.map(({ index, status }) => [index, status])).toEqual([
					[0, "skipped_by_policy"],
					[1, "written"],
					[2, "written"],
				]);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		policies: [
			{ position: 1, slug: "subject", frequency: "once-per-subject" },
			{ position: 2, slug: "item" },
		],
	}),
)("independent events", (test) => {
	test.effect(
		"batches once-per-subject policies by subject and regular policies by item",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const [item] = payload.payload;
				assert(item);
				const result = yield* run({
					...payload,
					payload: [item, item, { ...item, entityId: EntityId.make("other") }],
				});
				expect(result.count).toBe(3);
				expect(yield* h.executed).toEqual([
					"plugin/subject",
					"plugin/subject",
					"plugin/item",
					"plugin/item",
					"plugin/item",
				]);
				expect(yield* h.inputs).toHaveLength(5);
				expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(2);
				expect(result.outcomes.map(({ status }) => status)).toEqual([
					"written",
					"written",
					"written",
				]);
			}),
		testTimeout,
	);
});

layer(harnessLayer({ failChange: true }))("independent events", (test) => {
	test.effect(
		"writes nothing and dispatches no hooks when change planning fails",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				assertExitFails(yield* Effect.exit(run()), new DbError({ message: "planning failed" }));
				expect(yield* h.created).toEqual([]);
				expect(yield* h.triggers).toEqual([]);
				expect(yield* h.calls).not.toContain("after");
			}),
		testTimeout,
	);
});

layer(harnessLayer({ activateSchemaBeforeWrite: true }))("independent events", (test) => {
	test.effect(
		"reports a mutation conflict when the event schema changes after preparation",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const result = yield* run();
				expect(result.failure).toEqual({ index: 0, reason: { code: "mutation-conflict" } });
				expect(yield* h.created).toEqual([]);
				expect(yield* h.calls).not.toContain("after");
			}),
		testTimeout,
	);
});

const ratedItems = (ratings: ReadonlyArray<number>, entities: Record<number, EntityId> = {}) =>
	ratings.map((rating, index) => ({
		eventSchemaSlug,
		properties: { rating },
		entityId: entities[index] ?? entityId,
	}));
const hiddenSubject = EntityId.make("hidden-subject");

layer(harnessLayer({ noHooks: true, unreadableEntity: hiddenSubject }))(
	"independent events",
	(test) => {
		test.effect(
			"writes valid items and records an invalid item at its index",
			() =>
				Effect.gen(function* () {
					const h = yield* IndependentEventsHarness;
					const result = yield* run({
						...payload,
						payload: ratedItems(
							Array.from({ length: 52 }, (_, index) => index),
							{ 51: hiddenSubject },
						),
					});
					expect(result).toMatchObject({
						count: 51,
						failure: { index: 51, reason: { entityId: hiddenSubject, code: "entity-not-found" } },
					});
					expect(result.outcomes.map(({ index }) => index)).toEqual(
						Array.from({ length: 52 }, (_, index) => index),
					);
					expect(
						result.outcomes.filter(({ status }) => status === "failed").map(({ index }) => index),
					).toEqual([51]);
					expect(yield* h.created).toHaveLength(51);
					expect(yield* h.calls).not.toContain("rollback");
				}),
			testTimeout,
		);
	},
);

layer(harnessLayer({ noHooks: true, afterHookRatings: [2] }))("independent events", (test) => {
	test.effect(
		"commits all items in one chunk before dispatching after hooks",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const result = yield* run({ ...payload, payload: ratedItems([1, 2, 3]) });
				expect(result).toMatchObject({ count: 3, failure: null });
				const calls = yield* h.calls;
				const lastWriteIndex = calls.lastIndexOf("write");
				const commitIndex = calls.findIndex(
					(call, index) => call === "commit" && index > lastWriteIndex,
				);
				const afterIndex = calls.indexOf("after");
				expect(yield* h.created).toHaveLength(3);
				expect(yield* h.executed).toEqual([]);
				expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(0);
				expect(lastWriteIndex).toBeGreaterThanOrEqual(0);
				expect(commitIndex).toBeGreaterThan(lastWriteIndex);
				expect(afterIndex).toBeGreaterThan(commitIndex);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		noHooks: true,
		policyRatings: [2],
		unreadableEntity: hiddenSubject,
		policies: [{ position: 1, slug: "policy" }],
	}),
)("independent events", (test) => {
	test.effect(
		"writes valid items around an unreadable item in the same chunk",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const result = yield* run({
					...payload,
					payload: ratedItems([1, 2, 3], { 2: hiddenSubject }),
				});
				expect(result).toMatchObject({
					count: 2,
					failure: { index: 2, reason: { entityId: hiddenSubject, code: "entity-not-found" } },
				});
				expect(result.outcomes.map(({ index, status }) => [index, status])).toEqual([
					[0, "written"],
					[1, "written"],
					[2, "failed"],
				]);
				expect(yield* h.executed).toEqual(["plugin/policy"]);
				expect(yield* h.created).toHaveLength(2);
				expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(1);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		noHooks: true,
		policyRatings: [1, 3],
		policies: [{ position: 1, slug: "subject", frequency: "once-per-subject" }],
	}),
)("independent events", (test) => {
	test.effect(
		"deduplicates once-per-subject policy execution within a batch",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const result = yield* run({ ...payload, payload: ratedItems([1, 2, 3]) });
				expect(result.count).toBe(3);
				expect(result.outcomes.map(({ status }) => status)).toEqual([
					"written",
					"written",
					"written",
				]);
				expect(yield* h.executed).toEqual(["plugin/subject"]);
				expect(yield* h.inputs).toHaveLength(1);
				expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(1);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		noHooks: true,
		policies: [{ position: 1, slug: "subject", frequency: "once-per-subject" }],
	}),
)("independent events", (test) => {
	test.effect(
		"runs a once-per-subject policy once per subject across policy chunks",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const subjects = Array.from({ length: 50 }, (_, index) =>
					EntityId.make(`chunk-subject-${index}`),
				);
				const [firstSubject] = subjects;
				const [template] = payload.payload;
				assert(firstSubject);
				assert(template);
				const result = yield* run({
					...payload,
					payload: [
						...subjects.map((subject) => Object.assign({}, template, { entityId: subject })),
						{ ...template, entityId: firstSubject },
					],
				});
				expect(result.count).toBe(51);
				expect(result.outcomes).toHaveLength(51);
				expect(yield* h.executed).toHaveLength(50);
				expect(yield* h.inputs).toHaveLength(50);
				expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(2);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		noHooks: true,
		policies: [{ position: 1, slug: "subject", frequency: "once-per-subject" }],
	}),
)("independent events", (test) => {
	test.effect(
		"keeps a subject with more than 50 items in one policy chunk",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const [template] = payload.payload;
				assert(template);
				const result = yield* run({
					...payload,
					payload: [
						...Array.from({ length: 51 }, () =>
							Object.assign({}, template, { entityId: EntityId.make("large-subject") }),
						),
						{ ...template, entityId: EntityId.make("small-subject") },
					],
				});
				expect(result.outcomes).toHaveLength(52);
				expect(yield* h.executed).toHaveLength(2);
				expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(2);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		policies: [
			{ position: 1, slug: "first" },
			{ position: 2, slug: "second" },
		],
	}),
)("independent events", (test) => {
	test.effect(
		"calls each policy once per commit with every item of the batch",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const result = yield* run({ ...payload, payload: ratedItems([1, 2, 3]) });
				expect(result).toMatchObject({ count: 3, failure: null });
				expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(2);
				expect(yield* h.executed).toEqual([
					"plugin/first",
					"plugin/first",
					"plugin/first",
					"plugin/second",
					"plugin/second",
					"plugin/second",
				]);
				expect(yield* h.created).toHaveLength(3);
			}),
		testTimeout,
	);
});

const otherUsersSubject = EntityId.make("other-users-subject");

layer(harnessLayer({ noHooks: true, unreadableEntity: otherUsersSubject }))(
	"independent events",
	(test) => {
		test.effect(
			"reports another user's entity and writes valid items from the chunk",
			() =>
				Effect.gen(function* () {
					const h = yield* IndependentEventsHarness;
					const result = yield* run({
						...payload,
						payload: ratedItems([1, 2], { 1: otherUsersSubject }),
					});
					expect(result).toMatchObject({
						count: 1,
						failure: {
							index: 1,
							reason: { code: "entity-not-found", entityId: otherUsersSubject },
						},
					});
					expect(result.outcomes.map(({ index, status }) => [index, status])).toEqual([
						[0, "written"],
						[1, "failed"],
					]);
					expect(yield* h.created).toHaveLength(1);
				}),
			testTimeout,
		);
	},
);

const foreignSubject = EntityId.make("foreign-subject");

layer(harnessLayer({ noHooks: true, foreignEntity: foreignSubject }))(
	"independent events",
	(test) => {
		test.effect(
			"writes valid items and reports each foreign entity at its index",
			() =>
				Effect.gen(function* () {
					const h = yield* IndependentEventsHarness;
					const result = yield* run({
						...payload,
						payload: ratedItems([1, 2, 3], { 1: foreignSubject, 2: foreignSubject }),
					});
					expect(result).toMatchObject({
						count: 1,
						failure: { index: 1, reason: { entityId: foreignSubject, code: "entity-not-found" } },
					});
					expect(result.outcomes.map(({ index, status }) => [index, status])).toEqual([
						[0, "written"],
						[1, "failed"],
						[2, "failed"],
					]);
					expect(yield* h.checkedOwners).toContain(foreignPluginId);
					expect(yield* h.created).toHaveLength(1);
				}),
			testTimeout,
		);
	},
);

const revokedPrincipal = Schema.decodeEffect(ScriptExecutionPrincipal)({
	providerId: null,
	contentHash: "hash",
	scriptSlug: "script",
	scriptId: "revoked-script",
	metadata: { kind: "automation", runtimeImports: [] },
	pluginRevision: {
		scope: "user",
		ownerId: userId,
		workflowScripts: {},
		id: "revoked-plugin",
		userBootstrapScriptSlugs: [],
		revisionId: "revoked-revision",
		configRevisionId: "revoked-config",
		packageId: PluginPackageId.make("test/revoked"),
		scriptsDigest: scriptsDigestOf({ script: "hash" }),
		configSchema: { fields: {}, unknownKeys: "strict" },
	},
	subject: {
		runId: "run",
		stage: "after",
		triggerId: "trigger",
		accountUserId: userId,
		type: "automation-run",
		executionUserId: userId,
		pluginId: "revoked-plugin",
		pluginRevisionId: "revoked-revision",
		pluginConfigRevisionId: "revoked-config",
		causation: {
			depth: 0,
			source: "api",
			parentRunId: null,
			lane: "interactive",
			parentTriggerId: null,
			executionId: "execution",
			rootExecutionId: "execution",
			initiator: { id: null, kind: "system" },
		},
	},
}).pipe(Effect.orDie);

layer(harnessLayer({ noHooks: true }))("independent event folds", (test) => {
	test.effect(
		"queues a background write's folds and folds an interactive write's after its commit",
		() =>
			Effect.gen(function* () {
				const calls: Array<string> = [];
				const folds = recordingFolds(calls);
				const background = {
					...command,
					causation: { ...command.causation, lane: "background" as const },
				};
				yield* run(payload, folds);
				expect(calls).toEqual(["queue eagerly", "fold interactive"]);
				calls.length = 0;
				yield* run({ ...payload, command: background }, folds);
				expect(calls).toEqual(["queue"]);
			}),
	);
});

layer(harnessLayer({ noHooks: true }))("independent events", (test) => {
	test.effect(
		"fails the batch with the principal-owner check error of a revoked plugin",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				assertExitFails(
					yield* Effect.exit(
						run({
							...payload,
							payload: ratedItems([1, 2]),
							command: { ...command, writeContext: yield* revokedPrincipal },
						}),
					),
					new DbError({ message: "Pinned domain write authority is unavailable" }),
				);
				expect(yield* h.created).toEqual([]);
			}),
		testTimeout,
	);
});

layer(Layer.provideMerge(harnessLayer({ noHooks: true }), BunCrypto.layerSecureRandom))(
	"independent events",
	(test) => {
		test.effect(
			"fails an event-create item that references another user's managed asset",
			() =>
				Effect.gen(function* () {
					const h = yield* IndependentEventsHarness;
					const foreign = yield* insertManagedAsset(UserId.make("event-create-asset-foreign"));
					const result = yield* run({
						...payload,
						payload: [{ entityId, eventSchemaSlug, properties: { rating: 1, image: foreign } }],
					});
					expect(result).toMatchObject({
						count: 0,
						failure: { index: 0, reason: { code: "asset-forbidden" } },
					});
					expect(yield* h.created).toEqual([]);
				}),
			testTimeout,
		);
	},
);

const eventIdOf = (position: number, itemIdentity: string) =>
	EventId.make(
		`event_${position.toString(36).padStart(4, "0")}_${sha256Base64Url(stableStringify(["batch", itemIdentity]))}`,
	);

const keyed = (key: string, input = payload) =>
	Effect.flatMap(ChangeSets, (changes) =>
		changes.commitEventsKeyed(eventCreateChanges(input.userId, input.payload), input.command, key, {
			events: { independent: true },
		}),
	).pipe(Effect.provideServiceEffect(ChangeSets, eventChangeSets()));

layer(harnessLayer({ noHooks: true }))("independent event identities", (test) => {
	test.effect(
		"derives each event ID and import item key from its operation identity",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const importRunId = ImportRunId.make("identity-run");
				yield* (yield* DatabaseSession).run((db) =>
					db.insert(importRun).values({ userId, id: importRunId, source: "fixture" }),
				);
				const identities = ["import:first", "import:second"];
				yield* run({
					...payload,
					itemIdentities: identities,
					payload: ratedItems([1, 2]),
					command: { ...command, causation: { ...command.causation, importRunId } },
				});
				yield* run({ ...payload, payload: ratedItems([3]) });
				expect((yield* h.created).map(({ id }) => id)).toEqual([
					eventIdOf(0, "import:first"),
					eventIdOf(1, "import:second"),
					eventIdOf(0, "events:event:0"),
				]);
				const items = yield* (yield* IdempotencyKeys.make).importItems({
					userId,
					runId: importRunId,
					itemIdentities: identities,
				});
				expect(sortBy(items, ({ itemIdentity }) => itemIdentity)).toEqual([
					{ result: "created", itemIdentity: "import:first" },
					{ result: "created", itemIdentity: "import:second" },
				]);
			}),
		testTimeout,
	);
});

layer(harnessLayer({ noHooks: true }))("independent event receipts", (test) => {
	test.effect(
		"replays a keyed commit's result without writing again, even under a new execution",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const first = yield* keyed("entry-event-job");
				const replay = yield* keyed("entry-event-job", {
					...payload,
					command: {
						...command,
						causation: { ...command.causation, executionId: AutomationExecutionId.make("retry") },
					},
				});
				expect(first).toMatchObject({ count: 1, failure: null });
				expect(replay).toEqual(first);
				expect(yield* h.created).toHaveLength(1);
			}),
		testTimeout,
	);
});

layer(
	harnessLayer({
		policies: [{ position: 1, slug: "fail" }],
		execute: () => new AutomationPolicyExecutionError({ kind: "script-failure" }),
	}),
)("independent event receipts", (test) => {
	test.effect(
		"records a rejected keyed commit and replays it without running policies again",
		() =>
			Effect.gen(function* () {
				const h = yield* IndependentEventsHarness;
				const first = yield* keyed("rejected-item");
				const replay = yield* keyed("rejected-item");
				expect(first).toMatchObject({
					count: 0,
					failure: { index: 0, reason: { code: "policy-execution-failed" } },
				});
				expect(replay).toEqual(first);
				expect(yield* h.executed).toEqual(["plugin/fail"]);
				expect(yield* h.created).toEqual([]);
			}),
		testTimeout,
	);
});

layer(harnessLayer({ policies: [{ position: 1, slug: "policy" }] }))(
	"independent event folds",
	(test) => {
		test.effect("folds both transactions of a policy-matched commit by its lane", () =>
			Effect.gen(function* () {
				const calls: Array<string> = [];
				const folds = recordingFolds(calls);
				yield* run(
					{
						...payload,
						command: {
							...command,
							causation: {
								...command.causation,
								lane: "background",
								executionId: AutomationExecutionId.make("background"),
							},
						},
					},
					folds,
				);
				expect(calls).toEqual(["queue", "queue"]);
				calls.length = 0;
				yield* run(payload, folds);
				expect(calls).toEqual([
					"queue eagerly",
					"fold interactive",
					"queue eagerly",
					"fold interactive",
				]);
			}),
		);
	},
);
