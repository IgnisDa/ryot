import { TrustedLocalMessage } from "@ryot-app/i18n/message";
import { Schema } from "effect";

import { EntityId, EventId, RelationshipKey } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { FoldRequest } from "../events/folds";
import { EventChange } from "../events/mutations";
import { ChangeSetEntityReference, ChangeSetGlobalEntityReference } from "./references";

export const CHANGE_SET_LIMITS = {
	signals: 100,
	baselines: 100,
	notifications: 20,
	entityDeletes: 100,
	entityUpdates: 100,
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

const entityFields = {
	properties,
	itemIdentity,
	entitySchemaSlug: slug,
	name: Schema.NonEmptyString,
};

const entityUpdateTarget = strictStruct({
	entityId: EntityId,
	kind: Schema.Literal("update"),
	expected: strictStruct({ properties, name: Schema.String, updatedAt: Schema.String }),
});

export const ChangeSetEntity = strictStruct({
	...entityFields,
	target: Schema.Union([strictStruct({ kind: Schema.Literal("create") }), entityUpdateTarget]),
});
export type ChangeSetEntity = typeof ChangeSetEntity.Type;

/** An update of an existing user entity, checked against the entity as the writer read it. */
export const ChangeSetEntityUpdate = strictStruct({ ...entityFields, target: entityUpdateTarget });
export type ChangeSetEntityUpdate = typeof ChangeSetEntityUpdate.Type;

const entityOfSchema = strictStruct({ entityId: EntityId, entitySchemaSlug: slug });

const relationshipEndpoints = {
	itemIdentity,
	relationshipSchemaSlug: slug,
	source: ChangeSetEntityReference,
	target: ChangeSetEntityReference,
	key: Schema.optionalKey(RelationshipKey),
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
	events: Schema.optional(
		strictStruct({
			changes: Schema.Array(EventChange),
			expected: Schema.optional(
				strictStruct({ eventSchemaSlug: slug, eventIds: Schema.Array(EventId) }),
			),
			baselines: Schema.optional(
				Schema.Array(strictStruct({ entityId: EntityId, revision: Schema.Int }))
					.check(Schema.isMinLength(1))
					.check(Schema.isMaxLength(CHANGE_SET_LIMITS.baselines))
					.check(distinctEntityIds),
			),
		}),
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
			updates: Schema.optional(
				atMost(ChangeSetEntityUpdate, CHANGE_SET_LIMITS.entityUpdates).check(
					Schema.makeFilter(
						(updates) =>
							new Set(updates.map((update) => update.target.entityId)).size === updates.length,
					),
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
					strictStruct({ entitySchemaSlug: slug, type: Schema.Literal("self") }),
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
});
export type ChangeSet = typeof ChangeSet.Type;

/** The result of a script whose only effect is its changes: after hooks and user bootstrap scripts. */
export const ChangesOutput = strictStruct({ changes: Schema.optional(ChangeSet) });
export type ChangesOutput = typeof ChangesOutput.Type;

/** The result of a script that returns an output and the changes the kernel commits for it. */
export const OutputWithChanges = <Output extends Schema.Top>(output: Output) =>
	Schema.Struct({ output, changes: Schema.optional(ChangeSet) });

export const CommittedChanges = strictStruct({
	entityId: Schema.optional(EntityId),
	events: Schema.Array(strictStruct({ eventId: EventId, itemIdentity: Schema.NonEmptyString })),
});
export type CommittedChanges = typeof CommittedChanges.Type;

/**
 * Failure codes meaning the change set's baseline changed or vanished concurrently, or that the user
 * data it clears or merges no longer allows the change.
 */
export const CommitConflictCode = Schema.Literals([
	"event-stale",
	"entity-stale",
	"state-conflict",
	"event-not-found",
	"entity-not-found",
	"mutation-conflict",
	"child-mapping-conflict",
	"concurrent-relationship-change",
]);
export type CommitConflictCode = typeof CommitConflictCode.Type;
