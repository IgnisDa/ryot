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
import {
	type LifecycleCommittedStep,
	type LifecyclePreparedStep,
	runLifecycleWriteInline,
} from "#modules/automations/lifecycle/write-step";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { type DomainLifecycleCommand, DomainWriteChecks } from "#modules/entities/write-context";
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
import {
	type ChangeUserRelationshipBatch,
	type CreateRelationshipInput,
	type DeleteRelationshipInput,
	type Mutation,
	type ReconcileGlobalRelationshipGroup,
	relationshipIdentity,
	relationshipSchemaReference,
	relationshipWriteFailure,
	rootTransactionGuard,
	type UpdateRelationshipInput,
	type UserRelationshipIdentity,
	validateUserRelationshipEntities,
} from "./mutation-support";
import { type RelationshipIdentityInput, RelationshipsRepository } from "./repository";

export class RelationshipsService extends Context.Service<RelationshipsService>()(
	"@ryot-app/kernel-backend/modules/relationships/service/RelationshipsService",
	{
		make: Effect.gen(function* () {
			const mutations = yield* RelationshipMutationPipeline;
			const repository = yield* RelationshipsRepository;
			const entities = yield* EntitiesRepository;
			const definitions = yield* DefinitionRepository;
			const session = yield* DatabaseSession;
			const writes = yield* DomainWriteChecks;
			const execution = yield* LifecycleExecution;
			const assertRootTransaction = rootTransactionGuard(session);
			const prepareSingle = (
				input: RelationshipIdentityInput,
				command: DomainLifecycleCommand,
				mode: Mutation["mode"],
				properties?: unknown,
				propertiesSchema?: AppSchema,
				schemaFingerprint?: CatalogDefinitionFingerprint,
			) =>
				mutations.prepareSingle({
					mode,
					input,
					command,
					properties,
					propertiesSchema,
					schemaFingerprint,
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
				const row = yield* repository.findUserRelationshipById(userId, relationshipId);
				if (row) {
					return yield* prepareSingle({ ...row, userId, scope: "user" }, command, "delete");
				}
				return {
					dispatch: [],
					_tag: "Committed",
					result: { operation: "noop", relationship: null },
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
				prepareReconcileGlobalGroup: (
					group: ReconcileGlobalRelationshipGroup,
					index: number,
					command: DomainLifecycleCommand,
				) => mutations.prepareReconcileGlobalGroup(group, index, command),
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
				prepareChangeUserBatch: (
					userId: UserId,
					batch: ChangeUserRelationshipBatch,
					index: number,
					command: DomainLifecycleCommand,
				) => mutations.prepareChangeUserBatch(userId, batch, index, command),
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
