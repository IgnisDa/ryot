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
	type UpdateCollectionBody,
} from "@ryot-app/contract/modules/collections/schemas";
import type { EntityBadRequest, EntityNotFound } from "@ryot-app/contract/modules/entities/schemas";
import type { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import {
	type EntityId,
	EventSchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { parseAppSchemaProperties } from "@ryot-app/contract/schema/property-values";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Context, Effect, Layer } from "effect";

import type { Changes, EntityReference, RelationshipEvent } from "#modules/changes/changes";
import type { CommitConflict } from "#modules/changes/conflict";
import { savedEntity } from "#modules/changes/receipts";
import { ChangeSets } from "#modules/changes/service";
import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import {
	type DomainLifecycleCommand,
	kernelCollectionLifecycleCommand,
} from "#modules/entities/write-context";
import { trimToNull } from "#platform/validation";

import { collectionMembershipSchema, prepareCollectionFields } from "./fields";
import { CollectionsRepository } from "./repository";
import { toCollectionResponse } from "./service-support";

type CollectionCreate = NonNullable<NonNullable<Changes["entities"]>["creates"]>[number];

type MembershipTarget = {
	readonly userId: UserId;
	readonly entityId: EntityId;
	readonly collectionId: EntityId;
	readonly command: DomainLifecycleCommand;
};

const invalidMembership = (error: CommitConflict | RelationshipBadRequest) =>
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

const membershipEventFailures = new Set([
	"CommitConflict",
	"EventBadRequest",
	"EventCreateItemError",
]);
const membershipEventFailed = () =>
	new CollectionBadRequest({ reason: { code: "membership-event-failed" } });

const nameTaken = () => new CollectionBadRequest({ reason: { field: "name", code: "name-taken" } });

const collectionNotFound = (collectionId: EntityId) =>
	new CollectionNotFound({ reason: { collectionId, code: "collection-not-found" } });

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

const collectionRejected = (error: CommitConflict | EntityNotFound | EntityBadRequest) => {
	if (error._tag !== "EntityBadRequest") {
		return Effect.die(error);
	}
	return error.reason.code === "duplicate-collection-name"
		? Effect.fail(nameTaken())
		: Effect.fail(invalidCollection(error));
};

/** The membership event a relationship change records when it adds or deletes the member. */
const membershipEvent = (input: {
	readonly occurredAt: string;
	readonly itemIdentity: string;
	readonly change: "add" | "remove";
	readonly memberSchemaSlug: string;
	readonly collection: EntityReference;
	readonly eventSchemaSlug: EventSchemaSlug;
}): RelationshipEvent => ({
	kernelCollection: true,
	entity: input.collection,
	occurredAt: input.occurredAt,
	relationship: input.itemIdentity,
	eventSchemaSlug: input.eventSchemaSlug,
	itemIdentity: `${input.itemIdentity}:membership-event`,
	properties: ({ operation, relationship }) =>
		relationship && (input.change === "add" ? relationship.wasInserted : operation === "delete")
			? {
					relationshipId: relationship.id,
					entityId: relationship.sourceEntityId,
					entitySchemaSlug: input.memberSchemaSlug,
					relationshipProperties: relationship.properties,
				}
			: null,
});

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
				const [existing] = yield* repository.findCollectionsByNameForUser({
					userId,
					names: [name],
				});
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
				rejected: (
					error: CommitConflict | EntityNotFound | EntityBadRequest,
				) => Effect.Effect<A, E>,
			) =>
				changes
					.commit({ entity, userId }, command, { entities: { verbatimIdentities: true } })
					.pipe(
						Effect.flatMap(savedEntity),
						Effect.catch((error): Effect.Effect<A, E | DbError> => {
							if (
								error._tag === "EntityBadRequest" ||
								error._tag === "EntityNotFound" ||
								error._tag === "CommitConflict"
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
						if (
							error._tag === "EntityNotFound" ||
							(error._tag === "CommitConflict" && error.reason.code === "entity-not-found")
						) {
							return Effect.fail(collectionNotFound(current.id));
						}
						return error._tag === "CommitConflict"
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
								if (
									error._tag === "EntityNotFound" ||
									(error._tag === "CommitConflict" && error.reason.code === "entity-not-found")
								) {
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

			/**
			 * The relationship change adding `member` to `collection` under the item identity, with its
			 * membership event; the properties are checked against the collection's membership fields.
			 */
			const membershipAdd = Effect.fnUntraced(function* (input: {
				readonly occurredAt: string;
				readonly properties: unknown;
				readonly itemIdentity: string;
				readonly member: EntityReference;
				readonly memberSchemaSlug: string;
				readonly membershipFields: unknown;
				readonly collection: EntityReference;
				readonly mode?: CreateMembershipBody["mode"];
			}) {
				const propertiesSchema = yield* Effect.fromResult(
					collectionMembershipSchema(input.membershipFields),
				);
				const properties = yield* parseAppSchemaProperties({
					propertiesSchema,
					kind: "Membership",
					properties: input.properties,
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
				const addEvent = yield* addEventSchema;
				const relationship = {
					properties,
					source: input.member,
					target: input.collection,
					kernelCollection: true as const,
					itemIdentity: input.itemIdentity,
					relationshipSchema: yield* memberOfReference,
				};
				const parts: NonNullable<Changes["relationships"]> = {
					...(input.mode === "add-if-absent"
						? { ensures: [relationship] }
						: { upserts: [{ ...relationship, propertiesMode: "replace" }] }),
					events: addEvent
						? [membershipEvent({ ...input, change: "add", eventSchemaSlug: addEvent.id })]
						: [],
				};
				return parts;
			});

			/** The membership fields of the user's collections with the names, by name. */
			const membershipFieldsByName = Effect.fn("CollectionsService.membershipFieldsByName")(
				function* (userId: UserId, names: ReadonlyArray<string>) {
					const collections = yield* repository.findCollectionsByNameForUser({
						userId,
						names: [...new Set(names.map((name) => name.trim()))],
					});
					return Object.fromEntries(
						collections.map(({ name, properties }) => [
							name,
							storedMembershipFields(properties) ?? [],
						]),
					);
				},
			);

			/**
			 * The parts adding each member to the user's collection with the trimmed name, creating the
			 * collection when none has it. `membershipFields` holds the fields of the collections that
			 * existed, by name; a membership its collection's fields reject is left out.
			 */
			const namedMemberships = Effect.fn("CollectionsService.namedMemberships")(function* (input: {
				readonly occurredAt: string;
				readonly membershipFields: Readonly<Record<string, unknown>>;
				readonly memberships: ReadonlyArray<{
					readonly itemIdentity: string;
					readonly collectionName: string;
					readonly member: EntityReference;
					readonly memberSchemaSlug: string;
				}>;
			}) {
				const { entitySchema } = yield* collectionEntitySchema;
				const creates = new Map<string, CollectionCreate>();
				const upserts: Array<
					NonNullable<NonNullable<Changes["relationships"]>["upserts"]>[number]
				> = [];
				const events: Array<RelationshipEvent> = [];
				for (const membership of input.memberships) {
					const name = membership.collectionName.trim();
					const key = stableStringify(["collection", name]);
					const added = yield* membershipAdd({
						...membership,
						properties: {},
						occurredAt: input.occurredAt,
						collection: { key, kind: "keyed" },
						membershipFields: input.membershipFields[name],
					}).pipe(Effect.catchTag("CollectionBadRequest", () => Effect.succeed(null)));
					if (added === null) {
						continue;
					}
					upserts.push(...(added.upserts ?? []));
					events.push(...(added.events ?? []));
					if (!creates.has(name)) {
						creates.set(name, {
							key,
							name,
							entitySchema,
							kernelCollection: true,
							properties: collectionProperties(undefined, []),
							itemIdentity: `${membership.itemIdentity}:collection`,
							match: {
								name,
								scope: "user",
								properties: {},
								required: false,
								nameNormalization: "exact",
							},
						});
					}
				}
				return { creates: [...creates.values()], relationships: { events, upserts } };
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

			/** Commits a membership's relationship change and the membership event it records. */
			const commitMembership = Effect.fnUntraced(function* (
				target: MembershipTarget & { readonly change: "add" | "remove" },
				relationships: NonNullable<Changes["relationships"]>,
			) {
				const committed = yield* changes
					.commit({ relationships, userId: target.userId }, target.command, {
						events: { verbatimIdentities: true },
						relationships: { verbatimIdentities: true },
					})
					.pipe(
						Effect.catch((error): Effect.Effect<never, DbError | CollectionBadRequest> => {
							if (
								error._tag === "RelationshipBadRequest" ||
								(error._tag === "CommitConflict" &&
									error.reason.code === "concurrent-relationship-change")
							) {
								return Effect.fail(invalidMembership(error));
							}
							if (error._tag === "DbError") {
								return Effect.fail(error);
							}
							return membershipEventFailures.has(error._tag)
								? Effect.logWarning("collection membership event failed", { error }).pipe(
										Effect.andThen(Effect.fail(membershipEventFailed())),
									)
								: Effect.die(error);
						}),
					);
				const [result] = committed.relationships;
				if (!result) {
					return yield* Effect.die("A membership commit returned no relationship");
				}
				if (!result.relationship) {
					return yield* target.change === "add"
						? Effect.die("membership upsert returned no relationship")
						: new CollectionNotFound({
								reason: {
									entityId: target.entityId,
									code: "membership-not-found",
									collectionId: target.collectionId,
								},
							});
				}
				const { wasInserted: _inserted, ...memberOf } = result.relationship;
				return {
					operation: result.operation,
					memberOf: { ...memberOf, relationshipSchemaPluginId: null },
				};
			});

			const addMembership = Effect.fn("CollectionsService.addMembership")(function* (
				input: MembershipTarget & { properties?: unknown; mode?: CreateMembershipBody["mode"] },
			) {
				if (input.collectionId === input.entityId) {
					return yield* new CollectionBadRequest({ reason: { code: "circular-membership" } });
				}
				const { entity, collection } = yield* resolveMembershipTarget(input);
				return yield* commitMembership(
					{ ...input, change: "add" },
					yield* membershipAdd({
						...(input.mode === undefined ? {} : { mode: input.mode }),
						properties: input.properties ?? {},
						occurredAt: input.command.occurredAt,
						itemIdentity: input.command.itemIdentity,
						memberSchemaSlug: entity.entitySchemaSlug,
						member: { kind: "existing", entityId: input.entityId },
						collection: { kind: "existing", entityId: input.collectionId },
						membershipFields: storedMembershipFields(collection.properties),
					}),
				);
			});

			const removeMembership = Effect.fn("CollectionsService.removeMembership")(function* (
				input: MembershipTarget,
			) {
				const { entity } = yield* resolveMembershipTarget(input);
				const existing = yield* repository.findMembership(input);
				if (!existing) {
					return yield* new CollectionNotFound({
						reason: {
							entityId: input.entityId,
							code: "membership-not-found",
							collectionId: input.collectionId,
						},
					});
				}
				const removeEvent = yield* removeEventSchema;
				const { occurredAt, itemIdentity } = input.command;
				return yield* commitMembership(
					{ ...input, change: "remove" },
					{
						deletesById: [{ itemIdentity, relationshipId: existing.id }],
						events: removeEvent
							? [
									membershipEvent({
										occurredAt,
										itemIdentity,
										change: "remove",
										eventSchemaSlug: removeEvent.id,
										memberSchemaSlug: entity.entitySchemaSlug,
										collection: { kind: "existing", entityId: input.collectionId },
									}),
								]
							: [],
					},
				);
			});

			const addToCollection = Effect.fn("CollectionsService.addToCollection")(function* (
				user: CurrentUserValue,
				payload: CreateMembershipBody,
				command: DomainLifecycleCommand,
			) {
				return yield* addMembership({
					userId: user.id,
					mode: payload.mode,
					entityId: payload.entityId,
					properties: payload.properties,
					collectionId: payload.collectionId,
					command: kernelCollectionLifecycleCommand(command),
				});
			});

			const removeFromCollection = Effect.fn("CollectionsService.removeFromCollection")(function* (
				user: CurrentUserValue,
				payload: DeleteMembershipBody,
				command: DomainLifecycleCommand,
			) {
				const { memberOf } = yield* removeMembership({
					userId: user.id,
					entityId: payload.entityId,
					collectionId: payload.collectionId,
					command: kernelCollectionLifecycleCommand(command),
				});
				return { memberOf };
			});

			return {
				create,
				update,
				addToCollection,
				namedMemberships,
				removeFromCollection,
				membershipFieldsByName,
				delete: deleteCollection,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
