import { isObjectRecord, isUnknownArray } from "@ryot-app/ts-utils/predicates";

import type { FieldSelection } from "../ryotql/authored";

const entityColumns = new Set([
	"id",
	"name",
	"createdAt",
	"updatedAt",
	"externalId",
	"properties",
	"providerId",
	"populatedAt",
	"entitySchemaSlug",
	"populationStatus",
	"translationStatus",
	"entitySchemaPluginId",
	"relatedPopulationStatus",
]);
export const isEntityExpression = (node: unknown, alias: string): boolean => {
	if (isUnknownArray(node)) {
		return node.every((child) => isEntityExpression(child, alias));
	}
	if (!isObjectRecord(node) || node["type"] === "literal") {
		return true;
	}
	if (node["type"] === "column") {
		return (
			node["tableAlias"] === alias &&
			typeof node["field"] === "string" &&
			entityColumns.has(node["field"])
		);
	}
	if (
		"query" in node ||
		"parameter" in node ||
		node["type"] === "parameter" ||
		node["type"] === "sourceEntity" ||
		("table" in node && "alias" in node)
	) {
		return false;
	}
	return Object.values(node).every((child) => isEntityExpression(child, alias));
};
export const presentationDeclarationIssue = (declaration: {
	readonly owner: readonly FieldSelection[];
	readonly entity: readonly FieldSelection[];
}): null | string => {
	for (const [scope, fields] of Object.entries({
		owner: declaration.owner,
		entity: declaration.entity,
	})) {
		const keys = new Set<string>();
		for (const field of fields) {
			if (keys.has(field.key) || field.key.startsWith("__")) {
				return `Invalid presentation field '${field.key}'`;
			}
			keys.add(field.key);
			if (scope === "entity" && !isEntityExpression(field.expr, "entity")) {
				return `Entity presentation field '${field.key}' must read only the subject entity`;
			}
		}
	}
	return null;
};
