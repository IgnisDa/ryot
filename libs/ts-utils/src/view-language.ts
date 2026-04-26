export const entityBuiltinColumns: ReadonlySet<string> = new Set([
	"id",
	"name",
	"image",
	"createdAt",
	"updatedAt",
	"externalId",
	"sandboxScriptId",
]);

export const eventJoinBuiltinColumns: ReadonlySet<string> = new Set([
	"id",
	"createdAt",
	"updatedAt",
]);

export type RuntimeRef =
	| { key: string; type: "computed-field" }
	| { slug: string; column: string; type: "entity-column" }
	| { slug: string; property: string[]; type: "schema-property" }
	| { column: string; joinKey: string; type: "event-join-column" }
	| { joinKey: string; property: string[]; type: "event-join-property" };
