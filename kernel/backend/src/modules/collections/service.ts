import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { collectionFieldsToAppSchema } from "@ryot-app/contract/modules/collections/fields";
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
import { type EntityBadRequest, ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import {
	EntityId,
	EventSchemaSlug,
	type RelationshipId,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Result, Schema, Struct } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type {
	LifecycleCommittedStep,
	LifecyclePreparedStep,
} from "#modules/automations/lifecycle/write-step";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import type { EntitySnapshotResult } from "#modules/entities/mutation-outcomes";
import { EntitiesService, type PendingEntityMutation } from "#modules/entities/service";
import {
	type DomainLifecycleCommand,
	kernelCollectionLifecycleCommand,
} from "#modules/entities/write-context";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	PendingRelationshipMutations,
	RelationshipSingleResult,
} from "#modules/relationships/mutation-pipeline";
import { RelationshipsService } from "#modules/relationships/service";
import { trimToNull } from "#platform/validation";

import {
	CollectionMembershipWorkflow,
	type CollectionMembershipWorkflowPayload,
} from "./collection-membership-workflow";
import {
	collectionMembershipSchema,
	prepareCollectionFields,
	storedCollectionFields,
} from "./fields";
import { CollectionsRepository } from "./repository";
import { isPlainObject, toCollectionResponse } from "./service-support";

export const CollectionMembershipResult = Schema.Struct({
	entityId: EntityId,
	occurredAt: Schema.String,
	entitySchemaSlug: Schema.String,
	memberOf: MembershipResponse.fields.memberOf,
	eventSchemaSlug: Schema.NullOr(EventSchemaSlug),
	operation: RelationshipSingleResult.fields.operation,
});
export type CollectionMembershipResult = typeof CollectionMembershipResult.Type;

const PendingMembershipDetails = Schema.Struct({
	...Struct.omit(CollectionMembershipResult.fields, ["memberOf", "operation"]),
	collectionId: EntityId,
	change: Schema.Literals(["add", "remove"]),
});

export const PendingCollectionMembership = Schema.Struct({
	membership: PendingMembershipDetails,
	mutations: PendingRelationshipMutations,
});
export type PendingCollectionMembership = typeof PendingCollectionMembership.Type;

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

const collectionStep = (
	prepared: LifecyclePreparedStep<EntitySnapshotResult, PendingEntityMutation>,
): LifecyclePreparedStep<CollectionEntityResult, PendingEntityMutation> =>
	prepared._tag === "Committed"
		? { ...prepared, result: { id: prepared.result.entity.id } }
		: prepared;

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
	description: string | null | undefined,
	fields: Parameters<typeof collectionFieldsToAppSchema>[0],
) => {
	const trimmed = trimToNull(description ?? "");
	return {
		...(trimmed ? { description: trimmed } : {}),
		...(fields.length > 0
			? { membershipPropertiesSchema: collectionFieldsToAppSchema(fields) }
			: {}),
	};
};

const storedMembershipSchema = (properties: unknown) =>
	isPlainObject(properties) ? properties["membershipPropertiesSchema"] : undefined;

export class CollectionsService extends Context.Service<CollectionsService>()(
	"CollectionsService",
	{
		make: Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const entities = yield* EntitiesService;
			const repository = yield* CollectionsRepository;
			const relationships = yield* RelationshipsService;
			const receipts = yield* MutationReceipts.make;
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
				const created = yield* entities
					.create({
						name,
						scope: "user",
						userId: user.id,
						entitySchema: entitySchema.entitySchema,
						lifecycle: kernelCollectionLifecycleCommand(command),
						properties: collectionProperties(payload.description, fields),
					})
					.pipe(
						Effect.catchTags({
							EntityNotFound: (error) => Effect.die(error),
							EntityBadRequest: (error) =>
								error.reason.code === "duplicate-collection-name"
									? nameTaken()
									: invalidCollection(error),
						}),
					);
				return toCollectionResponse(created.entity, created.warnings);
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
				const stored = storedCollectionFields(storedMembershipSchema(current.properties));
				const fields = yield* Effect.fromResult(
					prepareCollectionFields(
						payload.fields,
						new Set(Result.isSuccess(stored) ? stored.success.map(({ key }) => key) : []),
					),
				);
				yield* assertNameAvailable(user.id, name, current.id);
				const updated = yield* entities
					.update({
						name,
						scope: "user",
						userId: user.id,
						entityId: current.id,
						requireUserOwned: true,
						lifecycle: kernelCollectionLifecycleCommand(command),
						properties: collectionProperties(payload.description, fields),
						expected: {
							name: current.name,
							updatedAt: current.updatedAt,
							properties: current.properties,
						},
					})
					.pipe(
						Effect.catchTags({
							EntityNotFound: () => collectionNotFound(current.id),
							EntityStale: () =>
								new CollectionBadRequest({
									reason: { code: "collection-stale", collectionId: current.id },
								}),
							EntityBadRequest: (error) =>
								error.reason.code === "duplicate-collection-name"
									? nameTaken()
									: invalidCollection(error),
						}),
					);
				return toCollectionResponse(updated.entity, updated.warnings);
			});

			const deleteCollection = Effect.fn("CollectionsService.delete")(function* (
				user: CurrentUserValue,
				payload: DeleteCollectionBody,
				command: DomainLifecycleCommand,
			) {
				const entitySchema = yield* collectionEntitySchema;
				const deleted = yield* entities
					.deleteByIds([payload.collectionId], kernelCollectionLifecycleCommand(command), {
						userId: user.id,
						entitySchema: entitySchema.entitySchema,
					})
					.pipe(
						Effect.catchTags({
							EntityBadRequest: invalidCollection,
							EntityNotFound: () => collectionNotFound(payload.collectionId),
						}),
					);
				if (deleted.deletedCount === 0) {
					return yield* collectionNotFound(payload.collectionId);
				}
				return { id: payload.collectionId, warnings: deleted.warnings };
			});

			const findExistingCollection = Effect.fnUntraced(function* (userId: UserId, name: string) {
				const existing = yield* repository.findCollectionByNameForUser({ name, userId });
				if (!existing) {
					return yield* Effect.die("duplicate collection name conflict has no surviving row");
				}
				return {
					dispatch: [],
					_tag: "Committed",
					result: { id: existing.id },
				} satisfies LifecycleCommittedStep<CollectionEntityResult>;
			});

			const prepareGetOrCreateCollection = Effect.fn(
				"CollectionsService.prepareGetOrCreateCollection",
			)(function* (userId: UserId, rawName: string, command: DomainLifecycleCommand) {
				const name = rawName.trim();
				const entitySchema = yield* collectionEntitySchema;
				const existing = yield* repository.findCollectionByNameForUser({ name, userId });
				if (existing) {
					return {
						dispatch: [],
						_tag: "Committed",
						result: { id: existing.id },
					} satisfies LifecycleCommittedStep<CollectionEntityResult>;
				}
				const lifecycle = childCollectionLifecycleCommand(
					kernelCollectionLifecycleCommand(command),
					stableStringify(["collection:get-or-create", name]),
				);
				return yield* entities
					.prepareCreateStep({
						name,
						userId,
						lifecycle,
						scope: "user",
						properties: {},
						entitySchema: entitySchema.entitySchema,
					})
					.pipe(
						Effect.map(collectionStep),
						Effect.catchTags({
							EntityNotFound: (error) => Effect.die(error),
							EntityBadRequest: (error) =>
								error.reason.code === "duplicate-collection-name"
									? findExistingCollection(userId, name)
									: Effect.die(error),
						}),
					);
			});

			const committedMembership = Effect.fnUntraced(function* (
				pending: PendingCollectionMembership["membership"],
				committed: LifecycleCommittedStep<RelationshipSingleResult>,
			) {
				const { change, collectionId, ...membership } = pending;
				if (!committed.result.relationship) {
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
				const { wasInserted, ...memberOf } = committed.result.relationship;
				const emitsEvent = change === "add" ? wasInserted : committed.result.operation === "delete";
				return {
					...committed,
					result: {
						...membership,
						operation: committed.result.operation,
						memberOf: { ...memberOf, relationshipSchemaPluginId: null },
						eventSchemaSlug: emitsEvent ? membership.eventSchemaSlug : null,
					},
				} satisfies LifecycleCommittedStep<CollectionMembershipResult>;
			});

			const applyMembershipPolicies = (pending: PendingCollectionMembership) =>
				relationships.applyPolicies(pending.mutations).pipe(
					Effect.map((mutations) => ({ ...pending, mutations })),
					Effect.catchTag("RelationshipBadRequest", invalidMembership),
				);

			const commitMembership = (pending: PendingCollectionMembership) =>
				relationships.commitSingle(pending.mutations).pipe(
					Effect.catchTags({
						RelationshipBadRequest: invalidMembership,
						RelationshipNotFound: (error) => Effect.die(error),
					}),
					Effect.flatMap((committed) =>
						committed._tag === "Committed"
							? committedMembership(pending.membership, committed)
							: Effect.die("membership commit requires policies"),
					),
				);

			const membershipStep = Effect.fnUntraced(function* (
				membership: PendingCollectionMembership["membership"],
				prepared: LifecyclePreparedStep<RelationshipSingleResult, PendingRelationshipMutations>,
			) {
				if (prepared._tag === "PoliciesRequired") {
					return {
						_tag: "PoliciesRequired",
						pending: { membership, mutations: prepared.pending },
					} satisfies LifecyclePreparedStep<
						CollectionMembershipResult,
						PendingCollectionMembership
					>;
				}
				return yield* committedMembership(membership, prepared);
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

			const memberRank = Effect.fnUntraced(function* (
				input: MembershipTarget,
				existing: { readonly properties: Record<string, unknown> } | null,
			) {
				const stored = existing?.properties["rank"];
				if (typeof stored === "number") {
					return stored;
				}
				const lowest = yield* repository.findLowestMemberRank(input);
				return (lowest ?? 1) - 1;
			});

			const prepareMembership = Effect.fn("CollectionsService.prepareMembership")(function* (
				input: MembershipTarget & { mode?: CreateMembershipBody["mode"]; properties?: unknown },
			) {
				if (input.collectionId === input.entityId) {
					return yield* new CollectionBadRequest({ reason: { code: "circular-membership" } });
				}
				const { entity, collection } = yield* resolveMembershipTarget(input);
				const propertiesSchema = yield* Effect.fromResult(
					collectionMembershipSchema(storedMembershipSchema(collection.properties)),
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
				const rank = yield* memberRank(input, existing);
				const addEvent = yield* addEventSchema;
				const prepared = yield* relationships
					.prepareCreate(
						{
							scope: "user",
							userId: input.userId,
							sourceEntityId: input.entityId,
							targetEntityId: input.collectionId,
							properties: { ...validated, rank },
							ifAbsent: input.mode === "add-if-absent",
							relationshipSchema: yield* memberOfReference,
						},
						input.command,
					)
					.pipe(
						Effect.catchTags({
							RelationshipBadRequest: invalidMembership,
							RelationshipNotFound: (error) => Effect.die(error),
						}),
					);
				return yield* membershipStep(
					{
						change: "add",
						entityId: entity.id,
						collectionId: input.collectionId,
						occurredAt: input.command.occurredAt,
						eventSchemaSlug: addEvent?.id ?? null,
						entitySchemaSlug: entity.entitySchemaSlug,
					},
					prepared,
				);
			});

			const prepareRemoval = Effect.fn("CollectionsService.prepareRemoval")(function* (
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
				const prepared = yield* relationships
					.prepareDeleteUserRelationshipById(input.userId, existing.id, input.command)
					.pipe(
						Effect.catchTags({
							RelationshipBadRequest: invalidMembership,
							RelationshipNotFound: (error) => Effect.die(error),
						}),
					);
				if (prepared._tag === "Committed" && !prepared.result.relationship) {
					return yield* membershipNotFound;
				}
				return yield* membershipStep(
					{
						change: "remove",
						entityId: entity.id,
						collectionId: input.collectionId,
						occurredAt: input.command.occurredAt,
						eventSchemaSlug: removeEvent?.id ?? null,
						entitySchemaSlug: entity.entitySchemaSlug,
					},
					prepared,
				);
			});

			const dispatchMembership = (
				user: CurrentUserValue,
				payload: Omit<CollectionMembershipWorkflowPayload, "userId" | "executionId" | "command">,
				command: DomainLifecycleCommand,
			) => {
				const executionId = command.causation.executionId;
				return dispatchAdmittedWorkflow(
					receipts,
					engine,
					CollectionMembershipWorkflow,
					command.accountGeneration,
					{ executionId, payload: { ...payload, command, executionId, userId: user.id } },
					(admission) => admission,
					(execution) => execution,
				);
			};

			const addToCollection = Effect.fn("CollectionsService.addToCollection")(function* (
				user: CurrentUserValue,
				payload: CreateMembershipBody,
				command: DomainLifecycleCommand,
			) {
				return yield* dispatchMembership(
					user,
					{
						operation: "add",
						mode: payload.mode,
						entityId: payload.entityId,
						properties: payload.properties,
						collectionId: payload.collectionId,
					},
					command,
				);
			});

			const removeFromCollection = Effect.fn("CollectionsService.removeFromCollection")(function* (
				user: CurrentUserValue,
				payload: DeleteMembershipBody,
				command: DomainLifecycleCommand,
			) {
				const { memberOf, warnings } = yield* dispatchMembership(
					user,
					{ operation: "remove", entityId: payload.entityId, collectionId: payload.collectionId },
					command,
				);
				return { memberOf, warnings };
			});

			const prepareCompensation = (
				userId: UserId,
				relationshipId: RelationshipId,
				command: DomainLifecycleCommand,
			) =>
				relationships
					.prepareDeleteUserRelationshipById(userId, relationshipId, command)
					.pipe(
						Effect.catchTags({
							RelationshipNotFound: Effect.die,
							RelationshipBadRequest: compensationFailed,
						}),
					);

			const prepareRestoration = Effect.fn("CollectionsService.prepareRestoration")(function* (
				input: MembershipTarget & { properties: unknown },
			) {
				return yield* relationships
					.prepareCreate(
						{
							scope: "user",
							userId: input.userId,
							properties: input.properties,
							sourceEntityId: input.entityId,
							targetEntityId: input.collectionId,
							relationshipSchema: yield* memberOfReference,
						},
						input.command,
					)
					.pipe(
						Effect.catchTags({
							RelationshipNotFound: Effect.die,
							RelationshipBadRequest: compensationFailed,
						}),
					);
			});

			const applyCompensationPolicies = (pending: PendingRelationshipMutations) =>
				relationships
					.applyPolicies(pending)
					.pipe(Effect.catchTag("RelationshipBadRequest", compensationFailed));

			const commitCompensation = (pending: PendingRelationshipMutations) =>
				relationships
					.commitSingle(pending)
					.pipe(
						Effect.catchTags({
							RelationshipNotFound: Effect.die,
							RelationshipBadRequest: compensationFailed,
						}),
					);

			return {
				create,
				update,
				prepareRemoval,
				addToCollection,
				commitMembership,
				prepareMembership,
				commitCompensation,
				prepareRestoration,
				prepareCompensation,
				removeFromCollection,
				applyMembershipPolicies,
				delete: deleteCollection,
				applyCompensationPolicies,
				prepareGetOrCreateCollection,
				applyCollectionPolicies: (pending: PendingEntityMutation) =>
					entities
						.applyMutationPolicies(pending)
						.pipe(Effect.catchTag("EntityBadRequest", (error) => Effect.die(error))),
				commitCollection: (pending: PendingEntityMutation) =>
					entities
						.commitMutation(pending)
						.pipe(
							Effect.map(collectionStep),
							Effect.catchTags({
								EntityNotFound: (error) => Effect.die(error),
								EntityBadRequest: (error) =>
									error.reason.code === "duplicate-collection-name" && pending.scopeUserId !== null
										? findExistingCollection(pending.scopeUserId, pending.draft.name)
										: Effect.die(error),
							}),
						),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
