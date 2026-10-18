import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	CollectionBadRequest,
	CollectionNotFound,
	MembershipResponse,
	type CreateCollectionBody,
	type CreateMembershipBody,
	type DeleteMembershipBody,
} from "@ryot-app/contract/modules/collections/schemas";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import {
	EntityId,
	EventSchemaSlug,
	RelationshipSchemaSlug,
	type RelationshipId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema, Struct } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type {
	LifecycleCommittedStep,
	LifecyclePreparedStep,
} from "#modules/automations/lifecycle/write-step";
import {
	parseAppSchemaProperties,
	parseLabeledPropertySchemaInput,
} from "#modules/definitions/properties/runtime";
import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import type { EntitySnapshotResult } from "#modules/entities/mutation-outcomes";
import { EntitiesService, type PendingEntityMutation } from "#modules/entities/service";
import {
	kernelCollectionLifecycleCommand,
	type DomainLifecycleCommand,
} from "#modules/entities/write-context";
import { EventsService } from "#modules/events/service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	PendingRelationshipMutations,
	RelationshipSingleResult,
} from "#modules/relationships/mutation-pipeline";
import { RelationshipsService } from "#modules/relationships/service";
import { trimToNull } from "#platform/validation";

import { AddEntityToCollectionWorkflow } from "./add-entity-to-collection-workflow";
import { CollectionsRepository } from "./repository";
import { isPlainObject, toCollectionResponse } from "./service-support";

export const CollectionMembershipResult = Schema.Struct({
	entityId: EntityId,
	occurredAt: Schema.String,
	entitySchemaSlug: Schema.String,
	memberOf: MembershipResponse.fields.memberOf,
	addEventSchemaSlug: Schema.NullOr(EventSchemaSlug),
	operation: RelationshipSingleResult.fields.operation,
});
export type CollectionMembershipResult = typeof CollectionMembershipResult.Type;

export const PendingCollectionMembership = Schema.Struct({
	mutations: PendingRelationshipMutations,
	membership: Schema.Struct(
		Struct.omit(CollectionMembershipResult.fields, ["memberOf", "operation"]),
	),
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

const invalidMembership = (error: RelationshipBadRequest) =>
	new CollectionBadRequest({
		reason: {
			code: "invalid-membership-properties",
			paths: error.reason.code === "invalid-properties" ? error.reason.paths : [],
		},
	});

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

export class CollectionsService extends Context.Service<CollectionsService>()(
	"CollectionsService",
	{
		make: Effect.gen(function* () {
			const events = yield* EventsService;
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

			const queueCollectionEvent = (input: {
				readonly userId: UserId;
				readonly entityId: EntityId;
				readonly command: DomainLifecycleCommand;
				readonly eventSchemaSlug: EventSchemaSlug;
				readonly properties: Record<string, unknown>;
			}) =>
				events
					.create(
						{
							userId: input.userId,
							payload: [
								{
									entityId: input.entityId,
									properties: input.properties,
									occurredAt: input.command.occurredAt,
									eventSchemaSlug: input.eventSchemaSlug,
								},
							],
						},
						input.command,
					)
					.pipe(
						Effect.map(({ warnings }) => warnings),
						Effect.catchCause((cause) =>
							Effect.logWarning("collection event enqueue failed", cause).pipe(
								Effect.as([] as ReadonlyArray<AutomationWarning>),
							),
						),
					);

			const create = Effect.fn("CollectionsService.create")(function* (
				user: CurrentUserValue,
				payload: CreateCollectionBody,
				command: DomainLifecycleCommand,
			) {
				const name = trimToNull(payload.name);
				if (!name) {
					return yield* new CollectionBadRequest({
						reason: { field: "name", code: "name-required" },
					});
				}
				const lifecycle = kernelCollectionLifecycleCommand(command);

				if (payload.membershipPropertiesSchema !== undefined) {
					yield* parseLabeledPropertySchemaInput(
						payload.membershipPropertiesSchema,
						"membershipPropertiesSchema",
					).pipe(
						Effect.mapError(
							(error) =>
								new CollectionBadRequest({
									reason: {
										code: "invalid-membership-schema",
										field: "membershipPropertiesSchema",
										paths: error.issues.map(({ path }) => path),
									},
								}),
						),
					);
				}

				const properties: Record<string, unknown> = {};
				if (payload.description !== undefined) {
					properties["description"] = payload.description;
				}
				if (payload.membershipPropertiesSchema !== undefined) {
					properties["membershipPropertiesSchema"] = payload.membershipPropertiesSchema;
				}

				const entitySchema = yield* collectionEntitySchema;
				const created = yield* entities
					.create({
						name,
						lifecycle,
						properties,
						scope: "user",
						userId: user.id,
						entitySchema: entitySchema.entitySchema,
					})
					.pipe(
						Effect.catchTags({
							EntityNotFound: (error) => Effect.die(error),
							EntityBadRequest: (error) =>
								new CollectionBadRequest({
									reason: {
										code: "invalid-collection-properties",
										paths: error.reason.code === "invalid-properties" ? error.reason.paths : [],
									},
								}),
						}),
					);
				return toCollectionResponse(created.entity, created.warnings);
			});

			const prepareGetOrCreateCollection = Effect.fn(
				"CollectionsService.prepareGetOrCreateCollection",
			)(function* (userId: UserId, name: string, command: DomainLifecycleCommand) {
				const entitySchema = yield* collectionEntitySchema;
				const existing = yield* repository.findCollectionByNameForUser({
					name,
					userId,
					entitySchemaSlug: entitySchema.entitySchemaSlug,
				});
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
							EntityBadRequest: (error) => Effect.die(error),
						}),
					);
			});

			const committedMembership = Effect.fnUntraced(function* (
				membership: PendingCollectionMembership["membership"],
				committed: LifecycleCommittedStep<RelationshipSingleResult>,
			) {
				if (!committed.result.relationship) {
					return yield* Effect.die("membership upsert returned no relationship");
				}
				const { wasInserted, ...memberOf } = committed.result.relationship;
				const kernelMemberOf = { ...memberOf, relationshipSchemaPluginId: null };
				return {
					...committed,
					result: {
						...membership,
						memberOf: kernelMemberOf,
						operation: committed.result.operation,
						addEventSchemaSlug: wasInserted ? membership.addEventSchemaSlug : null,
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

			const prepareMembership = Effect.fn("CollectionsService.prepareMembership")(
				function* (input: {
					userId: UserId;
					entityId: EntityId;
					command: DomainLifecycleCommand;
					mode?: CreateMembershipBody["mode"];
					properties?: unknown;
					collectionId: EntityId;
				}) {
					if (input.collectionId === input.entityId) {
						return yield* new CollectionBadRequest({ reason: { code: "circular-membership" } });
					}

					const collection = yield* repository.getCollectionById(input.collectionId, input.userId);
					if (!collection) {
						return yield* new CollectionNotFound({
							reason: { code: "collection-not-found", collectionId: input.collectionId },
						});
					}

					const entity = yield* repository.getEntityForMembership(input.entityId, input.userId);
					if (!entity) {
						return yield* new CollectionNotFound({
							reason: { code: "entity-not-found", entityId: input.entityId },
						});
					}

					const collectionProps = isPlainObject(collection.properties) ? collection.properties : {};
					const rawMembershipSchema = collectionProps["membershipPropertiesSchema"];
					let validatedProperties: Record<string, unknown>;

					if (rawMembershipSchema !== undefined && rawMembershipSchema !== null) {
						const membershipSchema = yield* decodeStoredSchema(
							rawMembershipSchema,
							AppSchema,
							"Invalid membershipPropertiesSchema stored in collection",
						).pipe(Effect.orDie);

						validatedProperties = yield* parseAppSchemaProperties({
							kind: "Membership",
							propertiesSchema: membershipSchema,
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
					} else {
						validatedProperties = isPlainObject(input.properties) ? input.properties : {};
					}

					const addEvent = yield* addEventSchema;
					const memberOfRelationshipSchema = yield* memberOfSchema;
					const membershipInput = {
						scope: "user",
						userId: input.userId,
						sourceEntityId: input.entityId,
						properties: validatedProperties,
						targetEntityId: input.collectionId,
						ifAbsent: input.mode === "add-if-absent",
						relationshipSchema: {
							owner: { kind: "kernel" },
							slug: RelationshipSchemaSlug.make(memberOfRelationshipSchema.slug),
						},
					} as const;
					const membership = {
						entityId: entity.id,
						occurredAt: input.command.occurredAt,
						addEventSchemaSlug: addEvent?.id ?? null,
						entitySchemaSlug: entity.entitySchemaSlug,
					};
					const prepared = yield* relationships
						.prepareCreate(membershipInput, input.command)
						.pipe(
							Effect.catchTags({
								RelationshipBadRequest: invalidMembership,
								RelationshipNotFound: (error) => Effect.die(error),
							}),
						);
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
				},
			);

			const addToCollection = Effect.fn("CollectionsService.addToCollection")(function* (
				user: CurrentUserValue,
				payload: CreateMembershipBody,
				command: DomainLifecycleCommand,
			) {
				const executionId = command.causation.executionId;
				return yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					AddEntityToCollectionWorkflow,
					command.accountGeneration,
					{
						executionId,
						payload: {
							command,
							executionId,
							userId: user.id,
							mode: payload.mode,
							entityId: payload.entityId,
							properties: payload.properties,
							collectionId: payload.collectionId,
						},
					},
					(admission) => admission,
					(execution) => execution,
				);
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

			const removeFromCollection = Effect.fn("CollectionsService.removeFromCollection")(function* (
				user: CurrentUserValue,
				payload: DeleteMembershipBody,
				command: DomainLifecycleCommand,
			) {
				const lifecycle = kernelCollectionLifecycleCommand(command);
				const collection = yield* repository.getCollectionById(payload.collectionId, user.id);
				if (!collection) {
					return yield* new CollectionNotFound({
						reason: { code: "collection-not-found", collectionId: payload.collectionId },
					});
				}

				const entity = yield* repository.getEntityForMembership(payload.entityId, user.id);
				if (!entity) {
					return yield* new CollectionNotFound({
						reason: { code: "entity-not-found", entityId: payload.entityId },
					});
				}

				const membershipSchema = yield* memberOfSchema;
				const result = yield* relationships
					.delete(
						{
							scope: "user",
							userId: user.id,
							sourceEntityId: payload.entityId,
							targetEntityId: payload.collectionId,
							relationshipSchema: {
								owner: { kind: "kernel" },
								slug: RelationshipSchemaSlug.make(membershipSchema.slug),
							},
						},
						lifecycle,
					)
					.pipe(
						Effect.catchTags({
							RelationshipNotFound: Effect.die,
							RelationshipBadRequest: (error) =>
								new CollectionBadRequest({
									reason: {
										code: "invalid-membership-properties",
										paths: error.reason.code === "invalid-properties" ? error.reason.paths : [],
									},
								}),
						}),
					);
				const deleted = result.relationship;

				if (!deleted) {
					return yield* new CollectionNotFound({
						reason: {
							entityId: payload.entityId,
							code: "membership-not-found",
							collectionId: payload.collectionId,
						},
					});
				}
				const { wasInserted: _wasInserted, ...deletedRelationship } = deleted;
				const memberOf = { ...deletedRelationship, relationshipSchemaPluginId: null };

				const removeEvent = yield* removeEventSchema;
				if (removeEvent) {
					const eventWarnings = yield* queueCollectionEvent({
						userId: user.id,
						entityId: payload.collectionId,
						eventSchemaSlug: removeEvent.id,
						command: childCollectionLifecycleCommand(lifecycle, `event:${deleted.id}`),
						properties: {
							entityId: entity.id,
							relationshipId: deleted.id,
							entitySchemaSlug: entity.entitySchemaSlug,
							relationshipProperties: deleted.properties,
						},
					});
					return { memberOf, warnings: [...result.warnings, ...eventWarnings] };
				}

				return { memberOf, warnings: result.warnings };
			});

			return {
				create,
				addToCollection,
				commitMembership,
				prepareMembership,
				commitCompensation,
				prepareCompensation,
				removeFromCollection,
				applyMembershipPolicies,
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
								EntityBadRequest: (error) => Effect.die(error),
							}),
						),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
