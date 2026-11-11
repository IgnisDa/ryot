import { Schema } from "effect";

import {
	EntitySchemaDefinition,
	EventSchemaDefinition,
	RelationshipSchemaDefinition,
} from "#modules/definitions/snapshot";

export const AgentDataDescription = Schema.Struct({
	relationshipSchemas: Schema.Array(RelationshipSchemaDefinition),
	entitySchemas: Schema.Array(
		Schema.Struct({
			name: EntitySchemaDefinition.fields.name,
			slug: EntitySchemaDefinition.fields.slug,
			browse: EntitySchemaDefinition.fields.browse,
			pluginId: EntitySchemaDefinition.fields.pluginId,
			eventSchemas: Schema.Array(EventSchemaDefinition),
			propertiesSchema: EntitySchemaDefinition.fields.propertiesSchema,
		}),
	),
});

export type AgentDataDescription = typeof AgentDataDescription.Type;
