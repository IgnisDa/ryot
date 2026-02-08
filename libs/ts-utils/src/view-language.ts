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
	| { slug: string; path: string[]; type: "entity" }
	| { joinKey: string; path: string[]; type: "event" };

export type RuntimeReferenceExpression = {
	type: "reference";
	reference: RuntimeRef;
};

export const createEntityColumnExpression = (
	slug: string,
	column: string,
): RuntimeReferenceExpression => ({
	type: "reference",
	reference: { type: "entity", slug, path: [column] },
});

export const createEntityPropertyExpression = (
	slug: string,
	property: string,
): RuntimeReferenceExpression => ({
	type: "reference",
	reference: { type: "entity", slug, path: ["properties", property] },
});
