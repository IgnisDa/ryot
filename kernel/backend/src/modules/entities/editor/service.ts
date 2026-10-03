import { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import type {
	EntityEditorSaveOutput,
	EntityEditorSubmission,
} from "@ryot-app/contract/modules/entities/editor";
import type { EntityBadRequest } from "@ryot-app/contract/modules/entities/schemas";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { ENTITY_EDITOR_SANDBOX_LIMITS } from "@ryot-app/plugin-backend-sdk/core";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type LifecycleDispatchPlan,
	LifecyclePlanner,
	type LifecyclePersistenceError,
} from "#modules/automations/lifecycle/planning";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import {
	mutationReceiptIdentity,
	MutationReceiptIdentityConflict,
	MutationReceipts,
} from "#modules/mutations/receipts";
import type {
	PreparedUserRelationshipCreate,
	PreparedUserRelationshipDelete,
} from "#modules/relationships/prepared-mutations";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { DatabaseSession } from "#platform/db/session";

export class EntityEditorRefused extends Schema.TaggedError<
	EntityEditorRefused,
	{ readonly brand: unique symbol }
>()("EntityEditorRefused", { message: Schema.String }) {}

const SaveResult = Schema.Struct({ entityId: EntityId });
const refused = (message: string) => new EntityEditorRefused({ message });
const invalid = (message: string): EntityEditorSaveOutput => ({ message, kind: "invalid" });
const stale: EntityEditorSaveOutput = { kind: "stale" };
const noWarnings: ReadonlyArray<AutomationWarning> = [];

const itemCommand = (
	command: DomainLifecycleCommand,
	identity: string,
): DomainLifecycleCommand => ({ ...command, itemIdentity: `${command.itemIdentity}:${identity}` });

const invalidEntityReason = ({ reason }: EntityBadRequest) => {
	if (reason.code === "name-required") {
		return "Name is required";
	}
	if (reason.code === "asset-forbidden") {
		return "An image is not available to this account";
	}
	if (reason.code === "invalid-properties") {
		return "The entity properties are invalid";
	}
	return reason.code === "immutable-property"
		? `${reason.property} cannot be changed after creation`
		: null;
};
const invalidRelationshipReason = ({ reason }: RelationshipBadRequest) => {
	if (reason.code === "asset-forbidden") {
		return "An image is not available to this account";
	}
	if (reason.code === "invalid-properties") {
		return "The relationship properties are invalid";
	}
	return reason.code === "source-schema-mismatch" || reason.code === "target-schema-mismatch"
		? "A relationship target does not match the relationship schema"
		: null;
};

export class EntityEditorService extends Context.Service<EntityEditorService>()(
	"EntityEditorService",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const planner = yield* LifecyclePlanner;
			const receipts = yield* MutationReceipts;
			const entities = yield* EntitiesService;
			const definitions = yield* DefinitionRepository;
			const execution = yield* LifecycleExecution;
			const relationships = yield* RelationshipsService;
			const entitiesRepository = yield* EntitiesRepository;
			const relationshipsRepository = yield* RelationshipsRepository;
			const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
				database
					.transaction(entitiesRepository.lockSchemaCatalog().pipe(Effect.andThen(work)))
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			const receiptLookup = <A>(
				identity: ReturnType<typeof mutationReceiptIdentity>,
				result: Schema.Codec<A, unknown>,
				lock: boolean,
			) =>
				(lock ? receipts.lookup(identity, result) : receipts.peek(identity, result)).pipe(
					Effect.mapError((error) =>
						error instanceof MutationReceiptIdentityConflict
							? refused("Command identity was reused with a different submission")
							: error,
					),
				);

			const save = Effect.fn("EntityEditorService.save")(function* (input: {
				userId: UserId;
				lifecycle: DomainLifecycleCommand;
				submission: EntityEditorSubmission;
			}) {
				const { userId, submission, lifecycle: command } = input;
				const revision = command.writeContext?.pluginRevision;
				if (!revision) {
					return yield* refused("Entity editing requires a pinned plugin");
				}
				const entitySchemaSlug = EntitySchemaSlug.make(submission.entitySchemaSlug);
				const slugs = submission.relationships.map(
					({ relationshipSchemaSlug }) => relationshipSchemaSlug,
				);
				const targetCount = submission.relationships.reduce(
					(total, { targets }) => total + targets.length,
					0,
				);
				if (
					new Set(slugs).size !== slugs.length ||
					submission.relationships.some(
						({ targets }) =>
							new Set(targets.map(({ entityId }) => entityId)).size !== targets.length,
					)
				) {
					return {
						warnings: noWarnings,
						output: invalid("Relationships repeat a schema or a target"),
					};
				}
				if (targetCount > ENTITY_EDITOR_SANDBOX_LIMITS.relationshipTargets) {
					return {
						warnings: noWarnings,
						output: invalid(
							`Entity editor saves are limited to ${ENTITY_EDITOR_SANDBOX_LIMITS.relationshipTargets} relationship targets`,
						),
					};
				}

				const identity = mutationReceiptIdentity({
					command,
					ownerUserId: userId,
					scopeUserId: userId,
					commandKind: "entity-editor:save",
					input: { userId, submission, writeContext: command.writeContext },
				});
				const replay = yield* receiptLookup(identity, SaveResult, false);
				if (replay) {
					return {
						warnings: yield* execution.dispatch(replay.dispatch),
						output: {
							kind: "saved",
							entityId: replay.result.entityId,
						} satisfies EntityEditorSaveOutput,
					};
				}

				const owner = definitionOwner(revision.id);
				const entitySchema = (yield* definitions
					.findUserEntitySchemas(userId, [{ owner, slug: entitySchemaSlug }])
					.pipe(Effect.orDie))[definitionKey("entity", owner, entitySchemaSlug)];
				if (
					!entitySchema ||
					entitySchema.pluginId !== revision.id ||
					!revision.schemaScope.entitySchemaSlugs.includes(entitySchemaSlug)
				) {
					return yield* refused("Entity schema is not owned by the executing plugin");
				}
				const relationshipSlugs = slugs.map((slug) => RelationshipSchemaSlug.make(slug));
				const relationshipSchemas = yield* definitions
					.findUserRelationshipSchemas(
						userId,
						relationshipSlugs.map((slug) => ({ slug, owner })),
					)
					.pipe(Effect.orDie);
				for (const slug of relationshipSlugs) {
					const definition = relationshipSchemas[definitionKey("relationship", owner, slug)];
					if (
						!definition ||
						definition.pluginId !== revision.id ||
						definition.sourceEntitySchemaSlug !== entitySchemaSlug ||
						!revision.schemaScope.relationshipSchemaSlugs.includes(slug)
					) {
						return yield* refused("Relationship schema is not owned by the executing plugin");
					}
				}

				const entityCommand = itemCommand(command, "entity");
				const prepared = yield* entities.prepareUserSave({
					userId,
					name: submission.name,
					lifecycle: entityCommand,
					properties: submission.properties,
					entitySchema: { owner, slug: entitySchemaSlug },
					target:
						submission.target.kind === "create"
							? { kind: "create" }
							: {
									kind: "update",
									expected: submission.target.expected,
									entityId: EntityId.make(submission.target.entityId),
								},
				});
				const currentRelationships = (lock: boolean) =>
					submission.target.kind === "create"
						? Effect.succeed([])
						: relationshipsRepository.listUserOutgoingRelationships({
								lock,
								userId,
								pluginId: revision.id,
								sourceEntityId: prepared.entityId,
								relationshipSchemaSlugs: relationshipSlugs,
							});
				const basisOf = (rows: Effect.Success<ReturnType<typeof currentRelationships>>) =>
					stableStringify(
						rows.map((row) => [row.relationshipSchemaSlug, row.targetEntityId, row.properties]),
					);
				const current = yield* currentRelationships(false);
				const basis = basisOf(current);

				const changes: Array<
					| {
							kind: "create";
							slug: RelationshipSchemaSlug;
							targetEntityId: EntityId;
							properties: unknown;
					  }
					| { kind: "delete"; slug: RelationshipSchemaSlug; targetEntityId: EntityId }
				> = [];
				for (const group of submission.relationships) {
					const slug = RelationshipSchemaSlug.make(group.relationshipSchemaSlug);
					const stored = new Map(
						current
							.filter((row) => row.relationshipSchemaSlug === slug)
							.map((row) => [row.targetEntityId, row.properties]),
					);
					const submitted = new Set(group.targets.map(({ entityId }) => entityId));
					for (const targetEntityId of stored.keys()) {
						if (!submitted.has(targetEntityId)) {
							changes.push({ slug, targetEntityId, kind: "delete" });
						}
					}
					for (const target of group.targets) {
						const storedProperties = stored.get(target.entityId);
						if (
							storedProperties === undefined ||
							stableStringify(storedProperties) !== stableStringify(target.properties)
						) {
							changes.push({
								slug,
								kind: "create",
								properties: target.properties,
								targetEntityId: target.entityId,
							});
						}
					}
				}
				if (changes.length > ENTITY_EDITOR_SANDBOX_LIMITS.relationshipChanges) {
					return {
						warnings: noWarnings,
						output: invalid(
							`Entity editor saves are limited to ${ENTITY_EDITOR_SANDBOX_LIMITS.relationshipChanges} relationship changes`,
						),
					};
				}

				const preparedRelationships: Array<
					| { kind: "create"; prepared: PreparedUserRelationshipCreate }
					| { kind: "delete"; prepared: PreparedUserRelationshipDelete }
				> = [];
				for (const change of changes) {
					const base = {
						userId,
						scope: "user" as const,
						sourceEntityId: prepared.entityId,
						targetEntityId: change.targetEntityId,
						relationshipSchema: { owner, slug: change.slug },
					};
					const relationshipCommand = itemCommand(
						command,
						`relationship:${change.slug}:${change.targetEntityId}:${change.kind}`,
					);
					if (change.kind === "create") {
						const create = yield* relationships.prepareUserCreate(
							{ ...base, properties: change.properties },
							relationshipCommand,
							prepared.created ?? undefined,
						);
						if (create) {
							preparedRelationships.push({ kind: "create", prepared: create });
						}
					} else {
						const deletion = yield* relationships.prepareUserDelete(base, relationshipCommand);
						if (deletion) {
							preparedRelationships.push({ kind: "delete", prepared: deletion });
						}
					}
				}

				const committed = yield* transaction(
					Effect.gen(function* () {
						const prior = yield* receiptLookup(identity, SaveResult, true);
						if (prior) {
							return { dispatch: prior.dispatch, entityId: prior.result.entityId };
						}
						if (basisOf(yield* currentRelationships(true)) !== basis) {
							return null;
						}
						const saved = yield* entities.persistPreparedUserSave(prepared);
						const relationshipDispatch: LifecycleDispatchPlan[] = [];
						if (preparedRelationships.length > 0) {
							yield* planner.prepareBatch({
								command,
								scopes: [userId],
								resource: "relationship",
								identity: ["relationships"],
							});
							for (const [index, item] of preparedRelationships.entries()) {
								const batch = { index, command, identity: ["relationships"] };
								const work =
									item.kind === "create"
										? yield* relationships.persistPreparedUserCreate(item.prepared, batch)
										: yield* relationships.persistPreparedUserDelete(item.prepared, batch);
								relationshipDispatch.push(...work.dispatch);
							}
							relationshipDispatch.push(
								...(yield* planner.planBatch({
									command,
									resource: "relationship",
									identity: ["relationships"],
								})),
							);
						}
						const dispatch = [...saved.dispatch, ...relationshipDispatch];
						yield* receipts.insert({ identity, dispatch, result: { entityId: saved.entity.id } });
						return { dispatch, entityId: saved.entity.id };
					}),
				);
				if (committed === null) {
					return { output: stale, warnings: noWarnings };
				}
				return {
					warnings: yield* execution.dispatch(committed.dispatch),
					output: { kind: "saved", entityId: committed.entityId } satisfies EntityEditorSaveOutput,
				};
			});

			return {
				save: (input: Parameters<typeof save>[0]) =>
					save(input).pipe(
						Effect.catchTags({
							EntityStale: () => Effect.succeed({ output: stale, warnings: noWarnings }),
							LifecyclePersistenceError: (error: LifecyclePersistenceError) =>
								Effect.fail(
									new DbError({
										message: `Entity editor lifecycle persistence failed: ${error.code}`,
									}),
								),
							RelationshipNotFound: (error: RelationshipNotFound) =>
								error.reason.code === "entity-not-found"
									? Effect.succeed({
											warnings: [] as ReadonlyArray<AutomationWarning>,
											output: invalid("A relationship target was not found"),
										})
									: Effect.fail(error),
							EntityBadRequest: (error: EntityBadRequest) => {
								const message = invalidEntityReason(error);
								if (message !== null) {
									return Effect.succeed({ warnings: noWarnings, output: invalid(message) });
								}
								return error.reason.code === "mutation-conflict"
									? Effect.succeed({ output: stale, warnings: noWarnings })
									: Effect.fail(error);
							},
							RelationshipBadRequest: (error: RelationshipBadRequest) => {
								const message = invalidRelationshipReason(error);
								if (message !== null) {
									return Effect.succeed({ warnings: noWarnings, output: invalid(message) });
								}
								return error.reason.code === "concurrent-relationship-change"
									? Effect.succeed({ output: stale, warnings: noWarnings })
									: Effect.fail(error);
							},
						}),
					),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
