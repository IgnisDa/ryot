import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRelationshipSnapshot,
	AutomationRelationshipRequestPayload,
	AutomationTrigger,
	type LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	RelationshipBadRequest,
	RelationshipBatchResult,
	RelationshipNotFound,
	RelationshipReconciliationResult,
	RelationshipScope,
} from "@ryot-app/contract/modules/relationships/schemas";
import { RelationshipId, type UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Effect, Layer, Schema, Struct } from "effect";

import { LifecyclePlannedPolicy, LifecyclePlanner } from "#lib/domain/lifecycle";
import { lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	mapCommittedResult,
	runLifecycleWriteInline,
	type LifecycleCommittedStep,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { RelationshipSchemaDefinition } from "#modules/definition-registry/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	mutationReceiptIdentity,
	mutationReceiptOwner,
	MutationReceiptIdentity,
	MutationReceipts,
} from "#modules/mutations/receipts";
import {
	catalogDefinitionFingerprint,
	PluginRuntimeResolver,
} from "#modules/plugins/runtime-resolver";

import {
	classifyRelationshipReceiptConflict,
	makeRelationshipMutationPrimitives,
	relationshipPopulation,
} from "./mutation-primitives";
import {
	equal,
	itemCommand,
	relationshipReceiptIdentity,
	relationshipKey,
	RelationshipMutation,
	RelationshipRecordedResult,
	rootTransaction,
	rootTransactionGuard,
	snapshot,
	validateUserRelationshipEntities,
	type ChangeUserRelationshipBatch,
	type Mutation,
	type ReconcileGlobalRelationshipGroup,
	type UserRelationshipIdentity,
} from "./mutation-support";
import { makePlannedRelationshipReconciliation } from "./planned-reconciliation";
import { makePreparedRelationshipMutations } from "./prepared-mutations";
import {
	GlobalRelationshipListInput,
	RelationshipsRepository,
	relationshipMutationLockKey,
} from "./repository";

const PlannedRelationshipMutation = Schema.Struct({
	mutation: RelationshipMutation,
	receipt: MutationReceiptIdentity,
	policies: Schema.Array(LifecyclePlannedPolicy),
	recorded: Schema.NullOr(RelationshipRecordedResult),
	requestId: Schema.NullOr(AutomationTrigger.fields.id),
	before: Schema.NullOr(AutomationRelationshipSnapshot),
	request: Schema.NullOr(AutomationRelationshipRequestPayload),
});

export const PendingRelationshipMutations = Schema.Struct({
	rootFinal: Schema.Boolean,
	items: Schema.Array(PlannedRelationshipMutation),
	selector: Schema.NullOr(GlobalRelationshipListInput),
	rootDecision: Schema.NullOr(MutationReceiptIdentity),
	expectedSelection: Schema.NullOr(Schema.Array(RelationshipId)),
	aggregate: Schema.NullOr(
		Schema.Union([
			Schema.Struct({
				receipt: MutationReceiptIdentity,
				kind: Schema.Literal("change-user-batch"),
			}),
			Schema.Struct({
				upserted: Schema.Finite,
				receipt: MutationReceiptIdentity,
				kind: Schema.Literal("reconcile-global-group"),
			}),
		]),
	),
});
export type PendingRelationshipMutations = typeof PendingRelationshipMutations.Type;

export const RelationshipMutationError = Schema.Union([
	RelationshipBadRequest,
	RelationshipNotFound,
	DbError,
]);

export const RelationshipSingleResult = Schema.Struct({
	operation: Schema.Literals(["create", "update", "delete", "noop"]),
	relationship: Schema.NullOr(
		Schema.Struct({ ...RelationshipScope.fields, updatedAt: Schema.String }),
	),
});
type RelationshipMutationResults = ReadonlyArray<
	RelationshipSingleResult & { readonly operation: "create" | "update" | "delete" | "noop" }
>;
export type RelationshipSingleResult = typeof RelationshipSingleResult.Type;

export const projectRelationshipIngestionReceipt = (commandKind: string, result: unknown) =>
	commandKind === "relationship:change-user" || commandKind === "relationship:upsert"
		? Schema.decodeUnknownEffect(RelationshipSingleResult)(result).pipe(
				Effect.map((value) => {
					if (value.operation === "create") {
						return "created" as const;
					}
					if (value.operation === "update") {
						return "updated" as const;
					}
					return "unchanged" as const;
				}),
			)
		: Effect.succeed(null);

export const RelationshipBatchSummary = Schema.Struct(
	Struct.omit(RelationshipBatchResult.fields, ["warnings"]),
);
export type RelationshipBatchSummary = typeof RelationshipBatchSummary.Type;

export const RelationshipReconciliationSummary = Schema.Struct(
	Struct.omit(RelationshipReconciliationResult.fields, ["warnings"]),
);
export type RelationshipReconciliationSummary = typeof RelationshipReconciliationSummary.Type;

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
): RelationshipSingleResult => ({
	operation: results[0]?.operation ?? "noop",
	relationship: results[0]?.relationship ?? null,
});

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

export class RelationshipMutationPipeline extends Context.Service<RelationshipMutationPipeline>()(
	"RelationshipMutationPipeline",
	{
		make: Effect.gen(function* () {
			const repository = yield* RelationshipsRepository;
			const entities = yield* EntitiesRepository;
			const runtime = yield* PluginRuntimeResolver;
			const definitions = yield* DefinitionRepository;
			const session = yield* DatabaseSession;
			const planner = yield* LifecyclePlanner;
			const execution = yield* LifecycleExecution;
			const receipts = yield* MutationReceipts.make;
			const receiptFor = relationshipReceiptIdentity;
			const lookupReceipt = (identity: MutationReceiptIdentity) =>
				receipts
					.lookup(identity, RelationshipRecordedResult)
					.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
			const dependencies = {
				session,
				planner,
				runtime,
				receipts,
				entities,
				execution,
				repository,
				definitions,
			};
			const transaction = rootTransaction(session);
			const primitives = makeRelationshipMutationPrimitives(dependencies);
			const assertRootTransaction = rootTransactionGuard(session);
			const validateUserIdentity = Effect.fnUntraced(function* (
				userId: UserId,
				input: UserRelationshipIdentity,
			) {
				const definition = (yield* definitions.findUserRelationshipSchemas(userId, [
					input.relationshipSchemaSlug,
				]))[input.relationshipSchemaSlug];
				if (!definition) {
					return yield* new RelationshipNotFound({
						reason: {
							code: "relationship-schema-not-found",
							relationshipSchemaSlug: input.relationshipSchemaSlug,
						},
					});
				}
				yield* validateUserRelationshipEntities(entities, userId, input, definition);
				return definition;
			});

			const lockMutations = (
				pending: Pick<PendingRelationshipMutations, "selector" | "expectedSelection">,
				mutations: ReadonlyArray<Mutation>,
			) =>
				Effect.gen(function* () {
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
					yield* primitives.lockMutations(mutations);
					return undefined;
				});

			const skipPlannedPolicies = (pending: PendingRelationshipMutations) =>
				Effect.forEach(
					pending.items,
					({ requestId }) =>
						requestId ? execution.skipQueuedPolicies({ triggerId: requestId }) : Effect.void,
					{ discard: true },
				);

			const planMutationsInTransaction = Effect.fn("RelationshipsService.planMutations")(function* (
				mutations: ReadonlyArray<Mutation>,
				selector: GlobalRelationshipListInput | null = null,
				expectedSelection: ReadonlyArray<{ id: RelationshipId }> | null = null,
				aggregate: PendingRelationshipMutations["aggregate"] = null,
				rootDecision: MutationReceiptIdentity | null = null,
				rootFinal = false,
			) {
				if (rootDecision) {
					yield* receipts
						.beginBatch({ pins: [], maxItems: 0, identity: rootDecision })
						.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
				}
				const ordered = [...mutations].sort((left, right) =>
					relationshipMutationLockKey(left.input).localeCompare(
						relationshipMutationLockKey(right.input),
					),
				);
				const scope = {
					selector,
					expectedSelection: expectedSelection?.map(({ id }) => id) ?? null,
				};
				const prior = yield* Effect.forEach(ordered, (mutation) =>
					lookupReceipt(receiptFor(mutation)),
				);
				if (prior.some((entry) => entry === null)) {
					yield* lockMutations(scope, ordered);
				}
				const planned = yield* Effect.forEach(ordered, (mutation, index) =>
					Effect.gen(function* () {
						const { input, command } = mutation;
						const receipt = receiptFor(mutation);
						const recorded = prior[index];
						const unplanned = {
							receipt,
							mutation,
							policies: [],
							request: null,
							blocked: false,
							requestId: null,
							recorded: recorded?.result ?? null,
						};
						if (recorded) {
							return { ...unplanned, before: null };
						}
						const row = yield* repository.findRelationship(input);
						const before = row ? yield* snapshot(row) : null;
						const request = yield* primitives.prepareRequest(mutation, before);
						if (!request) {
							return { ...unplanned, before };
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
							receipt,
							request,
							mutation,
							recorded: null,
							policies: plan.policies,
							requestId: plan.trigger?.id ?? null,
							blocked: plan.trigger?.blockedReason !== null && plan.trigger !== null,
						};
					}),
				);
				const pending = {
					...scope,
					aggregate,
					rootFinal,
					rootDecision,
					items: planned.map(({ blocked: _blocked, ...item }) => item),
				} satisfies PendingRelationshipMutations;
				return { pending, blocked: planned.some(({ blocked }) => blocked) };
			});

			const applyPolicies = Effect.fn("RelationshipsService.applyPolicies")(function* (
				pending: PendingRelationshipMutations,
			) {
				const items = yield* Effect.forEach(pending.items, (item) =>
					Effect.gen(function* () {
						if (!item.request) {
							return item;
						}
						const request = yield* primitives.applyPolicies(
							item.request,
							item.policies,
							item.mutation,
						);
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

			const commitMutationsInTransaction = Effect.fn(
				"RelationshipsService.commitMutationsInTransaction",
			)(function* (pending: PendingRelationshipMutations) {
				if (pending.aggregate) {
					const aggregate = pending.aggregate;
					const recorded = yield* receipts
						.lookup(
							aggregate.receipt,
							aggregate.kind === "change-user-batch"
								? RelationshipBatchSummary
								: RelationshipReconciliationSummary,
						)
						.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
					if (recorded) {
						const { created, updated, deleted } = recorded.result;
						const operations: RelationshipMutationResults = [
							...Array.from({ length: created }, () => ({
								relationship: null,
								operation: "create" as const,
							})),
							...Array.from({ length: updated }, () => ({
								relationship: null,
								operation: "update" as const,
							})),
							...Array.from({ length: deleted }, () => ({
								relationship: null,
								operation: "delete" as const,
							})),
						];
						if (pending.rootFinal && pending.rootDecision) {
							yield* receipts.sealBatch(pending.rootDecision, []);
						}
						return { result: operations, _tag: "Committed" as const, dispatch: recorded.dispatch };
					}
				}
				const recorded = yield* Effect.forEach(pending.items, (item) =>
					lookupReceipt(item.receipt),
				);
				if (recorded.some((entry) => entry === null)) {
					yield* lockMutations(
						pending,
						pending.items.map(({ mutation }) => mutation),
					);
				}
				const firstCommand = pending.items[0]?.mutation.command;
				const batchScope =
					firstCommand === undefined
						? null
						: {
								command: firstCommand,
								resource: "relationship" as const,
								identity: pending.items.map(({ mutation }) => mutation.command.itemIdentity),
							};
				const decision =
					batchScope === null
						? null
						: yield* planner.prepareBatch({
								...batchScope,
								scopes: pending.items.map(({ mutation }) =>
									mutation.input.scope === "user" ? mutation.input.userId : null,
								),
							});
				let revalidated = pending.items;
				if (
					pending.items.some(
						({ request }, index) =>
							recorded[index] === null && request !== null && request.operation !== "delete",
					)
				) {
					yield* runtime.lockCatalog();
					const userCatalogs = new Map<
						UserId,
						Readonly<Record<string, RelationshipSchemaDefinition>>
					>();
					const globalSchemas = new Map<string, RelationshipSchemaDefinition | null>();
					revalidated = yield* Effect.forEach(pending.items, (item, index) =>
						Effect.gen(function* () {
							const { mutation } = item;
							if (recorded[index] || item.request === null || item.request.operation === "delete") {
								return item;
							}
							const expected = mutation.schemaFingerprint;
							if (!expected) {
								return yield* new RelationshipBadRequest({
									reason: { code: "concurrent-relationship-change" },
								});
							}
							const slug = mutation.input.relationshipSchemaSlug;
							let definition: RelationshipSchemaDefinition | null | undefined;
							if (mutation.input.scope === "user") {
								const userId = mutation.input.userId;
								let catalog = userCatalogs.get(userId);
								if (!catalog) {
									catalog = yield* definitions.findUserRelationshipSchemas(
										userId,
										pending.items.flatMap(({ mutation: candidate }) =>
											candidate.input.scope === "user" && candidate.input.userId === userId
												? [candidate.input.relationshipSchemaSlug]
												: [],
										),
									);
									userCatalogs.set(userId, catalog);
								}
								definition = catalog[slug];
							} else {
								if (!globalSchemas.has(slug)) {
									globalSchemas.set(slug, yield* definitions.findGlobalRelationshipSchema(slug));
								}
								definition = globalSchemas.get(slug);
							}
							return {
								...item,
								request: yield* primitives.revalidateRequest(mutation, item.request, {
									definition,
								}),
							};
						}),
					);
				}
				const results = [];
				for (const [index, item] of revalidated.entries()) {
					const { command } = item.mutation;
					const { request, requestId } = item;
					const replay = recorded[index];
					if (replay) {
						results.push({ ...replay.result, dispatch: replay.dispatch });
						continue;
					}
					const { payload, ...result } = yield* primitives.persistSource(
						item.mutation,
						request,
						item.before,
					);
					if (!payload) {
						yield* primitives.recordResult({
							index,
							result,
							dispatch: [],
							batch: decision,
							identity: item.receipt,
						});
						results.push({ ...result, dispatch: [] });
						continue;
					}
					results.push({
						...result,
						pending: {
							index,
							payload,
							command,
							requestId,
							receipt: item.receipt,
							mutation: item.mutation,
						},
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
						const { index, payload, command, receipt, mutation, requestId } = result.pending;
						const population = relationshipPopulation(
							command,
							counts,
							beforeCount,
							changedIndex === 0,
						);
						changedIndex += 1;
						const { change, dispatch } = yield* primitives.planChange({
							payload,
							mutation,
							requestId,
							population,
						});
						yield* primitives.recordResult({
							index,
							dispatch,
							batch: decision,
							evidence: change,
							identity: receipt,
							result: { operation: result.operation, relationship: result.relationship },
						});
						return { dispatch, operation: result.operation, relationship: result.relationship };
					}),
				);
				const batch = batchScope === null ? [] : yield* planner.planBatch(batchScope);
				const committed = { items, batch };
				const step = {
					_tag: "Committed",
					dispatch: [...committed.items.flatMap((item) => item.dispatch), ...committed.batch],
					result: committed.items.map(({ operation, relationship }) => ({
						operation,
						relationship,
					})),
				} satisfies LifecycleCommittedStep<RelationshipMutationResults>;
				if (pending.aggregate) {
					const result =
						pending.aggregate.kind === "change-user-batch"
							? summarizeRelationshipMutations(step.result)
							: reconciliationSummary(pending.aggregate.upserted)(step.result);
					yield* receipts.insert({
						result,
						dispatch: step.dispatch,
						identity: pending.aggregate.receipt,
					});
				}
				if (pending.rootFinal && pending.rootDecision) {
					yield* receipts.sealBatch(pending.rootDecision, []);
				}
				return step;
			});
			const commitMutations = Effect.fn("RelationshipsService.commitMutations")(
				(pending: PendingRelationshipMutations) =>
					transaction(commitMutationsInTransaction(pending)),
			);

			const prepareMutations = Effect.fn("RelationshipsService.prepareMutations")(function* (
				mutations: ReadonlyArray<Mutation>,
				selector?: GlobalRelationshipListInput,
				expectedSelection?: ReadonlyArray<{ id: RelationshipId }>,
				aggregate: PendingRelationshipMutations["aggregate"] = null,
				rootDecision: MutationReceiptIdentity | null = null,
				rootFinal = false,
			) {
				yield* assertRootTransaction;
				const step = yield* transaction(
					Effect.gen(function* () {
						const { pending, blocked } = yield* planMutationsInTransaction(
							mutations,
							selector ?? null,
							expectedSelection ?? null,
							aggregate,
							rootDecision,
							rootFinal,
						);
						if (blocked) {
							return { pending, _tag: "Blocked" as const };
						}
						if (pending.items.some(({ policies }) => policies.length > 0)) {
							return { pending, _tag: "PoliciesRequired" as const };
						}
						return yield* commitMutationsInTransaction(pending);
					}),
				);
				if (step._tag === "Blocked") {
					return yield* skipPlannedPolicies(step.pending).pipe(
						Effect.andThen(
							new RelationshipBadRequest({ reason: { code: "automation-limit-reached" } }),
						),
						Effect.uninterruptible,
					);
				}
				return step;
			});

			const commitProjected = <Result>(
				pending: PendingRelationshipMutations,
				project: (results: RelationshipMutationResults) => Result,
			) =>
				commitMutations(pending).pipe(
					Effect.map((step): LifecyclePreparedStep<Result, PendingRelationshipMutations> => ({
						...step,
						result: project(step.result),
					})),
				);

			const prepareChangeUserBatch = (
				userId: UserId,
				batch: ChangeUserRelationshipBatch,
				index: number,
				command: LifecycleCommand,
				allBatches: ReadonlyArray<ChangeUserRelationshipBatch> = [batch],
			) => {
				const rootDecision = mutationReceiptIdentity({
					command,
					input: allBatches,
					ownerUserId: userId,
					scopeUserId: userId,
					commandKind: "relationship:change-user",
				});
				const rootFinal = index === allBatches.length - 1;
				return Effect.gen(function* () {
					yield* receipts
						.peekBatch(rootDecision)
						.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
					const aggregate = mutationReceiptIdentity({
						input: batch,
						ownerUserId: userId,
						scopeUserId: userId,
						commandKind: "relationship:change-user-batch",
						command: { ...command, itemIdentity: `${command.itemIdentity}:batch:${index}` },
					});
					const replay = yield* receipts
						.peek(aggregate, RelationshipBatchSummary)
						.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
					if (replay) {
						return { result: replay.result, dispatch: replay.dispatch, _tag: "Committed" as const };
					}
					return yield* prepareProjectedRelationshipMutations(
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
							return yield* prepareMutations(
								mutations,
								undefined,
								undefined,
								{ receipt: aggregate, kind: "change-user-batch" },
								rootDecision,
								rootFinal,
							);
						}),
						summarizeRelationshipMutations,
					);
				});
			};

			const changeUser = Effect.fn("RelationshipsService.changeUser")(function* (
				userId: UserId,
				batches: ReadonlyArray<ChangeUserRelationshipBatch>,
				command: LifecycleCommand,
			) {
				const rootDecision = mutationReceiptIdentity({
					command,
					input: batches,
					ownerUserId: userId,
					scopeUserId: userId,
					commandKind: "relationship:change-user",
				});
				yield* receipts
					.peekBatch(rootDecision)
					.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
				if (batches.length === 0) {
					yield* transaction(
						Effect.gen(function* () {
							yield* receipts.beginBatch({ pins: [], maxItems: 0, identity: rootDecision });
							yield* receipts.sealBatch(rootDecision, []);
						}),
					);
					return [];
				}
				return yield* Effect.forEach(batches, (batch, index) =>
					runLifecycleWriteInline(execution, {
						applyPolicies,
						prepare: prepareChangeUserBatch(userId, batch, index, command, batches),
						commit: (pending) => commitProjected(pending, summarizeRelationshipMutations),
					}).pipe(
						Effect.map(({ result, warnings }): RelationshipBatchResult => ({
							...result,
							warnings,
						})),
					),
				);
			});

			const prepareReconcileGlobalGroup = (
				group: ReconcileGlobalRelationshipGroup,
				index: number,
				command: LifecycleCommand,
				allGroups: ReadonlyArray<ReconcileGlobalRelationshipGroup> = [group],
			) => {
				const rootDecision = mutationReceiptIdentity({
					command,
					input: allGroups,
					scopeUserId: null,
					commandKind: "relationship:reconcile-global",
					ownerUserId: mutationReceiptOwner(command, null),
				});
				const rootFinal = index === allGroups.length - 1;
				return Effect.gen(function* () {
					yield* receipts
						.peekBatch(rootDecision)
						.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
					const aggregate = mutationReceiptIdentity({
						input: group,
						scopeUserId: null,
						commandKind: "relationship:reconcile-group",
						ownerUserId: mutationReceiptOwner(command, null),
						command: { ...command, itemIdentity: `${command.itemIdentity}:group:${index}` },
					});
					const replay = yield* receipts
						.peek(aggregate, RelationshipReconciliationSummary)
						.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
					if (replay) {
						return { result: replay.result, dispatch: replay.dispatch, _tag: "Committed" as const };
					}
					return yield* prepareProjectedRelationshipMutations(
						Effect.gen(function* () {
							const definition = yield* definitions.findGlobalRelationshipSchema(
								group.relationshipSchemaSlug,
							);
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
							const existing = yield* session.transaction(
								repository.listGlobalRelationships(selector),
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
							return yield* prepareMutations(
								mutations,
								selector,
								existing,
								{
									receipt: aggregate,
									kind: "reconcile-global-group",
									upserted: group.relationships.length,
								},
								rootDecision,
								rootFinal,
							);
						}),
						reconciliationSummary(group.relationships.length),
					);
				});
			};

			const reconcileGlobal = Effect.fn("RelationshipsService.reconcileGlobal")(function* (
				groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>,
				command: LifecycleCommand,
			) {
				yield* assertRootTransaction;
				const rootDecision = mutationReceiptIdentity({
					command,
					input: groups,
					scopeUserId: null,
					commandKind: "relationship:reconcile-global",
					ownerUserId: mutationReceiptOwner(command, null),
				});
				yield* receipts
					.peekBatch(rootDecision)
					.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
				if (groups.length === 0) {
					yield* transaction(
						Effect.gen(function* () {
							yield* receipts.beginBatch({ pins: [], maxItems: 0, identity: rootDecision });
							yield* receipts.sealBatch(rootDecision, []);
						}),
					);
					return [];
				}
				return yield* Effect.forEach(groups, (group, index) =>
					runLifecycleWriteInline(execution, {
						applyPolicies,
						prepare: prepareReconcileGlobalGroup(group, index, command, groups),
						commit: (pending) =>
							commitProjected(pending, reconciliationSummary(group.relationships.length)),
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
			});
			return {
				changeUser,
				applyPolicies,
				commitProjected,
				reconcileGlobal,
				prepareMutations,
				prepareChangeUserBatch,
				prepareReconcileGlobalGroup,
				...makePreparedRelationshipMutations(dependencies),
				...makePlannedRelationshipReconciliation(dependencies),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
