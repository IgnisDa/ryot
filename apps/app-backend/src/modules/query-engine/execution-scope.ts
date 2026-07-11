export type PluginQuerySchemaOwnership = {
	readonly entitySchemaSlugs: readonly string[];
	readonly relationshipSchemaSlugs: readonly string[];
	readonly eventSchemas: readonly {
		readonly eventSchemaSlug: string;
		readonly entitySchemaSlug: string;
	}[];
};

export type QueryExecutionScope =
	| { readonly type: "user"; readonly userId: string }
	| ({ readonly type: "system"; readonly pluginSlug: string } & PluginQuerySchemaOwnership);

export type EntityTraversalVisibility =
	| { readonly type: "root" }
	| {
			readonly type: "relationshipEndpoint";
			readonly endpoint: "source" | "target";
			readonly relationshipSchemaSlugs: readonly string[];
	  };
