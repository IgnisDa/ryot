import { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EntityEditorRefused,
	type EntityEditorSaveOutput,
	type EntityEditorSaveRequest,
	type EntityEditorSubmission,
} from "@ryot-app/contract/modules/entities/editor";
import type { EntityBadRequest } from "@ryot-app/contract/modules/entities/schemas";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import {
	type PluginId,
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS } from "@ryot-app/plugin-backend-sdk/core";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
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
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import type {
	PreparedUserRelationshipCreate,
	PreparedUserRelationshipDelete,
} from "#modules/relationships/prepared-mutations";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { DatabaseSession } from "#platform/db/session";

const limits = {
	relationshipTargets: 200,
	relationshipChanges: USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS.changesPerBatch,
} as const;
const notEditable = "This entity schema cannot be edited here";

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
			const runtime = yield* PluginRuntimeResolver;
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

			const authorize = Effect.fn("EntityEditorService.authorize")(function* (
				userId: UserId,
				pluginId: PluginId,
				submission: EntityEditorSubmission,
			) {
				const reference = submission.entitySchema;
				if (reference.owner.kind !== "plugin" || reference.owner.pluginId !== pluginId) {
					return notEditable;
				}
				if (!(yield* runtime.findPluginAvailableToUser(userId, pluginId))) {
					return notEditable;
				}
				const owner = definitionOwner(pluginId);
				const entitySchema = (yield* definitions.findUserEntitySchemas(userId, [
					{ owner, slug: reference.slug },
				]))[definitionKey("entity", owner, reference.slug)];
				const editor = entitySchema?.pluginId === pluginId ? entitySchema.editor : undefined;
				if (!editor) {
					return notEditable;
				}
				const slugs = submission.relationships.map(({ relationshipSchemaSlug }) =>
					RelationshipSchemaSlug.make(relationshipSchemaSlug),
				);
				const undeclared = slugs.find((slug) => !editor.relationships.includes(slug));
				if (undeclared !== undefined) {
					return `Relationship ${undeclared} is not editable here`;
				}
				const relationshipSchemas = yield* definitions.findUserRelationshipSchemas(
					userId,
					slugs.map((slug) => ({ slug, owner })),
				);
				const unavailable = slugs.find((slug) => {
					const definition = relationshipSchemas[definitionKey("relationship", owner, slug)];
					return (
						definition?.pluginId !== pluginId ||
						definition.sourceEntitySchemaSlug !== reference.slug
					);
				});
				return unavailable === undefined
					? null
					: `Relationship ${unavailable} is not editable here`;
			}, Effect.orDie);

			const save = Effect.fn("EntityEditorService.save")(function* (input: {
				userId: UserId;
				owner: PluginId;
				lifecycle: DomainLifecycleCommand;
				submission: EntityEditorSubmission;
			}) {
				const { userId, submission, lifecycle: command } = input;
				const entitySchemaSlug = EntitySchemaSlug.make(submission.entitySchema.slug);
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
				if (targetCount > limits.relationshipTargets) {
					return {
						warnings: noWarnings,
						output: invalid(
							`Entity editor saves are limited to ${limits.relationshipTargets} relationship targets`,
						),
					};
				}

				const identity = mutationReceiptIdentity({
					command,
					ownerUserId: userId,
					scopeUserId: userId,
					commandKind: "entity-editor:save",
					input: { userId, submission, owner: input.owner },
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

				const refusal = yield* authorize(userId, input.owner, submission);
				if (refusal !== null) {
					return { warnings: noWarnings, output: invalid(refusal) };
				}
				const owner = definitionOwner(input.owner);
				const relationshipSlugs = slugs.map((slug) => RelationshipSchemaSlug.make(slug));

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
								pluginId: input.owner,
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
				if (changes.length > limits.relationshipChanges) {
					return {
						warnings: noWarnings,
						output: invalid(
							`Entity editor saves are limited to ${limits.relationshipChanges} relationship changes`,
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
							return {
								kind: "saved" as const,
								dispatch: prior.dispatch,
								entityId: prior.result.entityId,
							};
						}
						const committedRefusal = yield* authorize(userId, input.owner, submission);
						if (committedRefusal !== null) {
							return { kind: "refused" as const, message: committedRefusal };
						}
						if (basisOf(yield* currentRelationships(true)) !== basis) {
							return { kind: "stale" as const };
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
						return { dispatch, kind: "saved" as const, entityId: saved.entity.id };
					}),
				);
				if (committed.kind === "stale") {
					return { output: stale, warnings: noWarnings };
				}
				if (committed.kind === "refused") {
					return { warnings: noWarnings, output: invalid(committed.message) };
				}
				return {
					warnings: yield* execution.dispatch(committed.dispatch),
					output: { kind: "saved", entityId: committed.entityId } satisfies EntityEditorSaveOutput,
				};
			});

			const savePublic = (input: Parameters<typeof save>[0]) =>
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
				);

			const submit = Effect.fn("EntityEditorService.submit")(function* (input: {
				userId: UserId;
				accountGeneration: AccountGeneration;
				request: EntityEditorSaveRequest;
			}) {
				const { userId, request, accountGeneration } = input;
				const { submission } = request;
				const owner = submission.entitySchema.owner;
				if (owner.kind !== "plugin") {
					return { warnings: noWarnings, output: invalid(notEditable) };
				}
				const executionId = AutomationExecutionId.make(
					`entity-editor-${sha256Base64Url(stableStringify([accountGeneration, "entity-editor:save", submission.entitySchema, request.idempotencyKey]))}`,
				);
				return yield* savePublic({
					userId,
					submission,
					owner: owner.pluginId,
					lifecycle: {
						...rootLifecycleCommand({
							executionId,
							source: "api",
							accountGeneration,
							lane: "interactive",
							itemIdentity: "entity-editor",
							occurredAt: request.submittedAt,
							initiator: { id: userId, kind: "user" },
						}),
						writeContext: null,
					},
				});
			});

			return { submit, save: savePublic };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
