import { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type EntityEditorDeleteSubmission,
	EntityEditorRefused,
	type EntityEditorSaveOutput,
	type EntityEditorSaveRequest,
	type EntityEditorSaveSubmission,
} from "@ryot-app/contract/modules/entities/editor";
import type { EntityBadRequest } from "@ryot-app/contract/modules/entities/schemas";
import { EntityNotFound } from "@ryot-app/contract/modules/entities/schemas";
import type { PluginEntityEditorRelationship } from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionKey,
	definitionOwner,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	orientRelationship,
	relationshipEnds,
} from "@ryot-app/contract/modules/relationships/orientation";
import type {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import {
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
	type LifecyclePersistenceError,
	LifecyclePlanner,
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
const notDeletable = "This entity cannot be deleted here";
const hasLinks = "Remove this entity's linked items before deleting it";

type Direction = PluginEntityEditorRelationship["direction"];

const refusedAuthorization = (message: string) => ({ message, kind: "refused" as const });

const directionOf = (directions: ReadonlyMap<string, Direction>, slug: string) => {
	const direction = directions.get(slug);
	if (direction === undefined) {
		throw new Error(`Relationship ${slug} is not declared by the editor`);
	}
	return direction;
};

const SaveResult = Schema.Struct({ entityId: EntityId });
const refused = (message: string) => new EntityEditorRefused({ message });
const invalid = (message: string): EntityEditorSaveOutput => ({ message, kind: "invalid" });
const stale: EntityEditorSaveOutput = { kind: "stale" };
const noWarnings: ReadonlyArray<AutomationWarning> = [];

const relationshipBasis = (
	rows: ReadonlyArray<{
		readonly properties: unknown;
		readonly targetEntityId: string;
		readonly relationshipSchemaSlug: string;
	}>,
) =>
	stableStringify(
		rows
			.map((row) => [row.relationshipSchemaSlug, row.targetEntityId, row.properties])
			.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right))),
	);

const relationshipRows = (groups: EntityEditorSaveSubmission["relationships"]) =>
	groups.flatMap(({ targets, relationshipSchemaSlug }) =>
		targets.map(({ entityId, properties }) => ({
			properties,
			relationshipSchemaSlug,
			targetEntityId: entityId,
		})),
	);

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
	if (reason.code === "entity-has-history") {
		return "Remove this entity's history before deleting it";
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
	if (reason.code === "source-not-owned") {
		return "A linked entity is not yours to change";
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
				reference: EntitySchemaReference,
				relationshipSlugs: ReadonlyArray<string>,
			) {
				if (reference.owner.kind !== "plugin") {
					return refusedAuthorization(notEditable);
				}
				const { pluginId } = reference.owner;
				if (!(yield* runtime.findPluginAvailableToUser(userId, pluginId))) {
					return refusedAuthorization(notEditable);
				}
				const owner = definitionOwner(pluginId);
				const entitySchema = (yield* definitions.findUserEntitySchemas(userId, [
					{ owner, slug: reference.slug },
				]))[definitionKey("entity", owner, reference.slug)];
				const editor = entitySchema?.pluginId === pluginId ? entitySchema.editor : undefined;
				if (!editor) {
					return refusedAuthorization(notEditable);
				}
				const directions = new Map<string, Direction>(
					editor.relationships.map(({ slug, direction }) => [slug, direction]),
				);
				const undeclared = relationshipSlugs.find((slug) => !directions.has(slug));
				if (undeclared !== undefined) {
					return refusedAuthorization(`Relationship ${undeclared} is not editable here`);
				}
				const relationshipSchemas = yield* definitions.findUserRelationshipSchemas(
					userId,
					relationshipSlugs.map((slug) => ({ owner, slug: RelationshipSchemaSlug.make(slug) })),
				);
				const unavailable = relationshipSlugs.find((slug) => {
					const definition = relationshipSchemas[definitionKey("relationship", owner, slug)];
					return (
						definition?.pluginId !== pluginId ||
						definition[
							`${relationshipEnds(directionOf(directions, slug)).anchor}EntitySchemaSlug`
						] !== reference.slug
					);
				});
				return unavailable === undefined
					? { directions, kind: "authorized" as const, deletable: editor.deletable === true }
					: refusedAuthorization(`Relationship ${unavailable} is not editable here`);
			}, Effect.orDie);

			const editorRelationships = (input: {
				lock: boolean;
				userId: UserId;
				pluginId: string;
				entityId: EntityId;
				slugs: ReadonlyArray<string>;
				directions: ReadonlyMap<string, Direction>;
			}) => {
				const slugsIn = (outgoing: boolean) =>
					input.slugs
						.filter((slug) => (directionOf(input.directions, slug) === "outgoing") === outgoing)
						.map((slug) => RelationshipSchemaSlug.make(slug));
				return relationshipsRepository
					.listUserEditorRelationships({
						lock: input.lock,
						userId: input.userId,
						entityId: input.entityId,
						pluginId: input.pluginId,
						outgoingSlugs: slugsIn(true),
						incomingSlugs: slugsIn(false),
					})
					.pipe(
						Effect.map((rows) =>
							rows.map((row) => ({
								properties: row.properties,
								relationshipSchemaSlug: row.relationshipSchemaSlug,
								targetEntityId:
									row[
										`${relationshipEnds(directionOf(input.directions, row.relationshipSchemaSlug)).related}EntityId`
									],
							})),
						),
					);
			};

			const save = Effect.fn("EntityEditorService.save")(function* (input: {
				userId: UserId;
				lifecycle: DomainLifecycleCommand;
				submission: EntityEditorSaveSubmission;
			}) {
				const { userId, submission, lifecycle: command } = input;
				const schemaOwner = submission.entitySchema.owner;
				if (schemaOwner.kind !== "plugin") {
					return { warnings: noWarnings, output: invalid(notEditable) };
				}
				const { pluginId } = schemaOwner;
				const entitySchemaSlug = EntitySchemaSlug.make(submission.entitySchema.slug);
				const slugs = submission.relationships.map(
					({ relationshipSchemaSlug }) => relationshipSchemaSlug,
				);
				const targetCount = submission.relationships.reduce(
					(total, { targets }) => total + targets.length,
					0,
				);
				if (submission.target.kind === "update") {
					const expected = submission.target.expected.relationships;
					if (
						stableStringify(
							expected.map(({ relationshipSchemaSlug }) => relationshipSchemaSlug).sort(),
						) !== stableStringify([...slugs].sort()) ||
						expected.some(
							({ targets }) =>
								new Set(targets.map(({ entityId }) => entityId)).size !== targets.length,
						)
					) {
						return {
							warnings: noWarnings,
							output: invalid(
								"Relationship baselines must match the submitted schemas without duplicate targets",
							),
						};
					}
				}
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
					input: { userId, submission },
					commandKind: "entity-editor:save",
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

				const authorization = yield* authorize(userId, submission.entitySchema, slugs);
				if (authorization.kind === "refused") {
					return { warnings: noWarnings, output: invalid(authorization.message) };
				}
				const { directions } = authorization;
				const parentRefusal = [...directions].find(([slug, direction]) => {
					if (direction !== "parent") {
						return false;
					}
					const submitted = submission.relationships.find(
						(group) => group.relationshipSchemaSlug === slug,
					);
					if (submission.target.kind === "create") {
						return submitted?.targets.length !== 1;
					}
					const expected = submission.target.expected.relationships.find(
						(group) => group.relationshipSchemaSlug === slug,
					);
					return (
						stableStringify(submitted?.targets.map(({ entityId }) => entityId) ?? null) !==
						stableStringify(expected?.targets.map(({ entityId }) => entityId) ?? null)
					);
				});
				if (parentRefusal !== undefined) {
					return {
						warnings: noWarnings,
						output: invalid(`Relationship ${parentRefusal[0]} needs one parent set at creation`),
					};
				}
				const owner = definitionOwner(pluginId);
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
									entityId: EntityId.make(submission.target.entityId),
									expected: {
										name: submission.target.expected.name,
										updatedAt: submission.target.expected.updatedAt,
										properties: submission.target.expected.properties,
									},
								},
				});
				const currentRelationships = (lock: boolean) =>
					submission.target.kind === "create"
						? Effect.succeed([])
						: editorRelationships({
								lock,
								slugs,
								userId,
								pluginId,
								directions,
								entityId: prepared.entityId,
							});
				const current = yield* currentRelationships(false);
				const basis = relationshipBasis(current);
				if (
					submission.target.kind === "update" &&
					basis !== relationshipBasis(relationshipRows(submission.target.expected.relationships))
				) {
					return { output: stale, warnings: noWarnings };
				}

				const changes: Array<
					| { kind: "delete"; targetEntityId: EntityId; slug: RelationshipSchemaSlug }
					| {
							kind: "create";
							properties: unknown;
							targetEntityId: EntityId;
							slug: RelationshipSchemaSlug;
					  }
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
						relationshipSchema: { owner, slug: change.slug },
						...orientRelationship(
							directionOf(directions, change.slug),
							prepared.entityId,
							change.targetEntityId,
						),
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
						const committedAuthorization = yield* authorize(userId, submission.entitySchema, slugs);
						if (committedAuthorization.kind === "refused") {
							return { kind: "refused" as const, message: committedAuthorization.message };
						}
						if (relationshipBasis(yield* currentRelationships(true)) !== basis) {
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

			const remove = Effect.fn("EntityEditorService.remove")(function* (input: {
				userId: UserId;
				lifecycle: DomainLifecycleCommand;
				submission: EntityEditorDeleteSubmission;
			}) {
				const { userId, submission } = input;
				const entityId = EntityId.make(submission.entityId);
				const authorization = yield* authorize(userId, submission.entitySchema, []);
				if (authorization.kind === "refused") {
					return { warnings: noWarnings, output: invalid(authorization.message) };
				}
				if (!authorization.deletable) {
					return { warnings: noWarnings, output: invalid(notDeletable) };
				}
				const entitySchema = {
					owner: submission.entitySchema.owner,
					slug: EntitySchemaSlug.make(submission.entitySchema.slug),
				};
				const current = yield* entitiesRepository.getMutationEntity(entityId);
				if (current !== null) {
					if (current.userId !== userId || current.entity.providerId !== null) {
						return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
					}
					if (current.entity.updatedAt !== submission.expectedUpdatedAt) {
						return { output: stale, warnings: noWarnings };
					}
					const links = yield* relationshipsRepository.listUserRelationshipsForEntity({
						userId,
						entityId,
					});
					const unmanaged = links.some((link) => {
						const direction = authorization.directions.get(link.relationshipSchemaSlug);
						return (
							direction === undefined ||
							link[`${relationshipEnds(direction).anchor}EntityId`] !== entityId
						);
					});
					if (unmanaged) {
						return { warnings: noWarnings, output: invalid(hasLinks) };
					}
				}
				const { warnings, deletedCount } = yield* entities.deleteByIds(
					[entityId],
					input.lifecycle,
					{ userId, entitySchema, preserveHistory: true },
				);
				if (deletedCount === 0) {
					return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
				}
				return { warnings, output: { kind: "deleted" } satisfies EntityEditorSaveOutput };
			});

			const handled = (
				input: Omit<Parameters<typeof save>[0], "submission"> & {
					submission: EntityEditorSaveRequest["submission"];
				},
			) =>
				Effect.suspend(() =>
					input.submission.action === "save"
						? save({ ...input, submission: input.submission })
						: remove({ ...input, submission: input.submission }),
				).pipe(
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
				request: EntityEditorSaveRequest;
				accountGeneration: AccountGeneration;
			}) {
				const { userId, request, accountGeneration } = input;
				const { submission } = request;
				const executionId = AutomationExecutionId.make(
					`entity-editor-${sha256Base64Url(stableStringify([accountGeneration, `entity-editor:${submission.action}`, submission.entitySchema, request.idempotencyKey]))}`,
				);
				const lifecycle = {
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
				};
				return yield* handled({ userId, lifecycle, submission });
			});

			return { submit };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
