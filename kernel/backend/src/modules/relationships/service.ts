import { PgClient } from "@effect/sql-pg";
import { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
	type RelationshipMutationResult,
} from "@ryot-app/contract/modules/relationships/schemas";
import type { RelationshipId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import {
	catalogDefinitionFingerprint,
	type CatalogDefinitionFingerprint,
	PluginRuntimeResolver,
} from "#modules/plugins/runtime-resolver";

import {
	changeUserRelationships,
	mutateRelationships,
	reconcileGlobalRelationships,
} from "./mutation-pipeline";
import {
	assertRootTransaction,
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

export class RelationshipsService extends Context.Service<RelationshipsService>()(
	"RelationshipsService",
	{
		make: Effect.gen(function* () {
			const repository = yield* RelationshipsRepository;
			const runtime = yield* PluginRuntimeResolver;
			const client = yield* PgClient.PgClient;
			const planner = yield* LifecyclePlanner;
			const execution = yield* LifecycleExecution;
			const dependencies = { client, planner, runtime, execution, repository };
			const {
				committedReplay,
				prepareUserCreate,
				prepareUserDelete,
				executeCommittedPlans,
				persistPreparedUserCreate,
				persistPreparedUserDelete,
			} = makePreparedRelationshipMutations(dependencies);
			const { persistPlannedReconciliation } = makePlannedRelationshipReconciliation(dependencies);
			const single = Effect.fnUntraced(function* (
				input: RelationshipIdentityInput,
				command: LifecycleCommand,
				mode: Mutation["mode"],
				properties?: unknown,
				propertiesSchema?: AppSchema,
				schemaFingerprint?: CatalogDefinitionFingerprint,
			) {
				const [result] = yield* mutateRelationships([
					{ mode, input, command, properties, propertiesSchema, schemaFingerprint },
				]).pipe(
					Effect.provideService(RelationshipsRepository, repository),
					Effect.provideService(PluginRuntimeResolver, runtime),
				);
				if (!result) {
					return yield* new DbError({ message: "Relationship mutation returned no result" });
				}
				const outcome: RelationshipMutationResult = {
					warnings: result.warnings,
					relationship: result.relationship,
				};
				return outcome;
			});
			const singleWithCatalog = Effect.fnUntraced(function* (
				input: RelationshipIdentityInput,
				command: LifecycleCommand,
				mode: Exclude<Mutation["mode"], "delete">,
				properties?: unknown,
			) {
				yield* assertRootTransaction;
				const replay = yield* committedReplay(input, command, mode, properties);
				if (replay) {
					const replayExecution = yield* LifecycleExecution;
					const warnings: AutomationWarning[] = [];
					if (replay.plan.trigger.blockedReason?.hasRequiredHooks) {
						warnings.push({
							...replay.plan.trigger.blockedReason,
							triggerId: replay.plan.trigger.id,
						});
					}
					warnings.push(
						...(yield* replayExecution.after({
							runs: replay.plan.runs,
							triggerId: replay.plan.trigger.id,
						})),
					);
					return { warnings, relationship: replay.relationship };
				}
				const catalog =
					input.scope === "user"
						? yield* runtime.getEffectiveDefinitions(input.userId)
						: yield* runtime.getGlobalDefinitions();
				const definition = catalog.relationshipSchemas[input.relationshipSchemaSlug];
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
				return yield* single(
					{ ...input, relationshipSchemaPluginId: pluginId },
					command,
					mode,
					properties,
					definition.propertiesSchema,
					catalogDefinitionFingerprint(definition),
				);
			});
			const create = (input: CreateRelationshipInput, command: LifecycleCommand) =>
				singleWithCatalog(input, command, "upsert", input.properties);
			return {
				create,
				prepareUserCreate,
				prepareUserDelete,
				executeCommittedPlans,
				persistPreparedUserCreate,
				persistPreparedUserDelete,
				persistPlannedReconciliation,
				listGlobal: repository.listGlobalRelationships,
				delete: (input: RelationshipIdentityInput, command: LifecycleCommand) =>
					single(input, command, "delete"),
				update: (input: UpdateRelationshipInput, command: LifecycleCommand) =>
					singleWithCatalog(input, command, "update", input.properties),
				mergeUserProperties: (
					input: CreateRelationshipInput & { userId: UserId },
					command: LifecycleCommand,
				) => singleWithCatalog(input, command, "merge", input.properties),
				reconcileGlobal: (
					groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>,
					command: LifecycleCommand,
				) =>
					reconcileGlobalRelationships(groups, command).pipe(
						Effect.provideService(RelationshipsRepository, repository),
						Effect.provideService(PluginRuntimeResolver, runtime),
					),
				createUser: Effect.fnUntraced(function* (
					userId: UserId,
					input: UserRelationshipIdentity & { properties?: unknown },
					command: LifecycleCommand,
				) {
					return yield* singleWithCatalog(
						{ ...input, userId, scope: "user" },
						command,
						"upsert",
						input.properties ?? {},
					);
				}),
				changeUser: (
					userId: UserId,
					batches: ReadonlyArray<ChangeUserRelationshipBatch>,
					command: LifecycleCommand,
				) =>
					changeUserRelationships(userId, batches, command).pipe(
						Effect.provideService(RelationshipsRepository, repository),
						Effect.provideService(PluginRuntimeResolver, runtime),
					),
				deleteUserRelationshipById: Effect.fnUntraced(function* (
					userId: UserId,
					relationshipId: RelationshipId,
					command: LifecycleCommand,
				) {
					const row = yield* repository.findUserRelationshipById(userId, relationshipId);
					if (!row) {
						return { warnings: [], relationship: null };
					}
					return yield* single({ ...row, userId, scope: "user" }, command, "delete");
				}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
