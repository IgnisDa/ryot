import { DbError } from "@ryot-app/contract/errors";
import type { ChangeSetEntityReference } from "@ryot-app/contract/modules/changes/change-set";
import {
	type EntityEditorDeleteSubmission,
	EntityEditorRefused,
	type EntityEditorSaveOutput,
	type EntityEditorSaveRequest,
	type EntityEditorSaveSubmission,
} from "@ryot-app/contract/modules/entities/editor";
import { EntityBadRequest, EntityNotFound } from "@ryot-app/contract/modules/entities/schemas";
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
import {
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
import type { Changes } from "#modules/changes/changes";
import type { CommitReceipt, CommitResult } from "#modules/changes/receipts";
import { ChangeSets } from "#modules/changes/service";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import {
	type IdempotencyIdentity,
	idempotencyIdentity,
	IdempotencyKeys,
} from "#modules/mutations/idempotency";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { RelationshipsRepository } from "#modules/relationships/repository";

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

type Unrecorded = { readonly kind: "stale" | "reused" | "missing" };

/**
 * A commit held by the editor's idempotency key: a stored response replays, and a commit that wrote
 * nothing records no response, ending as `unwritten`.
 */
const editorReceipt = <A>(
	keys: IdempotencyKeys["Service"],
	identity: IdempotencyIdentity,
	response: Schema.Codec<A, unknown>,
	written: (result: CommitResult) => A | null,
	unwritten: Unrecorded["kind"],
): CommitReceipt<Unrecorded | { readonly response: A; readonly kind: "recorded" }> => ({
	record: (result) => {
		const value = written(result);
		return value === null
			? Effect.succeed({ kind: unwritten })
			: keys
					.record(identity, response, value)
					.pipe(Effect.as({ response: value, kind: "recorded" as const }));
	},
	load: keys.lockedRead(identity, response).pipe(
		Effect.map((stored) =>
			stored ? { kind: "recorded" as const, response: stored.response } : null,
		),
		Effect.catchTag("IdempotencyConflict", () => Effect.succeed({ kind: "reused" as const })),
	),
});

const isEditorFailure = Schema.is(
	Schema.Union([
		DbError,
		EntityBadRequest,
		EntityNotFound,
		EntityEditorRefused,
		RelationshipBadRequest,
		RelationshipNotFound,
	]),
);

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
			const keys = yield* IdempotencyKeys;
			const changeSets = yield* ChangeSets;
			const definitions = yield* DefinitionRepository;
			const entitiesRepository = yield* EntitiesRepository;
			const relationshipsRepository = yield* RelationshipsRepository;
			const runtime = yield* PluginRuntimeResolver;
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
				const entitySchema = { owner, slug: entitySchemaSlug };
				const entityId =
					submission.target.kind === "create" ? null : EntityId.make(submission.target.entityId);
				const currentRelationships = (lock: boolean) =>
					entityId === null
						? Effect.succeed([])
						: editorRelationships({ lock, slugs, userId, entityId, pluginId, directions });
				const current = yield* currentRelationships(false);
				const basis = relationshipBasis(current);
				if (
					submission.target.kind === "update" &&
					basis !== relationshipBasis(relationshipRows(submission.target.expected.relationships))
				) {
					return { output: stale };
				}

				const anchor: ChangeSetEntityReference =
					entityId === null ? { kind: "root" } : { entityId, kind: "existing" };
				const upserts: Array<
					NonNullable<NonNullable<Changes["relationships"]>["upserts"]>[number]
				> = [];
				const deletes: Array<
					NonNullable<NonNullable<Changes["relationships"]>["deletes"]>[number]
				> = [];
				for (const group of submission.relationships) {
					const slug = RelationshipSchemaSlug.make(group.relationshipSchemaSlug);
					const endpoints = (targetEntityId: EntityId) => {
						const { sourceEntityId: source, targetEntityId: target } =
							orientRelationship<ChangeSetEntityReference>(directionOf(directions, slug), anchor, {
								kind: "existing",
								entityId: targetEntityId,
							});
						return { source, target, relationshipSchema: { slug, owner } };
					};
					const stored = new Map(
						current
							.filter((row) => row.relationshipSchemaSlug === slug)
							.map((row) => [row.targetEntityId, row.properties]),
					);
					const submitted = new Set(group.targets.map(({ entityId: target }) => target));
					for (const targetEntityId of stored.keys()) {
						if (!submitted.has(targetEntityId)) {
							deletes.push({
								...endpoints(targetEntityId),
								itemIdentity: `relationship:${slug}:${targetEntityId}:delete`,
							});
						}
					}
					for (const target of group.targets) {
						const storedProperties = stored.get(target.entityId);
						if (
							storedProperties === undefined ||
							stableStringify(storedProperties) !== stableStringify(target.properties)
						) {
							upserts.push({
								...endpoints(target.entityId),
								propertiesMode: "replace",
								properties: target.properties,
								itemIdentity: `relationship:${slug}:${target.entityId}:create`,
							});
						}
					}
				}
				if (deletes.length + upserts.length > limits.relationshipChanges) {
					return {
						output: invalid(
							kernelMessage("error.entity-editor.too-many-changes", {
								limit: limits.relationshipChanges,
							}),
						),
					};
				}

				const committed = yield* changeSets.commitOnce(
					{
						userId,
						relationships: { deletes, upserts },
						entity: {
							entitySchema,
							name: submission.name,
							properties: submission.properties,
							target:
								entityId === null || submission.target.kind === "create"
									? { kind: "create" }
									: {
											entityId,
											kind: "update",
											expected: {
												name: submission.target.expected.name,
												updatedAt: submission.target.expected.updatedAt,
												properties: submission.target.expected.properties,
											},
										},
						},
					},
					command,
					editorReceipt(
						keys,
						identity,
						SaveResult,
						(result) =>
							result.committed.entityId === undefined
								? null
								: { entityId: result.committed.entityId },
						"stale",
					),
					{
						precondition: {
							written: Effect.void,
							check: Effect.gen(function* () {
								const authorized = yield* authorize(userId, submission.entitySchema, slugs);
								return (
									authorized.kind === "authorized" &&
									relationshipBasis(yield* currentRelationships(true)) === basis
								);
							}),
						},
					},
				);
				if (committed.kind === "reused") {
					return yield* commandIdentityReused();
				}
				if (committed.kind !== "recorded") {
					const now = yield* authorize(userId, submission.entitySchema, slugs);
					return { output: now.kind === "refused" ? invalid(now.reason) : stale };
				}
				return {
					output: {
						kind: "saved",
						entityId: committed.response.entityId,
					} satisfies EntityEditorSaveOutput,
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
				const committed = yield* changeSets.commitOnce(
					{ userId, entities: { deletes: [{ entityId, entitySchema, preserveHistory: true }] } },
					input.lifecycle,
					editorReceipt(
						keys,
						identity,
						DeleteResult,
						(result) => (result.deleted.length === 0 ? null : { deleted: true as const }),
						"missing",
					),
				);
				if (committed.kind === "reused") {
					return yield* commandIdentityReused();
				}
				if (committed.kind !== "recorded") {
					return yield* new EntityNotFound({ reason: { entityId, code: "entity-not-found" } });
				}
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
					Effect.catchIf((error) => !isEditorFailure(error), Effect.die),
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
