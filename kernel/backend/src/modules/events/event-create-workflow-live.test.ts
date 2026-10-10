import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationBatchRequestPayload,
	AutomationEventSnapshot,
	type AutomationPolicyOutput,
	type AutomationRequestPayload,
	AutomationRun,
	type AutomationTrigger,
	type AutomationWarning,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { EventCreateItemError } from "@ryot-app/contract/modules/events/schemas";
import {
	AutomationExecutionId,
	AutomationHookSlug,
	AutomationRunId,
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginId,
	PluginPackageId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Context, Effect, Exit, Layer, Ref, Schema, Scope } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import {
	insertManagedAsset,
	managedAssetProperty,
} from "#lib/domain/managed-asset-writes.test-support";
import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#modules/automations/lifecycle/execution";
import {
	type LifecyclePlan,
	type LifecyclePlannedPolicy,
	LifecyclePlanner,
	lifecycleRunId,
} from "#modules/automations/lifecycle/planning";
import {
	PolicyBatchPayload,
	PolicyBatchWorkflow,
	runPolicyBatchWorkflow,
} from "#modules/automations/lifecycle/policy-batch";
import { applyLifecyclePolicyPatches } from "#modules/automations/lifecycle/policy-patch";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	DomainWriteChecks,
	DomainWriteChecksLive,
	DomainWriteConflict,
} from "#modules/entities/write-context";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { makeWorkflowEngine } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { EventCreateWorkflow, type EventCreateWorkflowPayload } from "./event-create-workflow";
import { runEventCreateWorkflow } from "./event-create-workflow-live";
import { EventMutations } from "./mutations";
import { EventsRepository } from "./repository";

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
		itemIdentity: "events",
		initiator: { id: userId, kind: "user" },
		executionId: AutomationExecutionId.make("batch"),
		accountGeneration: { userId, token: "test-account-generation" },
	}),
	writeContext: null,
};
const payload: EventCreateWorkflowPayload = {
	userId,
	command,
	payload: [{ entityId, eventSchemaSlug, properties: { rating: 1 } }],
};
type Policy = {
	slug: string;
	plugin?: string;
	position: number;
	frequency?: LifecyclePlannedPolicy["batchFrequency"];
};

type HarnessOptions = {
	unreadableEntity?: EntityId;
	revokeEntityBeforeWrite?: EntityId;
	changeEntityMetadataDuringPolicy?: EntityId;
	policies?: Policy[];
	execute?: (
		input: Parameters<LifecycleExecution["Service"]["executePolicy"]>[0] & {
			payload: AutomationRequestPayload;
			index: number;
		},
	) => Effect.Effect<AutomationPolicyOutput, AutomationPolicyExecutionError>;
	blocked?: "request" | "change";
	noHooks?: boolean;
	policyRatings?: number[];
	blockedRatings?: number[];
	afterHookRatings?: number[];
	foreignEntity?: EntityId;
	retryActivity?: string;
	warnings?: AutomationWarning[];
	failChange?: boolean;
	activateSchemaBeforeWrite?: boolean;
	replayWriteAfterSchemaDisable?: boolean;
};

type CreatedEvent = Parameters<EventsRepository["Service"]["createEvent"]>[0];
type RecordedActivity = { readonly executionId: string; readonly name: string };

const foreignPluginId = "foreign";

const visibleEntity = (
	{
		options,
		lockedEntityIds,
		changedEntityMetadata,
	}: Pick<HarnessState, "changedEntityMetadata" | "lockedEntityIds" | "options">,
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
				name: "Rating",
				pluginId: null,
				slug: "rating",
				entitySchemaSlug,
				id: eventSchemaSlug,
				propertiesSchema: ratingSchema(schemaActivated),
			};

const triggerRating = (input: AutomationTrigger | AutomationRequestPayload): number | undefined => {
	const source = "payload" in input ? input.payload : input;
	if (source?.category === "request" && source.operation === "batch") {
		const first = source.items[0];
		return first ? triggerRating(first) : undefined;
	}
	if (source?.category === "request") {
		if (source.resource !== "event" || source.operation !== "create") {
			return undefined;
		}
		const rating = source.draft.properties["rating"];
		return typeof rating === "number" ? rating : undefined;
	}
	if (source?.resource !== "event" || source.operation !== "create") {
		return undefined;
	}
	const rating = source.after.properties["rating"];
	return typeof rating === "number" ? rating : undefined;
};

const hookRun = (
	trigger: AutomationTrigger,
	hook: { slug: string; stage: "after" | "before"; plugin?: string | undefined },
) => {
	const pluginId = PluginId.make(hook.plugin ?? "plugin");
	const hookSlug = AutomationHookSlug.make(hook.slug);
	return Schema.decodeUnknownSync(AutomationRun)({
		pluginId,
		hookSlug,
		queuedAt: now,
		attemptCount: 0,
		startedAt: null,
		status: "queued",
		skipReason: null,
		finishedAt: null,
		stage: hook.stage,
		nextAttemptAt: null,
		hookName: hook.slug,
		scriptSlug: "script",
		triggerId: trigger.id,
		artifactsExpireAt: now,
		executionUserId: userId,
		sandboxScriptId: "script",
		scriptContentHash: "hash",
		pluginRevisionId: "revision",
		pluginConfigRevisionId: "config",
		delivery: hook.stage === "before" ? "policy" : "required",
		retryPolicy: hook.stage === "before" ? null : DEFAULT_AUTOMATION_RETRY_POLICY,
		id: lifecycleRunId({ pluginId, hookSlug, triggerId: trigger.id, executionUserId: userId }),
	});
};

type HarnessState = {
	readonly options: HarnessOptions;
	readonly calls: ReadonlyArray<string>;
	readonly triggers: ReadonlyArray<AutomationTrigger>;
	readonly created: ReadonlyArray<CreatedEvent>;
	readonly inputs: ReadonlyArray<AutomationRequestPayload>;
	readonly exclusions: ReadonlyArray<unknown>;
	readonly queued: ReadonlySet<string>;
	readonly identities: ReadonlyMap<string, string>;
	readonly policyRequests: ReadonlyMap<
		string,
		AutomationRequestPayload | AutomationBatchRequestPayload
	>;
	readonly executed: ReadonlyArray<string>;
	readonly activities: ReadonlyArray<RecordedActivity>;
	readonly checkedOwners: ReadonlyArray<string>;
	readonly planned: ReadonlyMap<string, LifecyclePlan>;
	readonly lockedEntityIds: ReadonlyArray<ReadonlyArray<EntityId>>;
	readonly activeTransaction: boolean;
	readonly activeActivity: boolean;
	readonly schemaActivated: boolean;
	readonly schemaDisabled: boolean;
	readonly changedEntityMetadata: ReadonlySet<EntityId>;
};

const initialState = (options: HarnessOptions): HarnessState => ({
	options,
	calls: [],
	inputs: [],
	created: [],
	triggers: [],
	executed: [],
	activities: [],
	exclusions: [],
	checkedOwners: [],
	queued: new Set(),
	planned: new Map(),
	lockedEntityIds: [],
	identities: new Map(),
	activeActivity: false,
	schemaDisabled: false,
	schemaActivated: false,
	activeTransaction: false,
	policyRequests: new Map(),
	changedEntityMetadata: new Set(),
});

class EventCreateHarness extends Context.Service<
	EventCreateHarness,
	{
		readonly calls: Effect.Effect<ReadonlyArray<string>>;
		readonly triggers: Effect.Effect<ReadonlyArray<AutomationTrigger>>;
		readonly created: Effect.Effect<ReadonlyArray<CreatedEvent>>;
		readonly inputs: Effect.Effect<ReadonlyArray<AutomationRequestPayload>>;
		readonly exclusions: Effect.Effect<ReadonlyArray<unknown>>;
		readonly queued: Effect.Effect<ReadonlySet<string>>;
		readonly executed: Effect.Effect<ReadonlyArray<string>>;
		readonly activities: Effect.Effect<ReadonlyArray<RecordedActivity>>;
		readonly checkedOwners: Effect.Effect<ReadonlyArray<string>>;
		readonly lockedEntityIds: Effect.Effect<ReadonlyArray<ReadonlyArray<EntityId>>>;
		readonly reset: (options: HarnessOptions) => Effect.Effect<void>;
	}
>()("test/EventCreateHarness") {}

const harnessLayer = (initialOptions: HarnessOptions = {}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const state = yield* Ref.make(initialState(initialOptions));
			const current = Ref.get(state);
			const read = <A>(select: (snapshot: HarnessState) => A) => Effect.map(current, select);
			const update = (change: (snapshot: HarnessState) => Partial<HarnessState>) =>
				Ref.update(state, (snapshot) => ({ ...snapshot, ...change(snapshot) }));
			const record = (call: string) => update(({ calls }) => ({ calls: [...calls, call] }));
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
							.values({
								id: userId,
								name: "User",
								email: "event-workflow@example.test",
								accountGeneration: "test-account-generation",
							}),
					);
					return DatabaseSession.of({
						...session,
						transaction: (work) =>
							Effect.gen(function* () {
								const before = yield* current;
								expect(before.activeTransaction).toBe(false);
								const saved = { created: before.created.length, triggers: before.triggers.length };
								if (!before.activeActivity) {
									return yield* session.transaction(work).pipe(
										Effect.tap(() =>
											Effect.gen(function* () {
												const after = yield* current;
												expect(after.created).toHaveLength(saved.created);
												expect(after.triggers).toHaveLength(saved.triggers);
											}),
										),
									);
								}
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
			).pipe(Layer.provide(isolatedDatabaseLayer("event_create_workflow")));
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
									const existing = triggers.find(({ id }) => id === trigger.id);
									if (existing) {
										if (!Bun.deepEquals(existing, trigger)) {
											return yield* new DbError({
												message: "Automation trigger identity conflict",
											});
										}
										yield* record(`plan:${trigger.kind.category}`);
										const replayed = plans.get(trigger.id);
										return replayed
											? { ...replayed, wasCreated: false }
											: { runs: [], policies: [], trigger: existing, wasCreated: false };
									}
									if (trigger.kind.category === "change" && options.failChange) {
										return yield* new DbError({ message: "planning failed" });
									}
									const rating = triggerRating(trigger);
									const batchRequests =
										trigger.payload?.category === "request" && trigger.payload.operation === "batch"
											? trigger.payload.items
											: undefined;
									const rated = (ratings: number[] | undefined, fallback: boolean) => {
										if (ratings === undefined) {
											return fallback;
										}
										if (batchRequests) {
											return batchRequests.some((request) => {
												const itemRating = triggerRating(request);
												return itemRating !== undefined && ratings.includes(itemRating);
											});
										}
										return rating !== undefined && ratings.includes(rating);
									};
									const blocked =
										trigger.kind.category === options.blocked &&
										rated(options.blockedRatings, true);
									if (trigger.kind.category === "request" && !blocked && !batchRequests) {
										yield* update(({ exclusions }) => ({
											exclusions: [...exclusions, input.excludedOncePerSubjectPolicies],
										}));
									}
									const declarations = (
										trigger.kind.category === "request" &&
										!blocked &&
										rated(options.policyRatings, true)
											? (options.policies ?? [])
											: []
									).filter(
										(policy) =>
											policy.frequency !== "once-per-subject" ||
											!input.excludedOncePerSubjectPolicies?.some(
												(excluded) =>
													excluded.pluginId === (policy.plugin ?? "plugin") &&
													excluded.hookSlug === policy.slug,
											),
									);
									const afterHook =
										trigger.kind.category === "change" && rated(options.afterHookRatings, false);
									if (options.noHooks && !blocked && declarations.length === 0 && !afterHook) {
										yield* record(`plan:${trigger.kind.category}`);
										return {
											trigger: null,
											runs: [] as const,
											policies: [] as const,
											_tag: "NoHooks" as const,
											wasCreated: false as const,
										};
									}
									yield* update(({ calls, triggers: planned }) => ({
										triggers: [...planned, trigger],
										calls: [...calls, `plan:${trigger.kind.category}`],
									}));
									if (blocked) {
										return yield* remember({
											runs: [],
											policies: [],
											wasCreated: true,
											trigger: {
												...trigger,
												blockedReason: {
													code: "automation-limit-reached" as const,
													hasRequiredHooks: trigger.kind.category === "change",
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
									if (trigger.kind.category !== "request") {
										return yield* remember({
											trigger,
											policies: [],
											wasCreated: true,
											runs: afterHook ? [hookRun(trigger, { slug: "after", stage: "after" })] : [],
										});
									}
									const runs = declarations.map((policy) =>
										hookRun(trigger, { stage: "before", slug: policy.slug, plugin: policy.plugin }),
									);
									const requestPayload = trigger.payload;
									yield* update(({ queued, identities, policyRequests }) => ({
										queued: new Set([...queued, ...runs.map((run) => run.id)]),
										identities: new Map([
											...identities,
											...runs.map((run) => [run.id, `${run.pluginId}/${run.hookSlug}`] as const),
										]),
										policyRequests:
											requestPayload?.category === "request"
												? new Map([
														...policyRequests,
														...runs.map((run) => [run.id, requestPayload] as const),
													])
												: policyRequests,
									}));
									assert(
										trigger.payload?.category === "request" && trigger.payload.resource === "event",
									);
									const plannedTrigger =
										trigger.payload.operation === "batch"
											? trigger
											: {
													...trigger,
													payload: {
														...trigger.payload,
														excludedOncePerSubjectPolicies:
															input.excludedOncePerSubjectPolicies ?? [],
													},
												};
									return yield* remember({
										runs,
										wasCreated: true,
										trigger: plannedTrigger,
										policies: runs.map((run, index) => ({
											runId: run.id,
											batchFrequency: declarations[index]?.frequency,
											position: declarations[index]?.position ?? 1000,
										})),
									});
								}).pipe(Effect.provideService(DatabaseSession, session)),
						}),
					),
				),
			);
			const execution = LifecycleExecution.of({
				...withLifecycleDispatch({
					skipQueuedPolicies: () =>
						Effect.gen(function* () {
							expect((yield* current).activeTransaction).toBe(false);
							yield* update(({ calls }) => ({ queued: new Set(), calls: [...calls, "skip"] }));
						}),
					after: () =>
						Effect.gen(function* () {
							const { options, activeActivity, activeTransaction } = yield* current;
							expect(activeTransaction).toBe(false);
							expect(activeActivity).toBe(false);
							yield* record("after");
							return options.warnings ?? [];
						}),
					executePolicy: (input) =>
						Effect.gen(function* () {
							const {
								options,
								executed,
								identities,
								activeActivity,
								policyRequests,
								activeTransaction,
							} = yield* current;
							expect(activeTransaction).toBe(false);
							expect(activeActivity).toBe(false);
							const retained = policyRequests.get(input.runId);
							assert(retained?.category === "request");
							assert(retained.operation !== "batch");
							const patched = applyLifecyclePolicyPatches(retained, input.acceptedPatches);
							assert(patched.ok);
							yield* update(({ calls, inputs, queued, executed: done }) => ({
								calls: [...calls, "policy"],
								inputs: [...inputs, patched.request],
								executed: [...done, identities.get(input.runId) ?? "missing"],
								queued: new Set([...queued].filter((id) => id !== input.runId)),
							}));
							const output = yield* options.execute?.({
								...input,
								index: executed.length,
								payload: patched.request,
							}) ?? Effect.succeed({ action: "allow" as const });
							const changedEntityId = options.changeEntityMetadataDuringPolicy;
							if (changedEntityId !== undefined) {
								yield* update(({ changedEntityMetadata }) => ({
									changedEntityMetadata: new Set([...changedEntityMetadata, changedEntityId]),
								}));
							}
							return output;
						}),
				}),
				executeBatchPolicy: (input) =>
					Effect.gen(function* () {
						const { options, identities, activeActivity, policyRequests, activeTransaction } =
							yield* current;
						expect(activeTransaction).toBe(false);
						expect(activeActivity).toBe(false);
						const retained = policyRequests.get(input.runId);
						assert(retained?.category === "request" && retained.operation === "batch");
						const identity = identities.get(input.runId) ?? "missing";
						const declaration = options.policies?.find(
							(policy) => `${policy.plugin ?? "plugin"}/${policy.slug}` === identity,
						);
						const oncePerSubject = declaration?.frequency === "once-per-subject";
						const seenEntityIds = new Set<EntityId>();
						const items: Array<{ itemIdentity: string; decision: AutomationPolicyOutput }> = [];
						yield* record("batch-policy");
						yield* update(({ queued }) => ({
							queued: new Set([...queued].filter((id) => id !== input.runId)),
						}));
						for (const [index, request] of retained.items.entries()) {
							const itemIdentity = retained.itemIdentities[index];
							assert(itemIdentity);
							if (!input.activeItemIdentities.includes(itemIdentity)) {
								continue;
							}
							if (options.policyRatings !== undefined) {
								const rating = triggerRating(request);
								if (rating === undefined || !options.policyRatings.includes(rating)) {
									continue;
								}
							}
							if (
								oncePerSubject &&
								"excludedOncePerSubjectPolicies" in request &&
								request.excludedOncePerSubjectPolicies?.some(
									(excluded) => `${excluded.pluginId}/${excluded.hookSlug}` === identity,
								)
							) {
								continue;
							}
							assert(request.resource === "event" && request.operation === "create");
							const referencedId = request.draft.entityId;
							if (oncePerSubject && seenEntityIds.has(referencedId)) {
								continue;
							}
							if (oncePerSubject) {
								seenEntityIds.add(referencedId);
							}
							const patched = applyLifecyclePolicyPatches(
								request,
								input.acceptedBatchPatches[itemIdentity] ?? [],
							);
							assert(patched.ok);
							const snapshot = yield* current;
							yield* update(({ calls, inputs, executed: done }) => ({
								calls: [...calls, "policy"],
								executed: [...done, identity],
								inputs: [...inputs, patched.request],
							}));
							const acceptedPatches = input.acceptedBatchPatches[itemIdentity] ?? [];
							const decision = yield* options.execute?.({
								acceptedPatches,
								runId: input.runId,
								payload: patched.request,
								index: snapshot.executed.length,
							}) ?? Effect.succeed({ action: "allow" as const });
							const changedEntityId = options.changeEntityMetadataDuringPolicy;
							if (changedEntityId !== undefined) {
								yield* update(({ changedEntityMetadata }) => ({
									changedEntityMetadata: new Set([...changedEntityMetadata, changedEntityId]),
								}));
							}
							items.push({ decision, itemIdentity });
						}
						return { items };
					}),
			});
			const engine = makeWorkflowEngine({
				activityExecute: (activity) =>
					Effect.gen(function* () {
						const instance = yield* WorkflowInstance;
						yield* update(({ activities }) => ({
							activeActivity: true,
							activities: [
								...activities,
								{ name: activity.name, executionId: instance.executionId },
							],
						}));
						let exit = yield* Effect.exit(activity.execute);
						const { options } = yield* current;
						if (
							options.replayWriteAfterSchemaDisable &&
							activity.name === "commit-events-0" &&
							Exit.isSuccess(exit)
						) {
							yield* update(() => ({ schemaDisabled: true }));
							exit = yield* Effect.exit(activity.execute);
						}
						if (options.retryActivity === activity.name && Exit.isSuccess(exit)) {
							exit = yield* Effect.exit(activity.execute);
						}
						return new Workflow.Complete({ exit });
					}).pipe(Effect.ensuring(update(() => ({ activeActivity: false })))),
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
				Layer.succeed(WorkflowEngine, engine),
				Layer.mock(EntitiesRepository)({
					getByIdForUser: ({ entityId: requestedId }) =>
						read((snapshot) => visibleEntity(snapshot, requestedId)),
					lockEntityReferencesByIds: (entityIds) =>
						Effect.gen(function* () {
							expect((yield* current).activeTransaction).toBe(true);
							yield* update(({ lockedEntityIds }) => ({
								lockedEntityIds: [...lockedEntityIds, [...entityIds]],
							}));
						}),
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
				}),
				Layer.mock(EventSchemaReader)({
					getScopeForUser: () =>
						read(({ schemaDisabled, schemaActivated }) =>
							eventSchemaScope(schemaDisabled, schemaActivated),
						),
					getScopesForUser: (_userId, inputs) =>
						read(({ schemaDisabled, schemaActivated }) =>
							inputs.map(() => eventSchemaScope(schemaDisabled, schemaActivated)),
						),
					lockCatalog: () =>
						update(({ options, triggers }) => ({
							schemaActivated:
								(options.activateSchemaBeforeWrite ?? false) &&
								triggers.some(({ kind }) => kind.category === "request"),
						})),
				}),
				Layer.mock(EventsRepository)({
					lockEventRows: ({ eventIds }) =>
						eventIds.length === 0
							? Effect.succeed([])
							: Effect.succeed(eventIds.map((id) => ({ id }))),
					createEvent: (input) =>
						Effect.gen(function* () {
							const { activeActivity, activeTransaction } = yield* current;
							expect(activeTransaction).toBe(true);
							expect(activeActivity).toBe(true);
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
									input.eventSchemaPluginId === null
										? null
										: PluginId.make(input.eventSchemaPluginId),
							};
						}),
					getEventSnapshot: ({ eventId }) =>
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
								Effect.mapError(() => new DbError({ message: "Invalid fixture event snapshot" })),
							);
						}),
				}),
				Layer.succeed(EventCreateHarness, {
					calls: read(({ calls }) => calls),
					inputs: read(({ inputs }) => inputs),
					queued: read(({ queued }) => queued),
					created: read(({ created }) => created),
					triggers: read(({ triggers }) => triggers),
					executed: read(({ executed }) => executed),
					activities: read(({ activities }) => activities),
					exclusions: read(({ exclusions }) => exclusions),
					checkedOwners: read(({ checkedOwners }) => checkedOwners),
					reset: (options) => Ref.set(state, initialState(options)),
					lockedEntityIds: read(({ lockedEntityIds }) => lockedEntityIds),
				}),
			);
		}),
	);

const run = (input = payload) =>
	Effect.gen(function* () {
		const currentEngine = yield* WorkflowEngine;
		const capturedContext =
			yield* Effect.context<Effect.Services<ReturnType<typeof runPolicyBatchWorkflow>>>();
		const childCapableEngine = makeWorkflowEngine({
			...currentEngine,
			execute: (workflow, options) => {
				if (workflow._tag !== PolicyBatchWorkflow._tag) {
					return Effect.die(`Unexpected workflow: ${workflow._tag}`);
				}
				const childInstance = WorkflowInstance.initial(PolicyBatchWorkflow, options.executionId);
				return runPolicyBatchWorkflow(
					Schema.decodeUnknownSync(PolicyBatchPayload)(options.payload),
				).pipe(
					Effect.onExit((exit) => Scope.close(childInstance.scope, exit)),
					Effect.provideService(WorkflowEngine, currentEngine),
					Effect.provideService(WorkflowInstance, childInstance),
					Effect.provide(capturedContext),
				);
			},
		});
		return yield* runEventCreateWorkflow(input, "workflow").pipe(
			Effect.provideServiceEffect(EventMutations, EventMutations.make),
			Effect.provideService(WorkflowEngine, childCapableEngine),
		);
	}).pipe(
		Effect.provideService(
			WorkflowInstance,
			WorkflowInstance.initial(EventCreateWorkflow, "workflow"),
		),
	);

layer(harnessLayer({ afterHookRatings: [1], policies: [{ position: 1, slug: "policy" }] }))(
	(test) => {
		test.effect(
			"plans an event batch before source writes and dispatches after hooks after commit",
			() =>
				Effect.gen(function* () {
					const h = yield* EventCreateHarness;
					const result = yield* run();
					expect(result).toMatchObject({ count: 1, warnings: [], failure: null });
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
					const activities = yield* h.activities;
					expect(
						activities.filter(
							({ name, executionId }) =>
								executionId === "workflow" && name.startsWith("commit-events-"),
						),
					).toHaveLength(1);
					const triggers = yield* h.triggers;
					const requestTrigger = triggers.find(({ kind }) => kind.category === "request");
					assert(requestTrigger);
					assert(
						requestTrigger.payload?.category === "request" &&
							requestTrigger.payload.operation === "batch",
					);
					expect(requestTrigger.payload.resource).toBe("event");
					expect(
						requestTrigger.payload.items.every(
							(item) => item.resource === "event" && item.operation === "create",
						),
					).toBe(true);
					const changeTrigger = triggers.find(({ kind }) => kind.category === "change");
					assert(changeTrigger);
					expect(changeTrigger.causation.parentTriggerId).toBe(requestTrigger.id);
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
		);
	},
);

layer(harnessLayer({ replayWriteAfterSchemaDisable: true }))((test) => {
	test.effect("replays a committed source activity after the event schema is disabled", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			expect(yield* run()).toMatchObject({ count: 1, warnings: [], failure: null });
			expect(yield* h.created).toHaveLength(1);
			expect(yield* h.triggers).toHaveLength(3);
			expect((yield* h.calls).filter((call) => call === "write")).toHaveLength(1);
			expect(
				(yield* h.activities).filter(
					({ name, executionId }) => executionId === "workflow" && name === "commit-events-0",
				),
			).toHaveLength(1);
		}),
	);
});

layer(harnessLayer())((test) => {
	test.effect("replays operation receipts and rejects changed input before writing", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			const secondEntity = EntityId.make("second-subject");
			const writeCommand = {
				...command,
				causation: {
					...command.causation,
					executionId: AutomationExecutionId.make("stable-submission"),
					rootExecutionId: AutomationExecutionId.make("stable-submission"),
				},
			};
			const input = {
				...payload,
				writeCommand,
				payload: [
					...payload.payload,
					{ eventSchemaSlug, entityId: secondEntity, properties: { rating: 0 } },
				],
			};
			yield* h.reset({ unreadableEntity: secondEntity });
			expect(yield* run(input)).toMatchObject({ count: 1, failure: { index: 1 } });
			expect(yield* h.created).toHaveLength(1);
			yield* h.reset({});
			const retry = {
				...input,
				command: {
					...command,
					causation: {
						...command.causation,
						executionId: AutomationExecutionId.make("retry-attempt"),
						rootExecutionId: AutomationExecutionId.make("retry-attempt"),
					},
				},
			};
			expect(yield* run(retry)).toMatchObject({ count: 2, failure: null });
			expect((yield* h.created).map(({ entityId: createdEntityId }) => createdEntityId)).toEqual([
				secondEntity,
			]);
			const retryActivities = yield* h.activities;
			expect(retryActivities.length).toBeGreaterThan(0);
			yield* h.reset({});
			const replayed = yield* run(retry);
			expect(replayed).toMatchObject({ count: 2, failure: null });
			expect(yield* h.activities).toEqual([]);
			expect(yield* h.created).toEqual([]);
			expect(yield* h.triggers).toEqual([]);
			yield* h.reset({});
			const changed = {
				...retry,
				payload: input.payload.map((item, index) =>
					index === 1
						? { eventSchemaSlug, entityId: secondEntity, properties: { rating: 2 } }
						: item,
				),
			};
			assertExitFails(
				yield* Effect.exit(run(changed)),
				new EventCreateItemError({ reason: { code: "mutation-conflict" } }),
			);
			expect(yield* h.activities).toEqual([]);
			expect(yield* h.created).toEqual([]);
		}),
	);
});

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
)((test) => {
	test.effect(
		"chains transforms in position/plugin/hook order and preserves trusted draft fields",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				yield* run();
				expect(yield* h.executed).toEqual(["a/a", "a/z", "b/z", "plugin/last"]);
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
	);
});

layer(
	harnessLayer({
		execute: () => Effect.succeed({ action: "reject", reason: "Declined" }),
		policies: [
			{ position: 1, slug: "first" },
			{ position: 2, slug: "second" },
		],
	}),
)((test) => {
	test.effect(
		"rejection closes remaining policies and creates no domain row or change trigger",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				expect(yield* run()).toEqual({
					count: 0,
					warnings: [],
					failure: null,
					outcomes: [{ index: 0, reason: "Declined", status: "skipped_by_policy" }],
				});
				expect(yield* h.inputs).toHaveLength(1);
				expect(yield* h.created).toEqual([]);
				expect(yield* h.triggers).toHaveLength(1);
				expect((yield* h.queued).size).toBe(0);
			}),
	);
});

layer(
	harnessLayer({
		policies: [
			{ position: 1, slug: "fail" },
			{ position: 2, slug: "later" },
		],
		execute: ({ runId }) =>
			new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
	}),
)((test) => {
	test.effect("fails the selected batch with its stable policy run identity", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			const result = yield* run();
			const requestTrigger = (yield* h.triggers).find(({ kind }) => kind.category === "request");
			assert(requestTrigger);
			expect(result).toMatchObject({
				count: 0,
				outcomes: [{ index: 0, status: "failed" }],
				failure: {
					index: 0,
					reason: {
						code: "policy-execution-failed",
						runId: hookRun(requestTrigger, { slug: "fail", stage: "before" }).id,
					},
				},
			});
			expect(yield* h.created).toEqual([]);
			expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(1);
		}),
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
)((test) => {
	test.effect("keeps valid events when one transformed draft fails validation", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
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
	);
});

const hiddenSession = EntityId.make("hidden-session");

layer(harnessLayer({ noHooks: true, unreadableEntity: hiddenSession }))((test) => {
	test.effect("reports an initially unreadable session reference at its item index", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
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
	);
});

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
)((test) => {
	test.effect("revalidates a transformed session reference before writing", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			expect((yield* run()).failure).toEqual({
				index: 0,
				reason: { entityId: hiddenSession, code: "session-entity-not-found" },
			});
			expect(yield* h.created).toEqual([]);
			expect(yield* h.triggers).toHaveLength(1);
		}),
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
)((test) => {
	test.effect("normalizes an empty transformed session reference before writing", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			expect(yield* run()).toMatchObject({ count: 1, failure: null });
			expect((yield* h.created)[0]?.sessionEntityId).toBeUndefined();
			expect(yield* h.lockedEntityIds).toEqual([[entityId], [entityId]]);
		}),
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
)((test) => {
	test.effect(
		"locks and revalidates the transformed session reference in the write transaction",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				expect((yield* run()).failure).toEqual({ index: 0, reason: { code: "mutation-conflict" } });
				expect(yield* h.lockedEntityIds).toEqual([[entityId], [racingSession, entityId]]);
				expect(yield* h.created).toEqual([]);
			}),
	);
});

layer(
	harnessLayer({
		changeEntityMetadataDuringPolicy: entityId,
		policies: [{ position: 1, slug: "metadata" }],
	}),
)((test) => {
	test.effect("reports a mutation conflict when an original reference changes during policy", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			expect((yield* run()).failure).toEqual({ index: 0, reason: { code: "mutation-conflict" } });
			expect(yield* h.executed).toEqual(["plugin/metadata"]);
			expect(yield* h.lockedEntityIds).toEqual([[entityId], [entityId]]);
			expect(yield* h.created).toEqual([]);
		}),
	);
});

layer(
	harnessLayer({
		policies: [{ position: 1, slug: "policy" }],
		execute: ({ runId, payload: request }) =>
			request.draft.properties["rating"] === 2
				? new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" })
				: Effect.succeed({ action: "allow" as const }),
	}),
)((test) => {
	test.effect("fails the entire selected batch when a policy run fails", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			const result = yield* run({ ...payload, payload: ratedItems([1, 2, 3]) });
			const requestTrigger = (yield* h.triggers).find(({ kind }) => kind.category === "request");
			assert(requestTrigger);
			expect(result).toMatchObject({
				count: 0,
				failure: {
					index: 0,
					reason: {
						code: "policy-execution-failed",
						runId: hookRun(requestTrigger, { slug: "policy", stage: "before" }).id,
					},
				},
			});
			expect(result.outcomes.map(({ index, status }) => [index, status])).toEqual([
				[0, "failed"],
				[1, "failed"],
				[2, "failed"],
			]);
			expect(yield* h.created).toEqual([]);
			expect(yield* h.inputs).toHaveLength(2);
			expect((yield* h.calls).filter((call) => call === "batch-policy")).toHaveLength(1);
		}),
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
)((test) => {
	test.effect("rejects an invalid intermediate patch before running the next policy", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			expect((yield* run()).failure).toEqual({ index: 0, reason: { code: "invalid-properties" } });
			expect(yield* h.executed).toHaveLength(1);
			expect(yield* h.created).toEqual([]);
		}),
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
					? { reason: "First only", action: "reject" as const }
					: { action: "allow" as const },
			),
	}),
)((test) => {
	test.effect(
		"consumes a rejecting subject policy on the first eligible item, but keeps later unstarted policies eligible",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
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
	);
});

layer(
	harnessLayer({
		policies: [
			{ position: 1, slug: "subject", frequency: "once-per-subject" },
			{ position: 2, slug: "item" },
		],
	}),
)((test) => {
	test.effect("batches once-per-subject policies by subject and regular policies by item", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
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
	);
});

layer(harnessLayer({ failChange: true }))((test) => {
	test.effect("retains request history and dispatches no hooks when change planning fails", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			assertExitFails(yield* Effect.exit(run()), new DbError({ message: "planning failed" }));
			expect(yield* h.created).toEqual([]);
			expect((yield* h.triggers).map((trigger) => trigger.kind.category)).toEqual(["request"]);
			expect(yield* h.calls).not.toContain("after");
		}),
	);
});

layer(harnessLayer({ activateSchemaBeforeWrite: true }))((test) => {
	test.effect("reports a mutation conflict when the event schema changes after preparation", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			const result = yield* run();
			expect(result.failure).toEqual({ index: 0, reason: { code: "mutation-conflict" } });
			expect(yield* h.created).toEqual([]);
			expect(yield* h.calls).not.toContain("after");
		}),
	);
});

layer(harnessLayer({ blocked: "request" }))((test) => {
	test.effect(
		"a blocked request fails closed while required failures remain successful warnings",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				expect((yield* run()).failure).toMatchObject({
					reason: { triggerId: expect.any(String), code: "automation-limit-reached" },
				});
				expect(yield* h.created).toEqual([]);
				const warning = {
					code: "required-hook-failed" as const,
					runId: AutomationRunId.make("required-run"),
					hookSlug: AutomationHookSlug.make("required"),
				};
				yield* h.reset({ warnings: [warning] });
				expect(
					yield* run({
						...payload,
						command: {
							...command,
							causation: {
								...command.causation,
								executionId: AutomationExecutionId.make("required-warning"),
							},
						},
					}),
				).toMatchObject({ count: 1, failure: null, warnings: [warning, warning] });
				expect(yield* h.created).toHaveLength(1);
				yield* h.reset({ blocked: "change" });
				expect(
					yield* run({
						...payload,
						command: {
							...command,
							causation: {
								...command.causation,
								executionId: AutomationExecutionId.make("blocked-change"),
							},
						},
					}),
				).toMatchObject({
					count: 1,
					failure: null,
					warnings: [{ code: "automation-limit-reached" }, { code: "automation-limit-reached" }],
				});
			}),
	);
});

const ratedItems = (ratings: ReadonlyArray<number>, entities: Record<number, EntityId> = {}) =>
	ratings.map((rating, index) => ({
		eventSchemaSlug,
		properties: { rating },
		entityId: entities[index] ?? entityId,
	}));
const sourceCommits = (activities: ReadonlyArray<RecordedActivity>) =>
	activities
		.filter(
			({ name, executionId }) => executionId === "workflow" && name.startsWith("commit-events-"),
		)
		.map(({ name }) => name);
const hiddenSubject = EntityId.make("hidden-subject");

layer(harnessLayer({ noHooks: true, unreadableEntity: hiddenSubject }))((test) => {
	test.effect("writes valid items from each chunk and records an invalid item at its index", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
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
			expect(sourceCommits(yield* h.activities)).toEqual(["commit-events-0", "commit-events-50"]);
		}),
	);
});

layer(harnessLayer({ noHooks: true, afterHookRatings: [2] }))((test) => {
	test.effect("commits all items in one chunk before dispatching after hooks", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
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
			expect(sourceCommits(yield* h.activities)).toEqual(["commit-events-0"]);
		}),
	);
});

layer(harnessLayer({ noHooks: true, afterHookRatings: [2], retryActivity: "commit-events-0" }))(
	(test) => {
		test.effect("replays a source commit after a lost response without duplicate writes", () =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				const result = yield* run({ ...payload, payload: ratedItems([1, 2, 3]) });
				expect(result).toMatchObject({ count: 3, failure: null });
				expect(yield* h.created).toHaveLength(3);
				expect(sourceCommits(yield* h.activities)).toEqual(["commit-events-0"]);
				expect((yield* h.created).map(({ id }) => id)).toEqual(
					result.outcomes.map((outcome) => (outcome.status === "written" ? outcome.eventId : null)),
				);
			}),
		);
	},
);

layer(harnessLayer({ noHooks: true, afterHookRatings: [2] }))((test) => {
	test.effect("replays a completed operation receipt without new activities or writes", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			const input = { ...payload, payload: ratedItems([1, 2, 3]) };
			const first = yield* run(input);
			const activities = yield* h.activities;
			expect(activities.length).toBeGreaterThan(0);
			expect(yield* h.created).toHaveLength(3);
			yield* h.reset({ noHooks: true, afterHookRatings: [2] });
			const replayed = yield* run(input);
			expect(replayed).toEqual(first);
			expect(yield* h.activities).toEqual([]);
			expect(yield* h.created).toEqual([]);
			expect(yield* h.triggers).toEqual([]);
			expect(yield* h.calls).not.toContain("write");
			expect(yield* h.calls).not.toContain("batch-policy");
			expect(yield* h.executed).toEqual([]);
		}),
	);
});

layer(
	harnessLayer({
		noHooks: true,
		policyRatings: [2],
		unreadableEntity: hiddenSubject,
		policies: [{ position: 1, slug: "policy" }],
	}),
)((test) => {
	test.effect("writes valid items around an unreadable item in the same chunk", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
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
			expect(sourceCommits(yield* h.activities)).toEqual(["commit-events-0"]);
		}),
	);
});

layer(
	harnessLayer({
		noHooks: true,
		policyRatings: [1, 3],
		policies: [{ position: 1, slug: "subject", frequency: "once-per-subject" }],
	}),
)((test) => {
	test.effect("deduplicates once-per-subject policy execution within a batch", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
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
	);
});

layer(
	harnessLayer({
		noHooks: true,
		policies: [{ position: 1, slug: "subject", frequency: "once-per-subject" }],
	}),
)((test) => {
	test.effect("keeps once-per-subject exclusions across source chunks", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
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
			expect(sourceCommits(yield* h.activities)).toEqual(["commit-events-0", "commit-events-50"]);
		}),
	);
});

layer(harnessLayer({ noHooks: true, blocked: "request", blockedRatings: [2] }))((test) => {
	test.effect("blocks the full batch when any request item exceeds the policy limit", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			const result = yield* run({ ...payload, payload: ratedItems([1, 2]) });
			expect(result).toMatchObject({
				count: 0,
				failure: {
					index: 0,
					reason: { triggerId: expect.any(String), code: "automation-limit-reached" },
				},
			});
			expect(result.outcomes.map(({ index, status }) => [index, status])).toEqual([
				[0, "failed"],
				[1, "failed"],
			]);
			expect(yield* h.created).toEqual([]);
			expect(yield* h.executed).toEqual([]);
			expect(sourceCommits(yield* h.activities)).toEqual([]);
		}),
	);
});

const otherUsersSubject = EntityId.make("other-users-subject");

layer(harnessLayer({ noHooks: true, unreadableEntity: otherUsersSubject }))((test) => {
	test.effect("reports another user's entity and writes valid items from the chunk", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			const result = yield* run({
				...payload,
				payload: ratedItems([1, 2], { 1: otherUsersSubject }),
			});
			expect(result).toMatchObject({
				count: 1,
				failure: { index: 1, reason: { code: "entity-not-found", entityId: otherUsersSubject } },
			});
			expect(result.outcomes.map(({ index, status }) => [index, status])).toEqual([
				[0, "written"],
				[1, "failed"],
			]);
			expect(yield* h.created).toHaveLength(1);
		}),
	);
});

const foreignSubject = EntityId.make("foreign-subject");

layer(harnessLayer({ noHooks: true, foreignEntity: foreignSubject }))((test) => {
	test.effect("writes valid items and reports each foreign entity at its index", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
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
			expect((yield* h.checkedOwners).filter((owner) => owner === foreignPluginId)).toHaveLength(1);
			expect(yield* h.created).toHaveLength(1);
		}),
	);
});

layer(
	harnessLayer({
		noHooks: true,
		policyRatings: [2],
		retryActivity: "commit-events-0",
		policies: [{ position: 1, slug: "policy" }],
	}),
)((test) => {
	test.effect("replays a source commit after a lost response", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			expect(yield* run({ ...payload, payload: ratedItems([1, 2]) })).toMatchObject({
				count: 2,
				failure: null,
			});
			expect((yield* h.triggers).filter(({ kind }) => kind.category === "request")).toHaveLength(1);
			expect(yield* h.executed).toEqual(["plugin/policy"]);
			expect(yield* h.created).toHaveLength(2);
			expect(sourceCommits(yield* h.activities)).toEqual(["commit-events-0"]);
		}),
	);
});

const revokedPrincipal = Schema.decodeSync(ScriptExecutionPrincipal)({
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
		compiledHashes: { script: "hash" },
		packageId: PluginPackageId.make("test/revoked"),
		configSchema: { fields: {}, unknownKeys: "strict" },
		schemaScope: {
			eventSchemas: [],
			signalSchemaSlugs: [],
			entitySchemaSlugs: [],
			relationshipSchemaSlugs: [],
		},
	},
	subject: {
		runId: "run",
		stage: "after",
		delivery: "required",
		triggerId: "trigger",
		type: "automation-run",
		executionUserId: userId,
		pluginId: "revoked-plugin",
		pluginRevisionId: "revoked-revision",
		pluginConfigRevisionId: "revoked-config",
		accountGeneration: { userId, token: "test-account-generation" },
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
});

layer(harnessLayer({ noHooks: true }))((test) => {
	test.effect("fails a chunk with the principal-owner check error of a revoked plugin", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			assertExitFails(
				yield* Effect.exit(
					run({
						...payload,
						payload: ratedItems([1, 2]),
						command: { ...command, writeContext: revokedPrincipal },
					}),
				),
				new DbError({ message: "Pinned domain write authority is unavailable" }),
			);
			expect(yield* h.created).toEqual([]);
		}),
	);
});

layer(harnessLayer({ noHooks: true }))((test) => {
	test.effect("fails an event-create item that references another user's managed asset", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
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
	);
});
