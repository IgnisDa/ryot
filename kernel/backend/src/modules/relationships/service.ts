import {
	RelationshipBadRequest,
	RelationshipNotFound,
	type RelationshipMutationResult,
} from "@ryot-app/contract/modules/relationships/schemas";
import type { RelationshipId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { LifecyclePlanner, toLifecycleDispatchPlan } from "#lib/domain/lifecycle";
import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	runLifecycleWriteInline,
	type LifecycleCommittedStep,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	catalogDefinitionFingerprint,
	type CatalogDefinitionFingerprint,
} from "#modules/plugins/runtime-resolver";

import {
	prepareProjectedRelationshipMutations,
	reconciliationSummary,
	RelationshipMutationPipeline,
	singleRelationshipResult,
	summarizeRelationshipMutations,
	type PendingRelationshipMutations,
	type RelationshipSingleResult,
} from "./mutation-pipeline";
import {
	rootTransaction,
	rootTransactionGuard,
	validateUserRelationshipEntities,
	type ChangeUserRelationshipBatch,
	type CreateRelationshipInput,
	type Mutation,
	type ReconcileGlobalRelationshipGroup,
	type UpdateRelationshipInput,
	type UserRelationshipIdentity,
} from "./mutation-support";
import { RelationshipsRepository, type RelationshipIdentityInput } from "./repository";

export class RelationshipsService extends Context.Service<RelationshipsService>()(
	"RelationshipsService",
	{
		make: Effect.gen(function* () {
			const mutations = yield* RelationshipMutationPipeline;
			const repository = yield* RelationshipsRepository;
			const entities = yield* EntitiesRepository;
			const definitions = yield* DefinitionRepository;
			const session = yield* DatabaseSession;
			const planner = yield* LifecyclePlanner;
			const execution = yield* LifecycleExecution;
			const transaction = rootTransaction(session);
			const assertRootTransaction = rootTransactionGuard(session);
			const prepareSingle = (
				input: RelationshipIdentityInput,
				command: LifecycleCommand,
				mode: Mutation["mode"],
				properties?: unknown,
				propertiesSchema?: AppSchema,
				schemaFingerprint?: CatalogDefinitionFingerprint,
			) =>
				prepareProjectedRelationshipMutations(
					mutations.prepareMutations([
						{ mode, input, command, properties, propertiesSchema, schemaFingerprint },
					]),
					singleRelationshipResult,
				);
			const prepareSingleWithCatalog = Effect.fnUntraced(function* (
				input: RelationshipIdentityInput,
				command: LifecycleCommand,
				mode: Exclude<Mutation["mode"], "delete">,
				properties?: unknown,
			) {
				yield* assertRootTransaction;
				const replay = yield* mutations.committedReplay(input, command, mode, properties);
				if (replay) {
					const batch = yield* transaction(
						planner.planBatch({
							command,
							plans: [replay.plan],
							resource: "relationship",
							identity: [command.itemIdentity],
						}),
					);
					return {
						_tag: "Committed",
						result: { relationship: replay.relationship },
						dispatch: [replay.plan, ...batch].map(toLifecycleDispatchPlan),
					} satisfies LifecycleCommittedStep<RelationshipSingleResult>;
				}
				const definition =
					input.scope === "user"
						? (yield* definitions.findUserRelationshipSchemas(input.userId, [
								input.relationshipSchemaSlug,
							]))[input.relationshipSchemaSlug]
						: yield* definitions.findGlobalRelationshipSchema(input.relationshipSchemaSlug);
				if (!definition) {
					return yield* new RelationshipNotFound({
						reason: {
							code: "relationship-schema-not-found",
							relationshipSchemaSlug: input.relationshipSchemaSlug,
						},
					});
				}
				const pluginId = definition.pluginId ?? null;
				if (
					input.relationshipSchemaPluginId !== undefined &&
					input.relationshipSchemaPluginId !== pluginId
				) {
					return yield* new RelationshipBadRequest({
						reason: { code: "concurrent-relationship-change" },
					});
				}
				if (input.scope === "user") {
					yield* validateUserRelationshipEntities(entities, input.userId, input, definition);
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
				command: LifecycleCommand,
			) {
				const row = yield* repository.findUserRelationshipById(userId, relationshipId);
				if (!row) {
					return {
						dispatch: [],
						_tag: "Committed",
						result: { relationship: null },
					} satisfies LifecycleCommittedStep<RelationshipSingleResult>;
				}
				return yield* prepareSingle({ ...row, userId, scope: "user" }, command, "delete");
			});
			const commitSingle = (pending: PendingRelationshipMutations) =>
				mutations.commitProjected(pending, singleRelationshipResult);
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
			return {
				commitSingle,
				applyPolicies: mutations.applyPolicies,
				prepareUserCreate: mutations.prepareUserCreate,
				prepareUserDelete: mutations.prepareUserDelete,
				persistPreparedUserCreate: mutations.persistPreparedUserCreate,
				persistPreparedUserDelete: mutations.persistPreparedUserDelete,
				persistPlannedReconciliation: mutations.persistPlannedReconciliation,
				delete: (input: RelationshipIdentityInput, command: LifecycleCommand) =>
					single(prepareSingle(input, command, "delete")),
				commitBatch: (pending: PendingRelationshipMutations) =>
					mutations.commitProjected(pending, summarizeRelationshipMutations),
				prepareCreate: (input: CreateRelationshipInput, command: LifecycleCommand) =>
					prepareSingleWithCatalog(input, command, "upsert", input.properties),
				create: (input: CreateRelationshipInput, command: LifecycleCommand) =>
					single(prepareSingleWithCatalog(input, command, "upsert", input.properties)),
				update: (input: UpdateRelationshipInput, command: LifecycleCommand) =>
					single(prepareSingleWithCatalog(input, command, "update", input.properties)),
				commitReconciliation: (pending: PendingRelationshipMutations, upserted: number) =>
					mutations.commitProjected(pending, reconciliationSummary(upserted)),
				reconcileGlobal: (
					groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>,
					command: LifecycleCommand,
				) => mutations.reconcileGlobal(groups, command),
				changeUser: (
					userId: UserId,
					batches: ReadonlyArray<ChangeUserRelationshipBatch>,
					command: LifecycleCommand,
				) => mutations.changeUser(userId, batches, command),
				prepareMergeUserProperties: (
					input: CreateRelationshipInput & { userId: UserId },
					command: LifecycleCommand,
				) => prepareSingleWithCatalog(input, command, "merge", input.properties),
				mergeUserProperties: (
					input: CreateRelationshipInput & { userId: UserId },
					command: LifecycleCommand,
				) => single(prepareSingleWithCatalog(input, command, "merge", input.properties)),
				prepareReconcileGlobalGroup: (
					group: ReconcileGlobalRelationshipGroup,
					index: number,
					command: LifecycleCommand,
				) => mutations.prepareReconcileGlobalGroup(group, index, command),
				prepareDeleteUserRelationshipById: (
					userId: UserId,
					relationshipId: RelationshipId,
					command: LifecycleCommand,
				) => prepareDeleteUserRelationshipById(userId, relationshipId, command),
				deleteUserRelationshipById: (
					userId: UserId,
					relationshipId: RelationshipId,
					command: LifecycleCommand,
				) => single(prepareDeleteUserRelationshipById(userId, relationshipId, command)),
				prepareChangeUserBatch: (
					userId: UserId,
					batch: ChangeUserRelationshipBatch,
					index: number,
					command: LifecycleCommand,
				) => mutations.prepareChangeUserBatch(userId, batch, index, command),
				createUser: (
					userId: UserId,
					input: UserRelationshipIdentity & { properties?: unknown },
					command: LifecycleCommand,
				) =>
					single(
						prepareSingleWithCatalog(
							{ ...input, userId, scope: "user" },
							command,
							"upsert",
							input.properties ?? {},
						),
					),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
