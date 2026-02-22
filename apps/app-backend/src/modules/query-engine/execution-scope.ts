import type {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginSlug,
	RelationshipSchemaSlug,
} from "@ryot/contract/schema/brands";

export type PluginQuerySchemaOwnership = {
	readonly entitySchemaSlugs: readonly EntitySchemaSlug[];
	readonly relationshipSchemaSlugs: readonly RelationshipSchemaSlug[];
	readonly eventSchemas: readonly {
		readonly eventSchemaSlug: EventSchemaSlug;
		readonly entitySchemaSlug: EntitySchemaSlug;
	}[];
};

export type QueryExecutionScope =
	| { readonly type: "user"; readonly userId: string }
	| ({ readonly type: "system"; readonly pluginSlug: PluginSlug } & PluginQuerySchemaOwnership);

export type EntityTraversalVisibility =
	| { readonly type: "root" }
	| {
			readonly type: "relationshipEndpoint";
			readonly endpoint: "source" | "target";
			readonly relationshipSchemaSlugs: readonly string[];
	  };
