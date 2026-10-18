import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipBadRequest,
	type RelationshipMutationResult,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import type { RelationshipId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import {
	type LifecycleCommittedStep,
	type LifecyclePreparedStep,
	runLifecycleWriteInline,
} from "#modules/automations/lifecycle/write-step";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { type DomainLifecycleCommand, DomainWriteChecks } from "#modules/entities/write-context";
import {
	type MutationReceiptIdentity,
	mutationReceiptIdentity,
	MutationReceipts,
} from "#modules/mutations/receipts";
import {
	type CatalogDefinitionFingerprint,
	catalogDefinitionFingerprint,
} from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";

import {
	type PendingRelationshipMutations,
	RelationshipMutationPipeline,
	type RelationshipSingleResult,
} from "./mutation-pipeline";
import { classifyRelationshipReceiptConflict } from "./mutation-primitives";
import {
	type ChangeUserRelationshipBatch,
	type CreateRelationshipInput,
	type DeleteRelationshipInput,
	type Mutation,
	type ReconcileGlobalRelationshipGroup,
	relationshipIdentity,
	RelationshipRecordedResult,
	relationshipSchemaReference,
	relationshipWriteFailure,
	rootTransaction,
	rootTransactionGuard,
	type UpdateRelationshipInput,
	type UserRelationshipIdentity,
	validateUserRelationshipEntities,
} from "./mutation-support";
import { type RelationshipIdentityInput, RelationshipsRepository } from "./repository";

export class RelationshipsService extends Context.Service<RelationshipsService>()(
	"RelationshipsService",
	{
		make: Effect.gen(function* () {
			const mutations = yield* RelationshipMutationPipeline;
			const repository = yield* RelationshipsRepository;
			const entities = yield* EntitiesRepository;
			const definitions = yield* DefinitionRepository;
			const session = yield* DatabaseSession;
			const writes = yield* DomainWriteChecks;
			const planner = yield* LifecyclePlanner;
			const execution = yield* LifecycleExecution;
			const receipts = yield* MutationReceipts.make;
			const transaction = rootTransaction(session);
			const assertRootTransaction = rootTransactionGuard(session);
			const prepareSingle = (
				input: RelationshipIdentityInput,
				command: DomainLifecycleCommand,
				mode: Mutation["mode"],
				properties?: unknown,
				propertiesSchema?: AppSchema,
				schemaFingerprint?: CatalogDefinitionFingerprint,
				receipt?: MutationReceiptIdentity,
			) =>
				mutations.prepareSingle({
					mode,
					input,
					command,
					properties,
					propertiesSchema,
					schemaFingerprint,
					...(receipt ? { receipt } : {}),
				});
			const prepareSingleWithCatalog = Effect.fnUntraced(function* (
				input: RelationshipIdentityInput,
				command: DomainLifecycleCommand,
				mode: Exclude<Mutation["mode"], "delete">,
				properties?: unknown,
			) {
				yield* assertRootTransaction;
				const reference = relationshipSchemaReference(input);
				yield* writes
					.check(command, reference.owner, input.scope === "user" ? input.userId : null)
					.pipe(Effect.mapError(relationshipWriteFailure));
				const replay = yield* mutations.committedReplay(input, command, mode, properties);
				if (replay) {
					const batch = yield* transaction(
						planner.planBatch({
							command,
							resource: "relationship",
							identity: [command.itemIdentity],
						}),
					);
					return {
						_tag: "Committed",
						result: replay.result,
						dispatch: [...replay.dispatch, ...batch],
					} satisfies LifecycleCommittedStep<RelationshipSingleResult>;
				}
				const definition =
					input.scope === "user"
						? (yield* definitions.findUserRelationshipSchemas(input.userId, [reference]))[
								definitionKey("relationship", reference.owner, reference.slug)
							]
						: yield* definitions.findGlobalRelationshipSchema(reference);
				if (!definition) {
					return yield* new RelationshipNotFound({
						reason: { schema: reference, code: "relationship-schema-not-found" },
					});
				}
				const pluginId = definition.pluginId ?? null;
				if (
					!Object.is(input.relationshipSchemaPluginId, undefined) &&
					!Object.is(input.relationshipSchemaPluginId, pluginId)
				) {
					return yield* new RelationshipBadRequest({
						reason: { code: "concurrent-relationship-change" },
					});
				}
				if (input.scope === "user") {
					yield* validateUserRelationshipEntities(
						yield* entities.getEntityScopesForUser(
							[input.sourceEntityId, input.targetEntityId],
							input.userId,
						),
						input,
						definition,
						input.userId,
					);
				}
				return yield* prepareSingle(
					{ ...input, relationshipSchemaPluginId: pluginId },
					command,
					mode,
					properties,
					definition.propertiesSchema,
					catalogDefinitionFingerprint(definition),
				);
			});
			const prepareDeleteUserRelationshipById = Effect.fnUntraced(function* (
				userId: UserId,
				relationshipId: RelationshipId,
				command: DomainLifecycleCommand,
			) {
				yield* assertRootTransaction;
				const identity = mutationReceiptIdentity({
					command,
					ownerUserId: userId,
					scopeUserId: userId,
					commandKind: "relationship:delete-by-id",
					input: { relationshipId, writeContext: command.writeContext },
				});
				const recorded = yield* receipts
					.peek(identity, RelationshipRecordedResult)
					.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
				if (recorded) {
					return {
						result: recorded.result,
						_tag: "Committed" as const,
						dispatch: recorded.dispatch,
					};
				}
				const row = yield* repository.findUserRelationshipById(userId, relationshipId);
				if (row) {
					return yield* prepareSingle(
						{ ...row, userId, scope: "user" },
						command,
						"delete",
						undefined,
						undefined,
						undefined,
						identity,
					);
				}
				const observed = yield* transaction(
					Effect.gen(function* () {
						const replay = yield* receipts
							.lookup(identity, RelationshipRecordedResult)
							.pipe(Effect.mapError(classifyRelationshipReceiptConflict));
						if (replay) {
							return { replay, _tag: "Replayed" as const };
						}
						yield* receipts.insert({
							identity,
							dispatch: [],
							result: { operation: "noop", relationship: null },
						});
						return { _tag: "Missing" as const };
					}),
				);
				return {
					_tag: "Committed",
					dispatch: observed._tag === "Replayed" ? observed.replay.dispatch : [],
					result: {
						operation: observed._tag === "Replayed" ? observed.replay.result.operation : "noop",
						relationship: observed._tag === "Replayed" ? observed.replay.result.relationship : null,
					},
				} satisfies LifecycleCommittedStep<RelationshipSingleResult>;
			});
			const commitSingle = mutations.commitSingle;
			const single = <E>(
				prepare: Effect.Effect<
					LifecyclePreparedStep<RelationshipSingleResult, PendingRelationshipMutations>,
					E
				>,
			) =>
				runLifecycleWriteInline(execution, {
					prepare,
					commit: commitSingle,
					applyPolicies: mutations.applyPolicies,
				}).pipe(
					Effect.map(({ result, warnings }): RelationshipMutationResult => ({
						warnings,
						relationship: result.relationship,
					})),
				);
			const createUser = (
				userId: UserId,
				input: UserRelationshipIdentity & { properties?: unknown },
				command: DomainLifecycleCommand,
			) =>
				single(
					prepareSingleWithCatalog(
						relationshipIdentity({ ...input, userId, scope: "user" }),
						command,
						"upsert",
						input.properties ?? {},
					),
				);
			return {
				createUser,
				commitSingle,
				applyPolicies: mutations.applyPolicies,
				prepareUserCreate: mutations.prepareUserCreate,
				prepareUserDelete: mutations.prepareUserDelete,
				persistPreparedUserCreate: mutations.persistPreparedUserCreate,
				persistPreparedUserDelete: mutations.persistPreparedUserDelete,
				persistPlannedReconciliation: mutations.persistPlannedReconciliation,
				delete: (input: DeleteRelationshipInput, command: DomainLifecycleCommand) =>
					single(prepareSingle(relationshipIdentity(input), command, "delete")),
				reconcileGlobal: (
					groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>,
					command: DomainLifecycleCommand,
				) => mutations.reconcileGlobal(groups, command),
				changeUser: (
					userId: UserId,
					batches: ReadonlyArray<ChangeUserRelationshipBatch>,
					command: DomainLifecycleCommand,
				) => mutations.changeUser(userId, batches, command),
				prepareDeleteUserRelationshipById: (
					userId: UserId,
					relationshipId: RelationshipId,
					command: DomainLifecycleCommand,
				) => prepareDeleteUserRelationshipById(userId, relationshipId, command),
				deleteUserRelationshipById: (
					userId: UserId,
					relationshipId: RelationshipId,
					command: DomainLifecycleCommand,
				) => single(prepareDeleteUserRelationshipById(userId, relationshipId, command)),
				prepareMergeUserProperties: (
					input: { userId: UserId } & CreateRelationshipInput,
					command: DomainLifecycleCommand,
				) =>
					prepareSingleWithCatalog(relationshipIdentity(input), command, "merge", input.properties),
				create: (input: CreateRelationshipInput, command: DomainLifecycleCommand) =>
					single(
						prepareSingleWithCatalog(
							relationshipIdentity(input),
							command,
							"upsert",
							input.properties,
						),
					),
				update: (input: UpdateRelationshipInput, command: DomainLifecycleCommand) =>
					single(
						prepareSingleWithCatalog(
							relationshipIdentity(input),
							command,
							"update",
							input.properties,
						),
					),
				prepareCreate: (input: CreateRelationshipInput, command: DomainLifecycleCommand) =>
					prepareSingleWithCatalog(
						relationshipIdentity(input),
						command,
						input.ifAbsent === true ? "ensure" : "upsert",
						input.properties,
					),
				mergeUserProperties: (
					input: { userId: UserId } & CreateRelationshipInput,
					command: DomainLifecycleCommand,
				) =>
					single(
						prepareSingleWithCatalog(
							relationshipIdentity(input),
							command,
							"merge",
							input.properties,
						),
					),
				prepareReconcileGlobalGroup: (
					group: ReconcileGlobalRelationshipGroup,
					index: number,
					command: DomainLifecycleCommand,
					allGroups?: ReadonlyArray<ReconcileGlobalRelationshipGroup>,
				) => mutations.prepareReconcileGlobalGroup(group, index, command, allGroups),
				prepareChangeUserBatch: (
					userId: UserId,
					batch: ChangeUserRelationshipBatch,
					index: number,
					command: DomainLifecycleCommand,
					allBatches?: ReadonlyArray<ChangeUserRelationshipBatch>,
				) => mutations.prepareChangeUserBatch(userId, batch, index, command, allBatches),
				createFromApi: (
					userId: UserId,
					input: UserRelationshipIdentity & { properties?: unknown },
					command: DomainLifecycleCommand,
				) =>
					input.relationshipSchema.owner.kind === "kernel"
						? Effect.fail(new RelationshipBadRequest({ reason: { code: "kernel-owned-schema" } }))
						: createUser(userId, input, command),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
