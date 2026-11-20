import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { DbError } from "@ryot-app/contract/errors";
import {
	decodeCollectionFields,
	type KeyedCollectionField,
} from "@ryot-app/contract/modules/collections/fields";
import {
	CollectionBadRequest,
	CollectionNotFound,
	type CreateCollectionBody,
	type CreateMembershipBody,
	type DeleteCollectionBody,
	type DeleteMembershipBody,
	MembershipResponse,
	type UpdateCollectionBody,
} from "@ryot-app/contract/modules/collections/schemas";
import {
	type EntityBadRequest,
	type EntityNotFound,
	type EntityStale,
	ListedEntity,
} from "@ryot-app/contract/modules/entities/schemas";
import type { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import {
	EntityId,
	EventSchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { parseAppSchemaProperties } from "@ryot-app/contract/schema/property-values";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Context, Effect, Layer, Schema, Struct } from "effect";

import { type Changes, eventCreateChanges } from "#modules/changes/changes";
import { toCreateEventsResponse } from "#modules/changes/outcomes";
import { savedEntity } from "#modules/changes/receipts";
import { ChangeSets } from "#modules/changes/service";
import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import {
	type DomainLifecycleCommand,
	kernelCollectionLifecycleCommand,
} from "#modules/entities/write-context";
import { RelationshipWriteResult } from "#modules/relationships/mutation-support";
import { trimToNull } from "#platform/validation";

import { collectionMembershipSchema, prepareCollectionFields } from "./fields";
import { CollectionsRepository } from "./repository";
import { toCollectionResponse } from "./service-support";

export const CollectionMembershipResult = Schema.Struct({
	entityId: EntityId,
	occurredAt: Schema.String,
	entitySchemaSlug: Schema.String,
	memberOf: MembershipResponse.fields.memberOf,
	eventSchemaSlug: Schema.NullOr(EventSchemaSlug),
	operation: RelationshipWriteResult.fields.operation,
});
export type CollectionMembershipResult = typeof CollectionMembershipResult.Type;

type MembershipDetails = Omit<CollectionMembershipResult, "memberOf" | "operation"> & {
	readonly collectionId: EntityId;
	readonly change: "add" | "remove";
};

export const CollectionMembershipWritten = Schema.Struct({
	...MembershipResponse.fields,
	operation: RelationshipWriteResult.fields.operation,
});

type MembershipInput = {
	readonly userId: UserId;
	readonly entityId: EntityId;
	readonly properties?: unknown;
	readonly collectionId: EntityId;
	readonly operation: "add" | "remove";
	readonly command: DomainLifecycleCommand;
	readonly mode?: CreateMembershipBody["mode"];
};

export const CollectionEntityResult = Schema.Struct(Struct.pick(ListedEntity.fields, ["id"]));
export type CollectionEntityResult = typeof CollectionEntityResult.Type;

export const childCollectionLifecycleCommand = (
	command: DomainLifecycleCommand,
	itemIdentity: string,
): DomainLifecycleCommand => ({
	...command,
	itemIdentity: stableStringify([command.itemIdentity, itemIdentity]),
});

type MembershipTarget = {
	readonly userId: UserId;
	readonly entityId: EntityId;
	readonly collectionId: EntityId;
	readonly command: DomainLifecycleCommand;
};

const invalidMembership = (error: RelationshipBadRequest) =>
	new CollectionBadRequest({
		reason: {
			code: "invalid-membership-properties",
			paths: error.reason.code === "invalid-properties" ? error.reason.paths : [],
		},
	});

const invalidCollection = (error: EntityBadRequest) =>
	new CollectionBadRequest({
		reason: {
			code: "invalid-collection-properties",
			paths: error.reason.code === "invalid-properties" ? error.reason.paths : [],
		},
	});

const nameTaken = () => new CollectionBadRequest({ reason: { field: "name", code: "name-taken" } });

const collectionNotFound = (collectionId: EntityId) =>
	new CollectionNotFound({ reason: { collectionId, code: "collection-not-found" } });

const compensationFailed = () =>
	new CollectionBadRequest({ reason: { code: "membership-event-failed" } });

const requireBuiltinOrDie =
	<T>(message: string) =>
	(found: T | null | undefined): Effect.Effect<T> =>
		found != null ? Effect.succeed(found) : Effect.die(message);

const requireName = (name: string) => {
	const trimmed = trimToNull(name);
	return trimmed
		? Effect.succeed(trimmed)
		: Effect.fail(new CollectionBadRequest({ reason: { field: "name", code: "name-required" } }));
};

const collectionProperties = (
	description: null | string | undefined,
	fields: ReadonlyArray<KeyedCollectionField>,
) => {
	const trimmed = trimToNull(description ?? "");
	return { ...(trimmed ? { description: trimmed } : {}), membershipFields: fields };
};

const storedMembershipFields = (properties: unknown) =>
	isObjectRecord(properties) ? properties["membershipFields"] : undefined;

const collectionRejected = (error: EntityStale | EntityNotFound | EntityBadRequest) => {
	if (error._tag !== "EntityBadRequest") {
		return Effect.die(error);
	}
	return error.reason.code === "duplicate-collection-name"
		? Effect.fail(nameTaken())
		: Effect.fail(invalidCollection(error));
};

export class CollectionsService extends Context.Service<CollectionsService>()(
	"@ryot-app/kernel-backend/modules/collections/service/CollectionsService",
	{
		make: Effect.gen(function* () {
			const changes = yield* ChangeSets;
			const repository = yield* CollectionsRepository;
			const relationshipSchemasRepository = yield* RelationshipSchemaReader;
			const memberOfSchema = yield* Effect.cached(
				relationshipSchemasRepository
					.findKernelBySlug("member-of")
					.pipe(
						Effect.flatMap(
							requireBuiltinOrDie("member-of relationship schema not found in database"),
						),
					),
			);

			const collectionEntitySchema = yield* Effect.cached(
				repository
					.getBuiltinCollectionSchema()
					.pipe(
						Effect.flatMap(
							requireBuiltinOrDie("builtin collection entity schema not found in database"),
						),
					),
			);

			const getBuiltinCollectionEventSchema = Effect.fn(
				"CollectionsService.getBuiltinCollectionEventSchema",
			)(function* (slug: string) {
				const entitySchema = yield* collectionEntitySchema;
				return yield* repository.findBuiltinEventSchemaBySlug({
					owner: { kind: "kernel" },
					slug: EventSchemaSlug.make(slug),
					entitySchemaSlug: entitySchema.entitySchemaSlug,
				});
			});

			const addEventSchema = yield* Effect.cached(
				getBuiltinCollectionEventSchema("add-entity-to-collection"),
			);

			const removeEventSchema = yield* Effect.cached(
				getBuiltinCollectionEventSchema("remove-entity-from-collection"),
			);

			const memberOfReference = Effect.map(memberOfSchema, (schema) => ({
				owner: { kind: "kernel" } as const,
				slug: RelationshipSchemaSlug.make(schema.slug),
			}));

			const assertNameAvailable = Effect.fnUntraced(function* (
				userId: UserId,
				name: string,
				collectionId?: EntityId,
			) {
				const existing = yield* repository.findCollectionByNameForUser({ name, userId });
				if (existing && existing.id !== collectionId) {
					return yield* nameTaken();
				}
				return undefined;
			});

			/** Commits one collection entity create or update, answering the saved entity or `rejected`'s. */
			const saveCollection = <A, E>(
				userId: UserId,
				entity: NonNullable<Changes["entity"]>,
				command: DomainLifecycleCommand,
				rejected: (error: EntityStale | EntityNotFound | EntityBadRequest) => Effect.Effect<A, E>,
			) =>
				changes
					.commit({ entity, userId }, command, { entities: { verbatimIdentities: true } })
					.pipe(
						Effect.flatMap(savedEntity),
						Effect.catch((error): Effect.Effect<A, E | DbError> => {
							if (
								error._tag === "EntityBadRequest" ||
								error._tag === "EntityNotFound" ||
								error._tag === "EntityStale"
							) {
								return rejected(error);
							}
							return error._tag === "DbError" ? Effect.fail(error) : Effect.die(error);
						}),
					);

			const create = Effect.fn("CollectionsService.create")(function* (
				user: CurrentUserValue,
				payload: CreateCollectionBody,
				command: DomainLifecycleCommand,
			) {
				const name = yield* requireName(payload.name);
				const fields = yield* Effect.fromResult(
					prepareCollectionFields(payload.fields ?? [], new Set()),
				);
				yield* assertNameAvailable(user.id, name);
				const entitySchema = yield* collectionEntitySchema;
				const lifecycle = kernelCollectionLifecycleCommand(command);
				const created = yield* saveCollection(
					user.id,
					{
						name,
						target: { kind: "create" },
						itemIdentity: lifecycle.itemIdentity,
						entitySchema: entitySchema.entitySchema,
						properties: collectionProperties(payload.description, fields),
					},
					lifecycle,
					collectionRejected,
				);
				return toCollectionResponse(created);
			});

			const update = Effect.fn("CollectionsService.update")(function* (
				user: CurrentUserValue,
				payload: UpdateCollectionBody,
				command: DomainLifecycleCommand,
			) {
				const current = yield* repository.getCollectionById(payload.collectionId, user.id);
				if (!current) {
					return yield* collectionNotFound(payload.collectionId);
				}
				const name = yield* requireName(payload.name);
				const stored = yield* Effect.fromResult(
					decodeCollectionFields(storedMembershipFields(current.properties)),
				).pipe(
					Effect.mapError(
						() => new CollectionBadRequest({ reason: { code: "invalid-collection-schema" } }),
					),
				);
				const fields = yield* Effect.fromResult(
					prepareCollectionFields(payload.fields, new Set(stored.map(({ key }) => key))),
				);
				yield* assertNameAvailable(user.id, name, current.id);
				const entitySchema = yield* collectionEntitySchema;
				const lifecycle = kernelCollectionLifecycleCommand(command);
				const updated = yield* saveCollection(
					user.id,
					{
						name,
						itemIdentity: lifecycle.itemIdentity,
						entitySchema: entitySchema.entitySchema,
						properties: collectionProperties(payload.description, fields),
						target: {
							kind: "update",
							entityId: current.id,
							expected: {
								name: current.name,
								updatedAt: current.updatedAt,
								properties: current.properties,
							},
						},
					},
					lifecycle,
					(error): Effect.Effect<never, CollectionNotFound | CollectionBadRequest> => {
						if (error._tag === "EntityNotFound") {
							return Effect.fail(collectionNotFound(current.id));
						}
						return error._tag === "EntityStale"
							? Effect.fail(
									new CollectionBadRequest({
										reason: { code: "collection-stale", collectionId: current.id },
									}),
								)
							: collectionRejected(error);
					},
				);
				return toCollectionResponse(updated);
			});

			const deleteCollection = Effect.fn("CollectionsService.delete")(function* (
				user: CurrentUserValue,
				payload: DeleteCollectionBody,
				command: DomainLifecycleCommand,
			) {
				const entitySchema = yield* collectionEntitySchema;
				const deleted = yield* changes
					.commit(
						{
							userId: user.id,
							entities: {
								deletes: [
									{ entityId: payload.collectionId, entitySchema: entitySchema.entitySchema },
								],
							},
						},
						kernelCollectionLifecycleCommand(command),
					)
					.pipe(
						Effect.catch(
							(
								error,
							): Effect.Effect<never, DbError | CollectionNotFound | CollectionBadRequest> => {
								if (error._tag === "EntityBadRequest") {
									return Effect.fail(invalidCollection(error));
								}
								if (error._tag === "EntityNotFound") {
									return Effect.fail(collectionNotFound(payload.collectionId));
								}
								return error._tag === "DbError" ? Effect.fail(error) : Effect.die(error);
							},
						),
					);
				if (deleted.deleted.length === 0) {
					return yield* collectionNotFound(payload.collectionId);
				}
				return { id: payload.collectionId };
			});

			/** The user's collection with the trimmed name, created when absent. */
			const getOrCreateCollection = Effect.fn("CollectionsService.getOrCreateCollection")(
				function* (userId: UserId, rawName: string, command: DomainLifecycleCommand) {
					const name = rawName.trim();
					const entitySchema = yield* collectionEntitySchema;
					const existing = yield* repository.findCollectionByNameForUser({ name, userId });
					if (existing) {
						return { id: existing.id } satisfies CollectionEntityResult;
					}
					const lifecycle = childCollectionLifecycleCommand(
						kernelCollectionLifecycleCommand(command),
						stableStringify(["collection:get-or-create", name]),
					);
					const created = yield* saveCollection(
						userId,
						{
							name,
							target: { kind: "create" },
							itemIdentity: lifecycle.itemIdentity,
							entitySchema: entitySchema.entitySchema,
							properties: collectionProperties(undefined, []),
						},
						lifecycle,
						(error) =>
							error._tag === "EntityBadRequest" && error.reason.code === "duplicate-collection-name"
								? repository
										.findCollectionByNameForUser({ name, userId })
										.pipe(
											Effect.flatMap(
												requireBuiltinOrDie(
													"duplicate collection name conflict has no surviving row",
												),
											),
										)
								: Effect.die(error),
					);
					return { id: created.id } satisfies CollectionEntityResult;
				},
			);

			/** Commits the membership's relationship change under the membership command's own identity. */
			const commitRelationship = Effect.fnUntraced(function* <E>(
				target: MembershipTarget,
				relationships: NonNullable<Changes["relationships"]>,
				rejected: (error: RelationshipBadRequest) => E,
			) {
				const committed = yield* changes
					.commit({ relationships, userId: target.userId }, target.command, {
						relationships: { verbatimIdentities: true },
					})
					.pipe(
						Effect.catch((error): Effect.Effect<never, E | DbError> => {
							if (error._tag === "RelationshipBadRequest") {
								return Effect.fail(rejected(error));
							}
							return error._tag === "DbError" ? Effect.fail(error) : Effect.die(error);
						}),
					);
				const [result] = committed.relationships;
				return result ?? (yield* Effect.die("A membership commit returned no relationship"));
			});

			const committedMembership = Effect.fnUntraced(function* (
				pending: MembershipDetails,
				committed: RelationshipWriteResult,
			) {
				const { change, collectionId, ...membership } = pending;
				if (!committed.relationship) {
					return yield* change === "add"
						? Effect.die("membership upsert returned no relationship")
						: new CollectionNotFound({
								reason: {
									collectionId,
									code: "membership-not-found",
									entityId: membership.entityId,
								},
							});
				}
				const { wasInserted, ...memberOf } = committed.relationship;
				const emitsEvent = change === "add" ? wasInserted : committed.operation === "delete";
				return {
					...membership,
					operation: committed.operation,
					memberOf: { ...memberOf, relationshipSchemaPluginId: null },
					eventSchemaSlug: emitsEvent ? membership.eventSchemaSlug : null,
				} satisfies CollectionMembershipResult;
			});

			const resolveMembershipTarget = Effect.fnUntraced(function* (input: MembershipTarget) {
				const collection = yield* repository.getCollectionById(input.collectionId, input.userId);
				if (!collection) {
					return yield* collectionNotFound(input.collectionId);
				}
				const entity = yield* repository.getEntityForMembership(input.entityId, input.userId);
				if (!entity) {
					return yield* new CollectionNotFound({
						reason: { code: "entity-not-found", entityId: input.entityId },
					});
				}
				return { entity, collection };
			});

			const addMembership = Effect.fn("CollectionsService.addMembership")(function* (
				input: MembershipTarget & { properties?: unknown; mode?: CreateMembershipBody["mode"] },
			) {
				if (input.collectionId === input.entityId) {
					return yield* new CollectionBadRequest({ reason: { code: "circular-membership" } });
				}
				const { entity, collection } = yield* resolveMembershipTarget(input);
				const propertiesSchema = yield* Effect.fromResult(
					collectionMembershipSchema(storedMembershipFields(collection.properties)),
				);
				const validated = yield* parseAppSchemaProperties({
					propertiesSchema,
					kind: "Membership",
					properties: input.properties ?? {},
				}).pipe(
					Effect.mapError(
						(error) =>
							new CollectionBadRequest({
								reason: {
									code: "invalid-membership-properties",
									paths: error.issues.map(({ path }) => path),
								},
							}),
					),
				);
				const existing = yield* repository.findMembership(input);
				const storedRank = existing?.properties["rank"];
				const rank = typeof storedRank === "number" ? storedRank : 0;
				const addEvent = yield* addEventSchema;
				const relationship = {
					properties: { ...validated, rank },
					itemIdentity: input.command.itemIdentity,
					relationshipSchema: yield* memberOfReference,
					source: { entityId: input.entityId, kind: "existing" as const },
					target: { kind: "existing" as const, entityId: input.collectionId },
				};
				const committed = yield* commitRelationship(
					input,
					input.mode === "add-if-absent"
						? { ensures: [relationship] }
						: { upserts: [{ ...relationship, propertiesMode: "replace" }] },
					invalidMembership,
				);
				return yield* committedMembership(
					{
						change: "add",
						entityId: entity.id,
						collectionId: input.collectionId,
						occurredAt: input.command.occurredAt,
						eventSchemaSlug: addEvent?.id ?? null,
						entitySchemaSlug: entity.entitySchemaSlug,
					},
					committed,
				);
			});

			const removeMembership = Effect.fn("CollectionsService.removeMembership")(function* (
				input: MembershipTarget,
			) {
				const { entity } = yield* resolveMembershipTarget(input);
				const membershipNotFound = new CollectionNotFound({
					reason: {
						entityId: input.entityId,
						code: "membership-not-found",
						collectionId: input.collectionId,
					},
				});
				const existing = yield* repository.findMembership(input);
				if (!existing) {
					return yield* membershipNotFound;
				}
				const removeEvent = yield* removeEventSchema;
				const committed = yield* commitRelationship(
					input,
					{
						deletesById: [
							{ relationshipId: existing.id, itemIdentity: input.command.itemIdentity },
						],
					},
					invalidMembership,
				);
				if (!committed.relationship) {
					return yield* membershipNotFound;
				}
				return yield* committedMembership(
					{
						change: "remove",
						entityId: entity.id,
						collectionId: input.collectionId,
						occurredAt: input.command.occurredAt,
						eventSchemaSlug: removeEvent?.id ?? null,
						entitySchemaSlug: entity.entitySchemaSlug,
					},
					committed,
				);
			});

			const writeMembership = Effect.fn("CollectionsService.writeMembership")(function* (
				input: MembershipInput,
			) {
				const command = kernelCollectionLifecycleCommand(input.command);
				const target = {
					command,
					userId: input.userId,
					entityId: input.entityId,
					collectionId: input.collectionId,
				};
				const result =
					input.operation === "add"
						? yield* addMembership({ ...target, mode: input.mode, properties: input.properties })
						: yield* removeMembership(target);
				if (!result.eventSchemaSlug) {
					return { memberOf: result.memberOf, operation: result.operation };
				}
				const created = yield* changes
					.commit(
						eventCreateChanges(input.userId, [
							{
								entityId: input.collectionId,
								occurredAt: result.occurredAt,
								eventSchemaSlug: result.eventSchemaSlug,
								properties: {
									entityId: result.entityId,
									relationshipId: result.memberOf.id,
									entitySchemaSlug: result.entitySchemaSlug,
									relationshipProperties: result.memberOf.properties,
								},
							},
						]),
						childCollectionLifecycleCommand(command, `event:${result.memberOf.id}`),
						{ events: { independent: true } },
					)
					.pipe(
						Effect.map((written) => toCreateEventsResponse(written.outcomes)),
						Effect.result,
					);
				const failure =
					created._tag === "Failure" ? created.failure : created.success.failure?.reason;
				if (failure === undefined) {
					return { memberOf: result.memberOf, operation: result.operation };
				}
				const relationshipId = result.memberOf.id;
				const childCommand = childCollectionLifecycleCommand(
					command,
					`compensation:${relationshipId}`,
				);
				yield* commitRelationship(
					{ ...target, command: childCommand },
					input.operation === "add"
						? { deletesById: [{ relationshipId, itemIdentity: childCommand.itemIdentity }] }
						: {
								upserts: [
									{
										propertiesMode: "replace",
										properties: result.memberOf.properties,
										itemIdentity: childCommand.itemIdentity,
										relationshipSchema: yield* memberOfReference,
										source: { kind: "existing", entityId: input.entityId },
										target: { kind: "existing", entityId: input.collectionId },
									},
								],
							},
					compensationFailed,
				);
				yield* Effect.logWarning("collection membership event failed", { failure });
				return yield* new CollectionBadRequest({ reason: { code: "membership-event-failed" } });
			});

			const addToCollection = Effect.fn("CollectionsService.addToCollection")(function* (
				user: CurrentUserValue,
				payload: CreateMembershipBody,
				command: DomainLifecycleCommand,
			) {
				return yield* writeMembership({
					command,
					userId: user.id,
					operation: "add",
					mode: payload.mode,
					entityId: payload.entityId,
					properties: payload.properties,
					collectionId: payload.collectionId,
				});
			});

			const removeFromCollection = Effect.fn("CollectionsService.removeFromCollection")(function* (
				user: CurrentUserValue,
				payload: DeleteMembershipBody,
				command: DomainLifecycleCommand,
			) {
				const { memberOf } = yield* writeMembership({
					command,
					userId: user.id,
					operation: "remove",
					entityId: payload.entityId,
					collectionId: payload.collectionId,
				});
				return { memberOf };
			});

			return {
				create,
				update,
				writeMembership,
				addToCollection,
				removeFromCollection,
				getOrCreateCollection,
				delete: deleteCollection,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
