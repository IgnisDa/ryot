import { TrustedLocalMessage } from "@ryot-app/i18n/message";
import { Schema } from "effect";

import { EntityId, EventId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { FoldRequest } from "../events/folds";
import { EventMutationChange } from "../events/mutations";
import { EventOrderAnchor } from "../events/schemas";

export const CHANGE_SET_LIMITS = {
	signals: 100,
	baselines: 100,
	notifications: 20,
	entityDeletes: 100,
	entityEnsures: 500,
	globalEntities: 500,
	entityDataChanges: 20,
	relationshipChanges: 500,
	globalRelationshipGroups: 50,
	globalRelationshipsTotal: 1_000,
	globalRelationshipsPerGroup: 500,
} as const;

const properties = Schema.Record(Schema.String, JsonValue);
const slug = Schema.NonEmptyString;
const itemIdentity = Schema.optional(Schema.NonEmptyString);
const atMost = <S extends Schema.Top>(item: S, limit: number) =>
	Schema.Array(item).check(Schema.isMaxLength(limit));

/** A user entity: the change set's root entity, or one that already exists. */
export const ChangeSetEntityReference = Schema.Union([
	strictStruct({ kind: Schema.Literal("root") }),
	strictStruct({ entityId: EntityId, kind: Schema.Literal("existing") }),
]);
export type ChangeSetEntityReference = typeof ChangeSetEntityReference.Type;

/** A global entity: one that already exists, or one this change set upserts. */
export const ChangeSetGlobalEntityReference = Schema.Union([
	strictStruct({ entityId: EntityId, kind: Schema.Literal("existing") }),
	strictStruct({
		entitySchemaSlug: slug,
		kind: Schema.Literal("upserted"),
		externalId: Schema.NonEmptyString,
	}),
]);
export type ChangeSetGlobalEntityReference = typeof ChangeSetGlobalEntityReference.Type;

export const ChangeSetEntity = strictStruct({
	properties,
	itemIdentity,
	entitySchemaSlug: slug,
	name: Schema.NonEmptyString,
	target: Schema.Union([
		strictStruct({ kind: Schema.Literal("create") }),
		strictStruct({
			entityId: EntityId,
			kind: Schema.Literal("update"),
			expected: strictStruct({ properties, name: Schema.String, updatedAt: Schema.String }),
		}),
	]),
});
export type ChangeSetEntity = typeof ChangeSetEntity.Type;

const entityOfSchema = strictStruct({ entityId: EntityId, entitySchemaSlug: slug });

const relationshipEndpoints = {
	itemIdentity,
	relationshipSchemaSlug: slug,
	source: ChangeSetEntityReference,
	target: ChangeSetEntityReference,
};

const distinctEntityIds = Schema.makeFilter(
	(baselines: ReadonlyArray<{ readonly entityId: EntityId }>) =>
		new Set(baselines.map((baseline) => baseline.entityId)).size === baselines.length,
);

/** Everything one plugin run writes. The kernel commits it atomically after the run ends. */
export const ChangeSet = strictStruct({
	settings: Schema.optional(properties),
	entity: Schema.optional(ChangeSetEntity),
	notifications: Schema.optional(atMost(TrustedLocalMessage, CHANGE_SET_LIMITS.notifications)),
	folds: Schema.optional(
		strictStruct({ ...FoldRequest.fields, scope: Schema.Literals(["user", "all-users"]) }),
	),
	signals: Schema.optional(
		atMost(
			strictStruct({
				properties,
				schemaSlug: slug,
				discriminator: Schema.NonEmptyString,
				subjectEntityId: Schema.optional(EntityId),
			}),
			CHANGE_SET_LIMITS.signals,
		),
	),
	globalEntities: Schema.optional(
		atMost(
			strictStruct({
				properties,
				entitySchemaSlug: slug,
				name: Schema.NonEmptyString,
				externalId: Schema.NonEmptyString,
				populatedAt: Schema.NullOr(
					Schema.String.check(
						Schema.makeFilter((value) => !Number.isNaN(new Date(value).getTime())),
					),
				),
			}),
			CHANGE_SET_LIMITS.globalEntities,
		),
	),
	relationships: Schema.optional(
		strictStruct({
			deletes: Schema.optional(Schema.Array(strictStruct(relationshipEndpoints))),
			upserts: Schema.optional(
				Schema.Array(
					strictStruct({
						...relationshipEndpoints,
						properties,
						propertiesMode: Schema.Literals(["merge", "replace"]),
					}),
				),
			),
		}).check(
			Schema.makeFilter(
				(changes) =>
					(changes.upserts?.length ?? 0) + (changes.deletes?.length ?? 0) <=
					CHANGE_SET_LIMITS.relationshipChanges,
			),
		),
	),
	entities: Schema.optional(
		strictStruct({
			deletes: Schema.optional(atMost(entityOfSchema, CHANGE_SET_LIMITS.entityDeletes)),
			clears: Schema.optional(atMost(entityOfSchema, CHANGE_SET_LIMITS.entityDataChanges)),
			ensures: Schema.optional(
				atMost(
					strictStruct({ properties, entitySchemaSlug: slug, name: Schema.NonEmptyString }),
					CHANGE_SET_LIMITS.entityEnsures,
				),
			),
			merges: Schema.optional(
				atMost(
					strictStruct({ mergeFrom: EntityId, mergeInto: EntityId, entitySchemaSlug: slug }),
					CHANGE_SET_LIMITS.entityDataChanges,
				),
			),
		}),
	),
	globalRelationships: Schema.optional(
		atMost(
			strictStruct({
				relationshipSchemaSlug: slug,
				relationships: atMost(
					strictStruct({
						properties,
						source: ChangeSetGlobalEntityReference,
						target: ChangeSetGlobalEntityReference,
					}),
					CHANGE_SET_LIMITS.globalRelationshipsPerGroup,
				),
				selector: Schema.Union([
					strictStruct({ type: Schema.Literal("self") }),
					strictStruct({
						type: Schema.Literal("anchored"),
						anchor: ChangeSetGlobalEntityReference,
						direction: Schema.Literals(["incoming", "outgoing"]),
					}),
				]),
			}),
			CHANGE_SET_LIMITS.globalRelationshipGroups,
		).check(
			Schema.makeFilter(
				(groups) =>
					groups.reduce((total, group) => total + group.relationships.length, 0) <=
					CHANGE_SET_LIMITS.globalRelationshipsTotal,
			),
		),
	),
	events: Schema.optional(
		strictStruct({
			expected: Schema.optional(
				strictStruct({ eventSchemaSlug: slug, eventIds: Schema.Array(EventId) }),
			),
			changes: Schema.Array(
				Schema.Union([EventMutationChange.members[1], EventMutationChange.members[2]]),
			),
			baselines: Schema.optional(
				Schema.Array(strictStruct({ entityId: EntityId, revision: Schema.Int }))
					.check(Schema.isMinLength(1))
					.check(Schema.isMaxLength(CHANGE_SET_LIMITS.baselines))
					.check(distinctEntityIds),
			),
			creates: Schema.Array(
				strictStruct({
					properties,
					eventSchemaSlug: slug,
					entity: ChangeSetEntityReference,
					itemIdentity: Schema.NonEmptyString,
					occurredAt: Schema.optional(Schema.String),
					orderAfter: Schema.optional(EventOrderAnchor),
					session: Schema.optional(ChangeSetEntityReference),
				}),
			),
		}),
	),
});
export type ChangeSet = typeof ChangeSet.Type;

export const CommittedChanges = strictStruct({
	entityId: Schema.optional(EntityId),
	events: Schema.Array(strictStruct({ eventId: EventId, itemIdentity: Schema.NonEmptyString })),
});
export type CommittedChanges = typeof CommittedChanges.Type;

/** Failure codes meaning the change set's baseline changed or vanished concurrently. */
export const CommitConflictCode = Schema.Literals([
	"event-stale",
	"entity-stale",
	"event-not-found",
	"entity-not-found",
	"mutation-conflict",
	"concurrent-relationship-change",
]);
export type CommitConflictCode = typeof CommitConflictCode.Type;
