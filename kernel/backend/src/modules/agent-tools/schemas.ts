import {
	EntitySchemaDefinition,
	EventSchemaDefinition,
	RelationshipSchemaDefinition,
} from "@ryot-app/definitions/snapshot";
import { Schema } from "effect";

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
