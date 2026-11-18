import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRelationshipRequestPayload,
	AutomationRelationshipSnapshot,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
	RelationshipScope,
} from "@ryot-app/contract/modules/relationships/schemas";
import { RelationshipId, type UserId } from "@ryot-app/contract/schema/brands";
import type { RelationshipSchemaDefinition } from "@ryot-app/definitions/snapshot";
import { Context, Effect, Layer, Schema } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { LifecyclePolicies, LifecyclePolicy } from "#modules/automations/lifecycle/policies";
import type { LifecycleCommittedStep } from "#modules/automations/lifecycle/write-step";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainWriteChecks } from "#modules/entities/write-context";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";

import {
	makeRelationshipMutationPrimitives,
	mutationWriteCheck,
	relationshipPopulation,
	type ValidatedMutation,
} from "./mutation-primitives";
import {
	equal,
	type Mutation,
	recordRelationshipImportItem,
	RelationshipMutation,
	relationshipSchemaReference,
	rootTransaction,
	rootTransactionGuard,
	snapshot,
} from "./mutation-support";
import { makePlannedRelationshipReconciliation } from "./planned-reconciliation";
import { makePreparedRelationshipMutations } from "./prepared-mutations";
import {
	GlobalRelationshipListInput,
	relationshipMutationLockKey,
	RelationshipsRepository,
} from "./repository";

const PlannedRelationshipMutation = Schema.Struct({
	mutation: RelationshipMutation,
	policies: Schema.Array(LifecyclePolicy),
	trigger: Schema.NullOr(AutomationTrigger),
	before: Schema.NullOr(AutomationRelationshipSnapshot),
	request: Schema.NullOr(AutomationRelationshipRequestPayload),
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
	operation: Schema.Literals(["create", "update", "delete", "noop"]),
	relationship: Schema.NullOr(
		Schema.Struct({ ...RelationshipScope.fields, updatedAt: Schema.String }),
	),
});
export type RelationshipSingleResult = typeof RelationshipSingleResult.Type;

type RelationshipCommitShape<Result> = {
	readonly summarize: (
		pending: PendingRelationshipMutations,
		outcomes: ReadonlyArray<RelationshipSingleResult>,
	) => Effect.Effect<Result>;
};

export class RelationshipMutationPipeline extends Context.Service<RelationshipMutationPipeline>()(
	"@ryot-app/kernel-backend/modules/relationships/mutation-pipeline/RelationshipMutationPipeline",
	{
		make: Effect.gen(function* () {
			const repository = yield* RelationshipsRepository;
			const entities = yield* EntitiesRepository;
			const runtime = yield* PluginRuntimeResolver;
			const definitions = yield* DefinitionRepository;
			const session = yield* DatabaseSession;
			const writes = yield* DomainWriteChecks;
			const planner = yield* LifecyclePlanner;
			const execution = yield* LifecycleExecution;
			const policies = yield* LifecyclePolicies;
			const assetReferences = yield* ManagedAssetReferenceLocker.make;
			const keys = yield* IdempotencyKeys.make;
			const admission = yield* AccountAdmission.make;
			const dependencies = {
				keys,
				writes,
				session,
				planner,
				runtime,
				entities,
				policies,
				admission,
				execution,
				repository,
				definitions,
				assetReferences,
			};
			const transaction = rootTransaction(session);
			const primitives = makeRelationshipMutationPrimitives(dependencies);
			const assertRootTransaction = rootTransactionGuard(session);
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

			const planMutationsInTransaction = Effect.fn("RelationshipsService.planMutations")(function* (
				mutations: ReadonlyArray<Mutation>,
				selector: null | GlobalRelationshipListInput = null,
				expectedSelection: null | ReadonlyArray<{ id: RelationshipId }> = null,
			) {
				const pinOf = yield* primitives.verifyWrites(mutations.map(mutationWriteCheck));
				const ordered = [...mutations].sort((left, right) =>
					relationshipMutationLockKey(left.input).localeCompare(
						relationshipMutationLockKey(right.input),
					),
				);
				const scope = {
					selector,
					expectedSelection: expectedSelection?.map(({ id }) => id) ?? null,
				};
				if (ordered.length > 0) {
					yield* lockMutations(scope, ordered);
				}
				const reads = yield* primitives.readEntities(ordered);
				const rows = yield* repository.findRelationships(ordered.map(({ input }) => input));
				const planned = yield* Effect.forEach(ordered, (mutation) =>
					Effect.gen(function* () {
						const { input, command } = mutation;
						const unplanned = { mutation, policies: [], request: null, trigger: null };
						const row = rows.get(relationshipMutationLockKey(input));
						const before = row ? yield* snapshot(row) : null;
						const validated = yield* primitives.validateMutation(mutation, reads, pinOf(mutation));
						const request = yield* primitives.prepareRequest(mutation, before, validated);
						if (!request) {
							return { ...unplanned, before, validated };
						}
						const trigger = yield* lifecycleTrigger(
							command,
							input.scope === "user" ? input.userId : null,
							request,
						);
						return {
							before,
							request,
							trigger,
							mutation,
							validated,
							policies: yield* policies.match(trigger),
						};
					}),
				);
				const pending = {
					...scope,
					items: planned.map(({ validated: _validated, ...item }) => item),
				} satisfies PendingRelationshipMutations;
				return {
					pending,
					planned: { pinOf, validated: planned.map(({ validated }) => validated) },
				};
			});

			const applyPolicies = Effect.fn("RelationshipsService.applyPolicies")(function* (
				pending: PendingRelationshipMutations,
			) {
				const items = yield* Effect.forEach(pending.items, (item) =>
					Effect.gen(function* () {
						if (!item.request || !item.trigger) {
							return item;
						}
						const request = yield* primitives.applyPolicies(
							item.request,
							{ trigger: item.trigger, policies: item.policies },
							item.mutation,
						);
						return { ...item, request };
					}),
				);
				return { ...pending, items } satisfies PendingRelationshipMutations;
			});

			const singleShape = {
				summarize: Effect.fnUntraced(function* (
					_pending: PendingRelationshipMutations,
					outcomes: ReadonlyArray<RelationshipSingleResult>,
				) {
					const [single] = outcomes;
					if (!single || outcomes.length !== 1) {
						return yield* Effect.die("Expected one relationship mutation");
					}
					return single;
				}),
			} satisfies RelationshipCommitShape<RelationshipSingleResult>;
			const commitMutationsInTransaction = Effect.fn(
				"RelationshipsService.commitMutationsInTransaction",
			)(function* <Result>(
				shape: RelationshipCommitShape<Result>,
				pending: PendingRelationshipMutations,
				planned?: {
					readonly validated: ReadonlyArray<null | ValidatedMutation>;
					readonly pinOf: Effect.Success<ReturnType<typeof primitives.verifyWrites>>;
				},
			) {
				const pinOf =
					planned?.pinOf ??
					(yield* primitives.verifyWrites(
						pending.items.map(({ mutation }) => mutationWriteCheck(mutation)),
					));
				if (pending.items.length > 0) {
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
				const reads = yield* primitives.readEntities(
					pending.items.flatMap(({ mutation }, index) =>
						planned?.validated[index] ? [] : [mutation],
					),
				);
				const userCatalogs = new Map<
					UserId,
					Readonly<Record<string, RelationshipSchemaDefinition>>
				>();
				const globalSchemas = new Map<string, null | RelationshipSchemaDefinition>();
				const revalidated = yield* Effect.forEach(pending.items, (item, index) =>
					Effect.gen(function* () {
						const { request, mutation } = item;
						const validated =
							planned?.validated[index] ??
							(yield* primitives.validateMutation(mutation, reads, pinOf(mutation)));
						if (request !== null && request.operation !== "delete" && !mutation.schemaFingerprint) {
							return yield* new RelationshipBadRequest({
								reason: { code: "concurrent-relationship-change" },
							});
						}
						if (request === null || request.operation === "delete") {
							return { ...item, validated };
						}
						const reference = relationshipSchemaReference(mutation.input);
						const key = definitionKey("relationship", reference.owner, reference.slug);
						let definition: null | undefined | RelationshipSchemaDefinition;
						if (mutation.input.scope === "user") {
							const userId = mutation.input.userId;
							let catalog = userCatalogs.get(userId);
							if (!catalog) {
								catalog = yield* definitions.findUserRelationshipSchemas(
									userId,
									pending.items.flatMap(({ mutation: candidate }) =>
										candidate.input.scope === "user" && candidate.input.userId === userId
											? [relationshipSchemaReference(candidate.input)]
											: [],
									),
								);
								userCatalogs.set(userId, catalog);
							}
							definition = catalog[key];
						} else {
							if (!globalSchemas.has(key)) {
								globalSchemas.set(key, yield* definitions.findGlobalRelationshipSchema(reference));
							}
							definition = globalSchemas.get(key);
						}
						return {
							...item,
							validated,
							request: yield* primitives.revalidateRequest(mutation, request, validated, {
								definition,
							}),
						};
					}),
				);
				const persisted = yield* primitives.persistSources(revalidated);
				const results = [];
				for (const [index, item] of pending.items.entries()) {
					const { command } = item.mutation;
					const source = persisted[index];
					if (!source) {
						return yield* Effect.die("Missing persisted relationship source");
					}
					const { payload, ...result } = source;
					yield* recordRelationshipImportItem(keys, item.mutation, result.operation);
					if (!payload) {
						results.push({ ...result, dispatch: [] });
						continue;
					}
					results.push({
						...result,
						pending: { index, payload, command, mutation: item.mutation },
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
						const { index, payload, command, mutation } = result.pending;
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
							population,
						});
						if (decision) {
							yield* planner.recordBatchChange(decision.id, {
								index,
								payload: change,
								scopeUserId: mutation.input.scope === "user" ? mutation.input.userId : null,
							});
						}
						return { dispatch, operation: result.operation, relationship: result.relationship };
					}),
				);
				const batch = batchScope === null ? [] : yield* planner.planBatch(batchScope);
				const outcomes = items.map(({ operation, relationship }) => ({ operation, relationship }));
				const result = yield* shape.summarize(pending, outcomes);
				const step = {
					result,
					_tag: "Committed",
					dispatch: [...items.flatMap((item) => item.dispatch), ...batch],
				} satisfies LifecycleCommittedStep<Result>;
				return step;
			});
			const commitMutations = Effect.fn("RelationshipsService.commitMutations")(function* <Result>(
				shape: RelationshipCommitShape<Result>,
				pending: PendingRelationshipMutations,
			) {
				return yield* transaction(commitMutationsInTransaction(shape, pending));
			});

			const prepareMutations = Effect.fn("RelationshipsService.prepareMutations")(function* <
				Result,
			>(
				shape: RelationshipCommitShape<Result>,
				mutations: ReadonlyArray<Mutation>,
				selector?: GlobalRelationshipListInput,
				expectedSelection?: ReadonlyArray<{ id: RelationshipId }>,
			) {
				yield* assertRootTransaction;
				return yield* transaction(
					Effect.gen(function* () {
						const { pending, planned } = yield* planMutationsInTransaction(
							mutations,
							selector ?? null,
							expectedSelection ?? null,
						);
						if (pending.items.some((item) => item.policies.length > 0)) {
							return { pending, _tag: "PoliciesRequired" as const };
						}
						return yield* commitMutationsInTransaction(shape, pending, planned);
					}),
				);
			});

			const commitSingle = (pending: PendingRelationshipMutations) =>
				commitMutations(singleShape, pending);
			const prepareSingle = (mutation: Mutation) => prepareMutations(singleShape, [mutation]);

			return {
				commitSingle,
				applyPolicies,
				prepareSingle,
				...makePreparedRelationshipMutations(dependencies),
				...makePlannedRelationshipReconciliation(dependencies),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
