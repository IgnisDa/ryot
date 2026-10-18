import { Schema } from "effect";

import { EntityId, RelationshipId, RelationshipSchemaSlug } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";

export const RELATIONSHIP_PROJECTION_LIMITS = { sourceEntities: 100, relationshipsPerStep: 100 };

export const RelationshipProjectionRequest = strictStruct({
	relationshipSchemaSlug: RelationshipSchemaSlug,
	sourceEntityIds: Schema.Array(EntityId).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(RELATIONSHIP_PROJECTION_LIMITS.sourceEntities),
	),
});

export const RelationshipProjectionStepInput = strictStruct({
	relationshipSchemaSlug: RelationshipSchemaSlug,
	relationships: Schema.Array(
		strictStruct({
			sourceEntityId: EntityId,
			targetEntityId: EntityId,
			relationshipId: RelationshipId,
		}),
	).check(Schema.isMaxLength(RELATIONSHIP_PROJECTION_LIMITS.relationshipsPerStep)),
});

export const RelationshipProjectionStepOutput = strictStruct({
	updates: Schema.Array(
		strictStruct({
			relationshipId: RelationshipId,
			properties: Schema.Record(Schema.String, JsonValue),
		}),
	).check(Schema.isMaxLength(RELATIONSHIP_PROJECTION_LIMITS.relationshipsPerStep)),
});
