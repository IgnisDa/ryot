import { PgClient } from "@effect/sql-pg";
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
import {
	runLifecycleWriteInline,
	type LifecycleCommittedStep,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import {
	catalogDefinitionFingerprint,
	type CatalogDefinitionFingerprint,
	PluginRuntimeResolver,
} from "#modules/plugins/runtime-resolver";

import {
	applyRelationshipPolicies,
	changeUserRelationships,
	commitProjectedRelationshipMutations,
	prepareChangeUserBatch,
	prepareProjectedRelationshipMutations,
	prepareReconcileGlobalGroup,
	prepareRelationshipMutations,
	reconcileGlobalRelationships,
	reconciliationSummary,
	singleRelationshipResult,
	summarizeRelationshipMutations,
	type PendingRelationshipMutations,
	type RelationshipSingleResult,
} from "./mutation-pipeline";
import {
	assertRootTransaction,
	transaction,
	validateUserRelationshipEntities,
	type ChangeUserRelationshipBatch,
	type CreateRelationshipInput,
	type Mutation,
	type ReconcileGlobalRelationshipGroup,
	type UpdateRelationshipInput,
	type UserRelationshipIdentity,
} from "./mutation-support";
import { makePlannedRelationshipReconciliation } from "./planned-reconciliation";
import { makePreparedRelationshipMutations } from "./prepared-mutations";
import { RelationshipsRepository, type RelationshipIdentityInput } from "./repository";

const prepareSingle = (
	input: RelationshipIdentityInput,
	command: LifecycleCommand,
	mode: Mutation["mode"],
	properties?: unknown,
	propertiesSchema?: AppSchema,
	schemaFingerprint?: CatalogDefinitionFingerprint,
) =>
	prepareProjectedRelationshipMutations(
		prepareRelationshipMutations([
			{ mode, input, command, properties, propertiesSchema, schemaFingerprint },
		]),
		singleRelationshipResult,
	);

export class RelationshipsService extends Context.Service<RelationshipsService>()(
	"RelationshipsService",
	{
		make: Effect.gen(function* () {
			const repository = yield* RelationshipsRepository;
			const runtime = yield* PluginRuntimeResolver;
			const definitions = yield* DefinitionRepository;
			const client = yield* PgClient.PgClient;
			const planner = yield* LifecyclePlanner;
			const execution = yield* LifecycleExecution;
			const dependencies = { client, planner, runtime, execution, repository, definitions };
			const {
				committedReplay,
				prepareUserCreate,
				prepareUserDelete,
				persistPreparedUserCreate,
				persistPreparedUserDelete,
			} = makePreparedRelationshipMutations(dependencies);
			const { persistPlannedReconciliation } = makePlannedRelationshipReconciliation(dependencies);
			const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
				effect.pipe(
					Effect.provideService(RelationshipsRepository, repository),
					Effect.provideService(PluginRuntimeResolver, runtime),
					Effect.provideService(DefinitionRepository, definitions),
				);
			const prepareSingleWithCatalog = Effect.fnUntraced(function* (
				input: RelationshipIdentityInput,
				command: LifecycleCommand,
				mode: Exclude<Mutation["mode"], "delete">,
				properties?: unknown,
			) {
				yield* assertRootTransaction;
				const replay = yield* committedReplay(input, command, mode, properties);
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
					yield* validateUserRelationshipEntities(input.userId, input, definition);
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
				provide(commitProjectedRelationshipMutations(pending, singleRelationshipResult));
			const single = <E, R>(
				prepare: Effect.Effect<
					LifecyclePreparedStep<RelationshipSingleResult, PendingRelationshipMutations>,
					E,
					R
				>,
			) =>
				Effect.gen(function* () {
					const current = yield* LifecycleExecution;
					const { result, warnings } = yield* runLifecycleWriteInline(current, {
						commit: commitSingle,
						prepare: provide(prepare),
						applyPolicies: applyRelationshipPolicies,
					});
					const outcome: RelationshipMutationResult = {
						warnings,
						relationship: result.relationship,
					};
					return outcome;
				});
			return {
				commitSingle,
				prepareUserCreate,
				prepareUserDelete,
				persistPreparedUserCreate,
				persistPreparedUserDelete,
				persistPlannedReconciliation,
				applyPolicies: applyRelationshipPolicies,
				delete: (input: RelationshipIdentityInput, command: LifecycleCommand) =>
					single(prepareSingle(input, command, "delete")),
				commitBatch: (pending: PendingRelationshipMutations) =>
					provide(commitProjectedRelationshipMutations(pending, summarizeRelationshipMutations)),
				create: (input: CreateRelationshipInput, command: LifecycleCommand) =>
					single(prepareSingleWithCatalog(input, command, "upsert", input.properties)),
				update: (input: UpdateRelationshipInput, command: LifecycleCommand) =>
					single(prepareSingleWithCatalog(input, command, "update", input.properties)),
				prepareCreate: (input: CreateRelationshipInput, command: LifecycleCommand) =>
					provide(prepareSingleWithCatalog(input, command, "upsert", input.properties)),
				commitReconciliation: (pending: PendingRelationshipMutations, upserted: number) =>
					provide(commitProjectedRelationshipMutations(pending, reconciliationSummary(upserted))),
				reconcileGlobal: (
					groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>,
					command: LifecycleCommand,
				) => provide(reconcileGlobalRelationships(groups, command)),
				changeUser: (
					userId: UserId,
					batches: ReadonlyArray<ChangeUserRelationshipBatch>,
					command: LifecycleCommand,
				) => provide(changeUserRelationships(userId, batches, command)),
				prepareReconcileGlobalGroup: (
					group: ReconcileGlobalRelationshipGroup,
					index: number,
					command: LifecycleCommand,
				) => provide(prepareReconcileGlobalGroup(group, index, command)),
				mergeUserProperties: (
					input: CreateRelationshipInput & { userId: UserId },
					command: LifecycleCommand,
				) => single(prepareSingleWithCatalog(input, command, "merge", input.properties)),
				deleteUserRelationshipById: (
					userId: UserId,
					relationshipId: RelationshipId,
					command: LifecycleCommand,
				) => single(prepareDeleteUserRelationshipById(userId, relationshipId, command)),
				prepareMergeUserProperties: (
					input: CreateRelationshipInput & { userId: UserId },
					command: LifecycleCommand,
				) => provide(prepareSingleWithCatalog(input, command, "merge", input.properties)),
				prepareDeleteUserRelationshipById: (
					userId: UserId,
					relationshipId: RelationshipId,
					command: LifecycleCommand,
				) => provide(prepareDeleteUserRelationshipById(userId, relationshipId, command)),
				prepareChangeUserBatch: (
					userId: UserId,
					batch: ChangeUserRelationshipBatch,
					index: number,
					command: LifecycleCommand,
				) => provide(prepareChangeUserBatch(userId, batch, index, command)),
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
