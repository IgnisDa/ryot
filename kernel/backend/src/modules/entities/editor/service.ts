import { DbError } from "@ryot-app/contract/errors";
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
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
import { AccountAdmission } from "#modules/mutations/account-admission";
import { idempotencyIdentity, IdempotencyKeys } from "#modules/mutations/idempotency";
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
const notEditable = kernelMessage("error.entity-editor.not-editable");

type Direction = PluginEntityEditorRelationship["direction"];

const refusedAuthorization = (reason: Message) => ({ reason, kind: "refused" as const });
const relationshipNotEditable = (relationship: string) =>
	refusedAuthorization(
		kernelMessage("error.entity-editor.relationship-not-editable", { relationship }),
	);

const directionOf = (directions: ReadonlyMap<string, Direction>, slug: string) => {
	const direction = directions.get(slug);
	if (direction === undefined) {
		throw new Error(`Relationship ${slug} is not declared by the editor`);
	}
	return direction;
};

const SaveResult = Schema.Struct({ entityId: EntityId });
const DeleteResult = Schema.Struct({ deleted: Schema.Literal(true) });
const commandIdentityReused = () =>
	new EntityEditorRefused({ reason: kernelMessage("error.entities.command-identity-reused") });
const invalid = (reason: Message): EntityEditorSaveOutput => ({ reason, kind: "invalid" });
const stale: EntityEditorSaveOutput = { kind: "stale" };

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
		return kernelMessage("error.entity-editor.name-required");
	}
	if (reason.code === "asset-forbidden") {
		return kernelMessage("error.sandbox.asset-forbidden");
	}
	if (reason.code === "invalid-properties") {
		return kernelMessage("error.entity-editor.invalid-properties");
	}
	if (reason.code === "entity-has-history") {
		return kernelMessage("error.entity-editor.has-history");
	}
	return reason.code === "immutable-property"
		? kernelMessage("error.entity-editor.immutable-property", { property: reason.property })
		: null;
};
const invalidRelationshipReason = ({ reason }: RelationshipBadRequest) => {
	if (reason.code === "asset-forbidden") {
		return kernelMessage("error.sandbox.asset-forbidden");
	}
	if (reason.code === "invalid-properties") {
		return kernelMessage("error.entity-editor.invalid-relationship-properties");
	}
	if (reason.code === "source-not-owned") {
		return kernelMessage("error.entity-editor.source-not-owned");
	}
	return reason.code === "source-schema-mismatch" || reason.code === "target-schema-mismatch"
		? kernelMessage("error.entity-editor.schema-mismatch")
		: null;
};

export class EntityEditorService extends Context.Service<EntityEditorService>()(
	"@ryot-app/kernel-backend/modules/entities/editor/service/EntityEditorService",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const planner = yield* LifecyclePlanner;
			const keys = yield* IdempotencyKeys;
			const admission = yield* AccountAdmission.make;
			const entities = yield* EntitiesService;
			const definitions = yield* DefinitionRepository;
			const execution = yield* LifecycleExecution;
			const relationships = yield* RelationshipsService;
			const entitiesRepository = yield* EntitiesRepository;
			const relationshipsRepository = yield* RelationshipsRepository;
			const runtime = yield* PluginRuntimeResolver;
			const transaction = <A, E, R>(work: Effect.Effect<A, E, R>, userId: UserId) =>
				database
					.transaction(entitiesRepository.lockSchemaCatalog([userId]).pipe(Effect.andThen(work)))
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
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
					return relationshipNotEditable(undeclared);
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
					: relationshipNotEditable(unavailable);
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
				key: string;
				userId: UserId;
				lifecycle: DomainLifecycleCommand;
				submission: EntityEditorSaveSubmission;
			}) {
				const { key, userId, submission, lifecycle: command } = input;
				const schemaOwner = submission.entitySchema.owner;
				if (schemaOwner.kind !== "plugin") {
					return { output: invalid(notEditable) };
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
						return { output: invalid(kernelMessage("error.entity-editor.baseline-mismatch")) };
					}
				}
				if (
					new Set(slugs).size !== slugs.length ||
					submission.relationships.some(
						({ targets }) =>
							new Set(targets.map(({ entityId }) => entityId)).size !== targets.length,
					)
				) {
					return { output: invalid(kernelMessage("error.entity-editor.duplicate-relationships")) };
				}
				if (targetCount > limits.relationshipTargets) {
					return {
						output: invalid(
							kernelMessage("error.entity-editor.too-many-targets", {
								limit: limits.relationshipTargets,
							}),
						),
					};
				}

				const identity = idempotencyIdentity({
					key,
					userId,
					kind: "entity-editor:save",
					request: { userId, submission },
				});
				const replay = yield* keys
					.read(identity, SaveResult)
					.pipe(Effect.catchTag("IdempotencyConflict", () => Effect.fail(commandIdentityReused())));
				if (replay) {
					return {
						output: {
							kind: "saved",
							entityId: replay.response.entityId,
						} satisfies EntityEditorSaveOutput,
					};
				}

				const authorization = yield* authorize(userId, submission.entitySchema, slugs);
				if (authorization.kind === "refused") {
					return { output: invalid(authorization.reason) };
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
						output: invalid(
							kernelMessage("error.entity-editor.parent-required", {
								relationship: parentRefusal[0],
							}),
						),
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
					return { output: stale };
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
						output: invalid(
							kernelMessage("error.entity-editor.too-many-changes", {
								limit: limits.relationshipChanges,
							}),
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
						if (command.accountUserId) {
							yield* admission.admitAccount(command.accountUserId);
						}
						const prior = yield* keys
							.lockedRead(identity, SaveResult)
							.pipe(
								Effect.catchTag("IdempotencyConflict", () => Effect.fail(commandIdentityReused())),
							);
						if (prior) {
							return { dispatch: [], kind: "saved" as const, entityId: prior.response.entityId };
						}
						const committedAuthorization = yield* authorize(userId, submission.entitySchema, slugs);
						if (committedAuthorization.kind === "refused") {
							return { kind: "refused" as const, reason: committedAuthorization.reason };
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
						yield* keys.record(identity, SaveResult, { entityId: saved.entity.id });
						return { dispatch, kind: "saved" as const, entityId: saved.entity.id };
					}),
					userId,
				);
				if (committed.kind === "stale") {
					return { output: stale };
				}
				if (committed.kind === "refused") {
					return { output: invalid(committed.reason) };
				}
				yield* execution.dispatch(committed.dispatch);
				return {
					output: { kind: "saved", entityId: committed.entityId } satisfies EntityEditorSaveOutput,
				};
			});

			const remove = Effect.fn("EntityEditorService.remove")(function* (input: {
				key: string;
				userId: UserId;
				lifecycle: DomainLifecycleCommand;
				submission: EntityEditorDeleteSubmission;
			}) {
				const { key, userId, submission } = input;
				const identity = idempotencyIdentity({
					key,
					userId,
					kind: "entity-editor:delete",
					request: { userId, submission },
				});
				const replay = yield* keys
					.read(identity, DeleteResult)
					.pipe(Effect.catchTag("IdempotencyConflict", () => Effect.fail(commandIdentityReused())));
				if (replay) {
					return { output: { kind: "deleted" as const } };
				}
				const entityId = EntityId.make(submission.entityId);
				const authorization = yield* authorize(userId, submission.entitySchema, []);
				if (authorization.kind === "refused") {
					return { output: invalid(authorization.reason) };
				}
				if (!authorization.deletable) {
					return { output: invalid(kernelMessage("error.entity-editor.not-deletable")) };
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
						return { output: stale };
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
						return { output: invalid(kernelMessage("error.entity-editor.has-links")) };
					}
				}
				const { deletedCount } = yield* entities.deleteByIds([entityId], input.lifecycle, {
					userId,
					entitySchema,
					preserveHistory: true,
				});
				if (deletedCount === 0) {
					return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
				}
				yield* keys.record(identity, DeleteResult, { deleted: true });
				return { output: { kind: "deleted" } satisfies EntityEditorSaveOutput };
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
						EntityStale: () => Effect.succeed({ output: stale }),
						LifecyclePersistenceError: (error: LifecyclePersistenceError) =>
							Effect.fail(
								new DbError({
									message: `Entity editor lifecycle persistence failed: ${error.code}`,
								}),
							),
						RelationshipNotFound: (error: RelationshipNotFound) =>
							error.reason.code === "entity-not-found"
								? Effect.succeed({
										output: invalid(kernelMessage("error.entity-editor.target-not-found")),
									})
								: Effect.fail(error),
						EntityBadRequest: (error: EntityBadRequest) => {
							const reason = invalidEntityReason(error);
							if (reason !== null) {
								return Effect.succeed({ output: invalid(reason) });
							}
							return error.reason.code === "mutation-conflict"
								? Effect.succeed({ output: stale })
								: Effect.fail(error);
						},
						RelationshipBadRequest: (error: RelationshipBadRequest) => {
							const reason = invalidRelationshipReason(error);
							if (reason !== null) {
								return Effect.succeed({ output: invalid(reason) });
							}
							return error.reason.code === "concurrent-relationship-change"
								? Effect.succeed({ output: stale })
								: Effect.fail(error);
						},
					}),
				);

			const submit = Effect.fn("EntityEditorService.submit")(function* (input: {
				userId: UserId;
				accountUserId: UserId;
				request: EntityEditorSaveRequest;
			}) {
				const { userId, request, accountUserId } = input;
				const { submission } = request;
				const executionId = AutomationExecutionId.make(
					`entity-editor-${sha256Base64Url(stableStringify([accountUserId, `entity-editor:${submission.action}`, submission.entitySchema, request.idempotencyKey]))}`,
				);
				const lifecycle = {
					...rootLifecycleCommand({
						executionId,
						source: "api",
						accountUserId,
						lane: "interactive",
						itemIdentity: "entity-editor",
						occurredAt: request.submittedAt,
						initiator: { id: userId, kind: "user" },
					}),
					writeContext: null,
				};
				return yield* handled({ userId, lifecycle, submission, key: executionId });
			});

			return { submit };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
