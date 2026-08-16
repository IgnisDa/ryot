import { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationPolicyPatch,
	AutomationRelationshipDraft,
	AutomationRelationshipSnapshot,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	RelationshipBadRequest,
	RelationshipBatchResult,
	RelationshipNotFound,
	RelationshipReconciliationResult,
	RelationshipScope,
} from "@ryot-app/contract/modules/relationships/schemas";
import { RelationshipId, type UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Effect, Schema, Struct } from "effect";

import {
	LifecyclePlannedPolicy,
	LifecyclePlanner,
	lifecycleTriggerId,
	toLifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { lifecycleTrigger, type LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import {
	applyLifecyclePolicyPatch,
	canonicalLifecyclePolicyPatch,
} from "#lib/domain/lifecycle-policy-patch";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import {
	mapCommittedResult,
	runLifecycleWriteInline,
	type LifecycleCommittedStep,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import type { RelationshipSchemaDefinition } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	catalogDefinitionFingerprint,
	PluginRuntimeResolver,
} from "#modules/plugins/runtime-resolver";

import {
	assertRootTransaction,
	badProperties,
	equal,
	itemCommand,
	mergeProperties,
	parseProperties,
	populationIdentity,
	relationshipChange,
	relationshipKey,
	RelationshipMutation,
	RelationshipRequest,
	snapshot,
	transaction,
	validateUserIdentity,
	type ChangeUserRelationshipBatch,
	type Mutation,
	type ReconcileGlobalRelationshipGroup,
} from "./mutation-support";
import {
	GlobalRelationshipListInput,
	RelationshipsRepository,
	relationshipMutationLockKey,
} from "./repository";

const PlannedRelationshipMutation = Schema.Struct({
	mutation: RelationshipMutation,
	request: Schema.NullOr(RelationshipRequest),
	policies: Schema.Array(LifecyclePlannedPolicy),
	requestId: Schema.NullOr(AutomationTrigger.fields.id),
	before: Schema.NullOr(AutomationRelationshipSnapshot),
});

export const PendingRelationshipMutations = Schema.Struct({
	items: Schema.Array(PlannedRelationshipMutation),
	selector: Schema.NullOr(GlobalRelationshipListInput),
	expectedSelection: Schema.NullOr(Schema.Array(RelationshipId)),
});
export type PendingRelationshipMutations = typeof PendingRelationshipMutations.Type;

export const RelationshipMutationError = Schema.Union([
	RelationshipBadRequest,
	RelationshipNotFound,
	DbError,
]);

export const RelationshipSingleResult = Schema.Struct({
	relationship: Schema.NullOr(
		Schema.Struct({ ...RelationshipScope.fields, updatedAt: Schema.String }),
	),
});
type RelationshipMutationResults = ReadonlyArray<
	RelationshipSingleResult & { readonly operation: "create" | "update" | "delete" | "noop" }
>;
export type RelationshipSingleResult = typeof RelationshipSingleResult.Type;

export const RelationshipBatchSummary = Schema.Struct(
	Struct.omit(RelationshipBatchResult.fields, ["warnings"]),
);
export type RelationshipBatchSummary = typeof RelationshipBatchSummary.Type;

export const RelationshipReconciliationSummary = Schema.Struct(
	Struct.omit(RelationshipReconciliationResult.fields, ["warnings"]),
);
export type RelationshipReconciliationSummary = typeof RelationshipReconciliationSummary.Type;

const lockMutations = (
	pending: Omit<PendingRelationshipMutations, "items">,
	mutations: ReadonlyArray<Mutation>,
) =>
	Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const entities = yield* EntitiesRepository;
		if (pending.selector) {
			const selection = yield* repository.listGlobalRelationships(pending.selector);
			if (
				pending.expectedSelection &&
				!equal(selection.map(({ id }) => id).sort(), [...pending.expectedSelection].sort())
			) {
				return yield* new RelationshipBadRequest({
					reason: { code: "concurrent-relationship-change" },
				});
			}
		}
		yield* entities.lockEntityReferencesByIds(
			mutations.flatMap(({ input }) => [input.sourceEntityId, input.targetEntityId]),
		);
		yield* repository.lockRelationshipMutations(mutations.map(({ input }) => input));
		return undefined;
	});

const skipPlannedPolicies = (pending: PendingRelationshipMutations) =>
	Effect.flatMap(LifecycleExecution, (execution) =>
		Effect.forEach(
			pending.items,
			({ requestId }) =>
				requestId ? execution.skipQueuedPolicies({ triggerId: requestId }) : Effect.void,
			{ discard: true },
		),
	);

export const planRelationshipMutations = Effect.fn("RelationshipsService.planMutations")(function* (
	mutations: ReadonlyArray<Mutation>,
	selector: GlobalRelationshipListInput | null = null,
	expectedSelection: ReadonlyArray<{ id: RelationshipId }> | null = null,
) {
	yield* assertRootTransaction;
	const repository = yield* RelationshipsRepository;
	const planner = yield* LifecyclePlanner;
	const ordered = [...mutations].sort((left, right) =>
		relationshipMutationLockKey(left.input).localeCompare(relationshipMutationLockKey(right.input)),
	);
	const scope = { selector, expectedSelection: expectedSelection?.map(({ id }) => id) ?? null };
	const planned = yield* transaction(
		Effect.gen(function* () {
			yield* lockMutations(scope, ordered);
			return yield* Effect.forEach(ordered, (mutation) =>
				Effect.gen(function* () {
					const { mode, input, command } = mutation;
					const unplanned = {
						mutation,
						policies: [],
						request: null,
						blocked: false,
						requestId: null,
					};
					let replay: RelationshipRequest | null = null;
					for (const operation of ["create", "update", "delete"] as const) {
						const payload = yield* repository.findLifecyclePayload(
							lifecycleTriggerId({
								discriminator: "lifecycle",
								itemIdentity: command.itemIdentity,
								executionId: command.causation.executionId,
								kind: { operation, category: "request", resource: "relationship" },
							}),
						);
						if (payload?.category === "request" && payload.resource === "relationship") {
							replay = payload;
						}
					}
					const row = yield* repository.findRelationship(input);
					let before = row ? yield* snapshot(row) : null;
					if (replay) {
						switch (replay.operation) {
							case "create":
								before = null;
								break;
							case "delete":
								before = replay.draft;
								break;
							case "update":
								before = replay.before;
								break;
						}
					}
					if (!before && mode === "update") {
						return yield* new RelationshipNotFound({ reason: { code: "relationship-not-found" } });
					}
					if (!before && mode === "delete") {
						return { ...unplanned, before };
					}
					let request: RelationshipRequest;
					if (mode === "delete" && before) {
						request = {
							draft: before,
							category: "request",
							operation: "delete",
							resource: "relationship",
						};
					} else {
						if (!mutation.propertiesSchema) {
							return yield* new DbError({ message: "Missing relationship property schema" });
						}
						const properties =
							mode === "merge"
								? mergeProperties(before?.properties, mutation.properties)
								: mutation.properties;
						const draft = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
							properties,
							sourceEntityId: input.sourceEntityId,
							targetEntityId: input.targetEntityId,
							relationshipSchemaSlug: input.relationshipSchemaSlug,
						}).pipe(Effect.mapError(() => badProperties([])));
						if (!replay && before && equal(before.properties, draft.properties)) {
							return { ...unplanned, before };
						}
						request = before
							? {
									draft,
									before,
									category: "request",
									operation: "update",
									resource: "relationship",
								}
							: { draft, category: "request", operation: "create", resource: "relationship" };
					}
					if (replay && !equal(replay, request)) {
						return yield* new RelationshipBadRequest({
							reason: { code: "lifecycle-command-conflict" },
						});
					}
					const plan = yield* planner.plan({
						trigger: lifecycleTrigger(
							command,
							input.scope === "user" ? input.userId : null,
							request,
						),
					});
					return {
						before,
						request,
						mutation,
						policies: plan.policies,
						requestId: plan.trigger.id,
						blocked: plan.trigger.blockedReason !== null,
					};
				}),
			);
		}),
	);
	const pending = {
		...scope,
		items: planned.map(({ blocked: _blocked, ...item }) => item),
	} satisfies PendingRelationshipMutations;
	if (planned.some(({ blocked }) => blocked)) {
		return yield* skipPlannedPolicies(pending).pipe(
			Effect.andThen(new RelationshipBadRequest({ reason: { code: "automation-limit-reached" } })),
			Effect.uninterruptible,
		);
	}
	return pending;
});

export const applyRelationshipPolicies = Effect.fn("RelationshipsService.applyPolicies")(function* (
	pending: PendingRelationshipMutations,
) {
	const execution = yield* LifecycleExecution;
	const items = yield* Effect.forEach(pending.items, (item) =>
		Effect.gen(function* () {
			if (!item.request) {
				return item;
			}
			let request = item.request;
			const acceptedPatches: AutomationPolicyPatch[] = [];
			for (const policy of item.policies) {
				const output = yield* execution
					.executePolicy({ runId: policy.runId, acceptedPatches: [...acceptedPatches] })
					.pipe(
						Effect.catchTag("AutomationPolicyExecutionError", (error) =>
							Effect.fail(
								new RelationshipBadRequest({
									reason: { runId: error.runId, code: "policy-execution-failed" },
								}),
							),
						),
					);
				if (output.action === "reject") {
					return yield* new RelationshipBadRequest({
						reason: { runId: policy.runId, code: "policy-rejected" },
					});
				}
				if (output.action === "transform") {
					const patched = applyLifecyclePolicyPatch(request, output.patch);
					if (!patched.ok || patched.request.operation === "delete") {
						return yield* new RelationshipBadRequest({
							reason: { runId: policy.runId, code: "policy-rejected" },
						});
					}
					if (!item.mutation.propertiesSchema) {
						return yield* new DbError({ message: "Missing relationship property schema" });
					}
					const properties = yield* parseProperties(
						patched.request.draft.properties,
						item.mutation.propertiesSchema,
					);
					const successor = {
						...patched.request,
						draft: yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
							...patched.request.draft,
							properties,
						}).pipe(Effect.mapError(() => badProperties([]))),
					};
					const acceptedPatch = canonicalLifecyclePolicyPatch(request, successor);
					request = successor;
					if (acceptedPatch) {
						acceptedPatches.push(acceptedPatch);
					}
				}
			}
			if (request.operation !== "delete") {
				if (!item.mutation.propertiesSchema) {
					return yield* new DbError({ message: "Missing relationship property schema" });
				}
				const properties = yield* parseProperties(
					request.draft.properties,
					item.mutation.propertiesSchema,
				);
				const draft = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
					...request.draft,
					properties,
				}).pipe(Effect.mapError(() => badProperties([])));
				request = { ...request, draft };
			}
			return { ...item, request };
		}),
	).pipe(
		Effect.catchCauseIf(
			(cause) => !Cause.hasInterruptsOnly(cause),
			(cause) =>
				skipPlannedPolicies(pending).pipe(
					Effect.andThen(Effect.failCause(cause)),
					Effect.uninterruptible,
				),
		),
	);
	return { ...pending, items } satisfies PendingRelationshipMutations;
});

export const commitRelationshipMutations = Effect.fn("RelationshipsService.commitMutations")(
	function* (pending: PendingRelationshipMutations) {
		const repository = yield* RelationshipsRepository;
		const planner = yield* LifecyclePlanner;
		const runtime = yield* PluginRuntimeResolver;
		const committed = yield* transaction(
			Effect.gen(function* () {
				let revalidated = pending.items;
				if (
					pending.items.some(({ request }) => request !== null && request.operation !== "delete")
				) {
					yield* runtime.lockCatalog();
					const userCatalogs = new Map<
						UserId,
						Effect.Success<ReturnType<typeof runtime.getEffectiveDefinitions>>
					>();
					let globalCatalog: Effect.Success<
						ReturnType<typeof runtime.getGlobalDefinitions>
					> | null = null;
					revalidated = yield* Effect.forEach(pending.items, (item) =>
						Effect.gen(function* () {
							const { mutation } = item;
							if (item.request === null || item.request.operation === "delete") {
								return item;
							}
							const expected = mutation.schemaFingerprint;
							if (!expected) {
								return yield* new RelationshipBadRequest({
									reason: { code: "concurrent-relationship-change" },
								});
							}
							let definition: RelationshipSchemaDefinition | undefined;
							if (mutation.input.scope === "user") {
								let catalog = userCatalogs.get(mutation.input.userId);
								if (!catalog) {
									catalog = yield* runtime.getEffectiveDefinitions(mutation.input.userId);
									userCatalogs.set(mutation.input.userId, catalog);
								}
								definition = catalog.relationshipSchemas[mutation.input.relationshipSchemaSlug];
							} else {
								globalCatalog ??= yield* runtime.getGlobalDefinitions();
								definition =
									globalCatalog.relationshipSchemas[mutation.input.relationshipSchemaSlug];
							}
							if (
								!definition ||
								(definition.pluginId ?? null) !==
									(mutation.input.relationshipSchemaPluginId ?? null) ||
								!equal(catalogDefinitionFingerprint(definition), expected)
							) {
								return yield* new RelationshipBadRequest({
									reason: { code: "concurrent-relationship-change" },
								});
							}
							const properties = yield* parseProperties(
								item.request.draft.properties,
								definition.propertiesSchema,
							);
							const draft = yield* Schema.decodeUnknownEffect(AutomationRelationshipDraft)({
								...item.request.draft,
								properties,
							}).pipe(Effect.mapError(() => badProperties([])));
							return { ...item, request: { ...item.request, draft } };
						}),
					);
				}
				yield* lockMutations(
					pending,
					pending.items.map(({ mutation }) => mutation),
				);
				const results = [];
				for (const item of revalidated) {
					const { input, command } = item.mutation;
					const { request, requestId } = item;
					if (request && requestId) {
						const prior = yield* repository.findLifecyclePayload(
							lifecycleTriggerId({
								discriminator: "lifecycle",
								itemIdentity: command.itemIdentity,
								executionId: command.causation.executionId,
								kind: {
									category: "change",
									resource: "relationship",
									operation: request.operation,
								},
							}),
						);
						if (
							prior?.category === "change" &&
							prior.resource === "relationship" &&
							prior.operation !== "batch"
						) {
							const persisted = prior.operation === "delete" ? prior.before : prior.after;
							const draft = {
								properties: persisted.properties,
								sourceEntityId: persisted.sourceEntityId,
								targetEntityId: persisted.targetEntityId,
								relationshipSchemaSlug: persisted.relationshipSchemaSlug,
							};
							if (
								prior.operation !== request.operation ||
								(request.operation === "delete"
									? !equal(request.draft, persisted)
									: !equal(request.draft, draft)) ||
								(request.operation === "update" &&
									prior.operation === "update" &&
									!equal(request.before, prior.before))
							) {
								return yield* new RelationshipBadRequest({
									reason: { code: "lifecycle-command-conflict" },
								});
							}
							const priorPopulation = prior.population;
							if (
								!equal(populationIdentity(priorPopulation), populationIdentity(command.population))
							) {
								return yield* new RelationshipBadRequest({
									reason: { code: "lifecycle-command-conflict" },
								});
							}
							const plan = yield* planner.plan({
								trigger: lifecycleTrigger(
									{ ...command, causation: { ...command.causation, parentTriggerId: requestId } },
									input.scope === "user" ? input.userId : null,
									prior,
								),
							});
							const saved = prior.operation === "delete" ? prior.before : prior.after;
							results.push({
								plan,
								operation: "noop" as const,
								relationship: { ...saved, wasInserted: prior.operation === "create" },
							});
							continue;
						}
					}
					const row = yield* repository.findRelationship(input);
					const current = row ? yield* snapshot(row) : null;
					if (!equal(current, item.before)) {
						return yield* new RelationshipBadRequest({
							reason: { code: "concurrent-relationship-change" },
						});
					}
					if (
						!request ||
						!requestId ||
						(request.operation !== "delete" &&
							current &&
							equal(current.properties, request.draft.properties))
					) {
						results.push({
							plan: null,
							operation: "noop" as const,
							relationship: row ? { ...row, wasInserted: false } : null,
						});
						continue;
					}
					let saved;
					if (request.operation === "delete") {
						saved = yield* repository.deleteRelationship(input);
					} else {
						const write =
							request.operation === "create"
								? repository.createRelationship
								: repository.updateRelationship;
						saved = yield* write({ ...input, properties: { ...request.draft.properties } });
					}
					if (!saved) {
						return yield* new RelationshipNotFound({ reason: { code: "relationship-not-found" } });
					}
					const persisted = yield* snapshot(saved);
					const payload = relationshipChange(request, persisted);
					results.push({
						plan: null,
						operation: request.operation,
						pending: { input, payload, command, requestId },
						relationship: { ...saved, wasInserted: request.operation === "create" },
					});
				}
				const counts = {
					createdCount: results.filter(({ operation }) => operation === "create").length,
					updatedCount: results.filter(({ operation }) => operation === "update").length,
					deletedCount: results.filter(({ operation }) => operation === "delete").length,
				};
				const beforeCount =
					pending.expectedSelection?.length ??
					pending.items.filter(({ before }) => before !== null).length;
				let changedIndex = 0;
				const items = yield* Effect.forEach(results, (result) =>
					Effect.gen(function* () {
						if (!("pending" in result)) {
							return result;
						}
						const { input, payload, command, requestId } = result.pending;
						const population = command.population
							? {
									...command.population,
									...(command.population.batch
										? {
												batch: {
													...command.population.batch,
													...counts,
													beforeCount,
													isLeader: changedIndex === 0,
													afterCount: beforeCount + counts.createdCount - counts.deletedCount,
												},
											}
										: {}),
								}
							: undefined;
						changedIndex += 1;
						const plan = yield* planner.plan({
							trigger: lifecycleTrigger(
								{ ...command, causation: { ...command.causation, parentTriggerId: requestId } },
								input.scope === "user" ? input.userId : null,
								{ ...payload, ...(population === undefined ? {} : { population }) },
							),
						});
						return { plan, operation: result.operation, relationship: result.relationship };
					}),
				);
				const command = pending.items[0]?.mutation.command;
				const batch =
					command === undefined
						? []
						: yield* planner.planBatch({
								command,
								resource: "relationship",
								plans: items.flatMap(({ plan }) => (plan ? [plan] : [])),
								identity: pending.items.map(({ mutation }) => mutation.command.itemIdentity),
							});
				return { items, batch };
			}),
		);
		return {
			_tag: "Committed",
			result: committed.items.map(({ operation, relationship }) => ({ operation, relationship })),
			dispatch: [
				...committed.items.flatMap(({ plan }) => (plan ? [plan] : [])),
				...committed.batch,
			].map(toLifecycleDispatchPlan),
		} satisfies LifecycleCommittedStep<RelationshipMutationResults>;
	},
);

export const prepareRelationshipMutations = Effect.fn("RelationshipsService.prepareMutations")(
	function* (
		mutations: ReadonlyArray<Mutation>,
		selector?: GlobalRelationshipListInput,
		expectedSelection?: ReadonlyArray<{ id: RelationshipId }>,
	) {
		const pending = yield* planRelationshipMutations(mutations, selector, expectedSelection);
		if (pending.items.some(({ policies }) => policies.length > 0)) {
			return { pending, _tag: "PoliciesRequired" } satisfies LifecyclePreparedStep<
				RelationshipMutationResults,
				PendingRelationshipMutations
			>;
		}
		return yield* commitRelationshipMutations(yield* applyRelationshipPolicies(pending));
	},
);

export const commitProjectedRelationshipMutations = <Result>(
	pending: PendingRelationshipMutations,
	project: (results: RelationshipMutationResults) => Result,
) =>
	commitRelationshipMutations(pending).pipe(
		Effect.map(
			(step): LifecyclePreparedStep<Result, PendingRelationshipMutations> => ({
				...step,
				result: project(step.result),
			}),
		),
	);

export const prepareProjectedRelationshipMutations = <Result, E, R>(
	prepare: Effect.Effect<
		LifecyclePreparedStep<RelationshipMutationResults, PendingRelationshipMutations>,
		E,
		R
	>,
	project: (results: RelationshipMutationResults) => Result,
) => prepare.pipe(Effect.map((step) => mapCommittedResult(step, project)));

export const singleRelationshipResult = (
	results: RelationshipMutationResults,
): RelationshipSingleResult => ({ relationship: results[0]?.relationship ?? null });

export const summarizeRelationshipMutations = (
	results: RelationshipMutationResults,
): RelationshipBatchSummary => ({
	created: results.filter((row) => row.operation === "create").length,
	updated: results.filter((row) => row.operation === "update").length,
	deleted: results.filter((row) => row.operation === "delete").length,
});

export const reconciliationSummary =
	(upserted: number) =>
	(results: RelationshipMutationResults): RelationshipReconciliationSummary => ({
		...summarizeRelationshipMutations(results),
		upserted,
	});

export const prepareChangeUserBatch = (
	userId: UserId,
	batch: ChangeUserRelationshipBatch,
	index: number,
	command: LifecycleCommand,
) =>
	prepareProjectedRelationshipMutations(
		Effect.gen(function* () {
			const mutations = yield* Effect.forEach(
				[
					...batch.creates.map((input) => ({
						input,
						mode: "upsert" as const,
						properties: input.properties,
					})),
					...batch.deletes.map((input) => ({
						input,
						properties: undefined,
						mode: "delete" as const,
					})),
				],
				(change) =>
					Effect.gen(function* () {
						const definition = yield* validateUserIdentity(userId, change.input);
						const input = {
							...change.input,
							userId,
							scope: "user" as const,
							relationshipSchemaPluginId: definition.pluginId ?? null,
						};
						return {
							input,
							mode: change.mode,
							properties: change.properties,
							propertiesSchema: definition.propertiesSchema,
							schemaFingerprint: catalogDefinitionFingerprint(definition),
							command: itemCommand(command, input, `batch:${index}:${change.mode}`),
						};
					}),
			);
			return yield* prepareRelationshipMutations(mutations);
		}),
		summarizeRelationshipMutations,
	);

export const changeUserRelationships = Effect.fn("RelationshipsService.changeUser")(function* (
	userId: UserId,
	batches: ReadonlyArray<ChangeUserRelationshipBatch>,
	command: LifecycleCommand,
) {
	const execution = yield* LifecycleExecution;
	return yield* Effect.forEach(batches, (batch, index) =>
		runLifecycleWriteInline(execution, {
			applyPolicies: applyRelationshipPolicies,
			prepare: prepareChangeUserBatch(userId, batch, index, command),
			commit: (pending) =>
				commitProjectedRelationshipMutations(pending, summarizeRelationshipMutations),
		}).pipe(
			Effect.map(({ result, warnings }): RelationshipBatchResult => ({ ...result, warnings })),
		),
	);
});

export const prepareReconcileGlobalGroup = (
	group: ReconcileGlobalRelationshipGroup,
	index: number,
	command: LifecycleCommand,
) =>
	prepareProjectedRelationshipMutations(
		Effect.gen(function* () {
			const runtime = yield* PluginRuntimeResolver;
			const repository = yield* RelationshipsRepository;
			const database = yield* Database;
			const definition = (yield* runtime.getGlobalDefinitions()).relationshipSchemas[
				group.relationshipSchemaSlug
			];
			if (!definition) {
				return yield* new RelationshipNotFound({
					reason: {
						code: "relationship-schema-not-found",
						relationshipSchemaSlug: group.relationshipSchemaSlug,
					},
				});
			}
			const selector = {
				...group.selector,
				relationshipSchemaSlug: group.relationshipSchemaSlug,
				relationshipSchemaPluginId: definition.pluginId ?? null,
			};
			const seen = new Set<string>();
			for (const relationship of group.relationships) {
				let matches = relationship.sourceEntityId === relationship.targetEntityId;
				if (group.selector.type === "anchored") {
					matches =
						group.selector.direction === "outgoing"
							? relationship.sourceEntityId === group.selector.anchorEntityId
							: relationship.targetEntityId === group.selector.anchorEntityId;
				}
				if (!matches) {
					return yield* new RelationshipBadRequest({
						reason: { code: "reconciliation-selector-mismatch" },
					});
				}
				const key = relationshipKey(relationship);
				if (seen.has(key)) {
					return yield* new RelationshipBadRequest({
						reason: { code: "duplicate-reconciliation-relationship" },
					});
				}
				seen.add(key);
			}
			const existing = yield* mapDatabaseErrors(
				database.transaction((tx) =>
					repository.listGlobalRelationships(selector).pipe(Effect.provideService(Database, tx)),
				),
			);
			const mutations = [
				...group.relationships.map((input) => ({ input, mode: "upsert" as const })),
				...existing
					.filter((input) => !seen.has(relationshipKey(input)))
					.map((input) => ({ input, mode: "delete" as const })),
			].map((change) => {
				const input = {
					...change.input,
					scope: "global" as const,
					relationshipSchemaSlug: group.relationshipSchemaSlug,
					relationshipSchemaPluginId: definition.pluginId ?? null,
				};
				return {
					input,
					mode: change.mode,
					properties: change.input.properties,
					propertiesSchema: definition.propertiesSchema,
					schemaFingerprint: catalogDefinitionFingerprint(definition),
					command: itemCommand(command, input, `group:${index}:${change.mode}`),
				};
			});
			return yield* prepareRelationshipMutations(mutations, selector, existing);
		}),
		reconciliationSummary(group.relationships.length),
	);

export const reconcileGlobalRelationships = Effect.fn("RelationshipsService.reconcileGlobal")(
	function* (groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>, command: LifecycleCommand) {
		yield* assertRootTransaction;
		const execution = yield* LifecycleExecution;
		return yield* Effect.forEach(groups, (group, index) =>
			runLifecycleWriteInline(execution, {
				applyPolicies: applyRelationshipPolicies,
				prepare: prepareReconcileGlobalGroup(group, index, command),
				commit: (pending) =>
					commitProjectedRelationshipMutations(
						pending,
						reconciliationSummary(group.relationships.length),
					),
			}).pipe(
				Effect.map(({ result, warnings }) => ({
					warnings,
					created: result.created,
					updated: result.updated,
					deleted: result.deleted,
					upserted: result.upserted,
				})),
			),
		);
	},
);
