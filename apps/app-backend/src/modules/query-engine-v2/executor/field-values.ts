import { Match } from "effect";

import type { Expr, FieldSelector, FieldValue } from "../language";
import type { BaseEntityQueryRow, EntityQueryRow, EventFields, RelationshipFields } from "./types";

export const valueToFieldValue = (value: unknown): FieldValue => {
	if (value === null || value === undefined) {
		return { kind: "null", value: null };
	}
	if (typeof value === "string") {
		return { kind: "text", value };
	}
	if (typeof value === "number") {
		return { kind: "number", value };
	}
	if (typeof value === "boolean") {
		return { kind: "boolean", value };
	}
	return { kind: "json", value };
};

export const evalSystemRef = (name: string, row: BaseEntityQueryRow): FieldValue =>
	Match.value(name).pipe(
		Match.when("id", () => ({ kind: "text" as const, value: row.id })),
		Match.when("name", () => ({ kind: "text" as const, value: row.name })),
		Match.when("image", () =>
			row.image !== null && row.image !== undefined
				? { kind: "image" as const, value: row.image }
				: { kind: "null" as const, value: null },
		),
		Match.when("createdAt", () => ({ kind: "date" as const, value: row.createdAt })),
		Match.when("updatedAt", () => ({ kind: "date" as const, value: row.updatedAt })),
		Match.when("externalId", () =>
			row.externalId !== null
				? { kind: "text" as const, value: row.externalId }
				: { kind: "null" as const, value: null },
		),
		Match.when("sandboxScriptId", () =>
			row.sandboxScriptId !== null
				? { kind: "text" as const, value: row.sandboxScriptId }
				: { kind: "null" as const, value: null },
		),
		Match.orElse(() => ({ kind: "null" as const, value: null })),
	);

export const getNestedValue = (
	obj: Record<string, unknown>,
	path: readonly [string, ...string[]],
): unknown => {
	let current: unknown = obj;
	for (const key of path) {
		if (typeof current !== "object" || current === null) {
			return null;
		}
		current = Reflect.get(current, key);
	}
	return current ?? null;
};

export const evalFieldSelector = (field: FieldSelector, row: BaseEntityQueryRow): FieldValue => {
	if (field.type === "system") {
		return evalSystemRef(field.name, row);
	}

	if (field.type === "property") {
		if (row.schemaSlug !== field.schema) {
			return { kind: "null", value: null };
		}
		return valueToFieldValue(getNestedValue(row.properties, field.path));
	}

	if (field.name === "slug") {
		return { kind: "text", value: row.schemaSlug };
	}
	return { kind: "text", value: row.schemaName };
};

const evalRelationshipSystemRef = (name: string, row: RelationshipFields): FieldValue =>
	Match.value(name).pipe(
		Match.when("id", () => ({ kind: "text" as const, value: row.relationshipId ?? "" })),
		Match.when("createdAt", () => ({ kind: "date" as const, value: row.relationshipCreatedAt })),
		Match.when("sourceEntityId", () => ({
			kind: "text" as const,
			value: row.relationshipSourceEntityId ?? "",
		})),
		Match.when("targetEntityId", () => ({
			kind: "text" as const,
			value: row.relationshipTargetEntityId ?? "",
		})),
		Match.orElse(() => ({ kind: "null" as const, value: null })),
	);

export const evalRelationshipFieldSelector = (
	field: FieldSelector,
	row: RelationshipFields,
): FieldValue => {
	if (field.type === "system") {
		return evalRelationshipSystemRef(field.name, row);
	}
	if (field.type === "property") {
		if (row.relationshipSchemaSlug !== field.schema) {
			return { kind: "null", value: null };
		}
		return valueToFieldValue(getNestedValue(row.relationshipProperties ?? {}, field.path));
	}
	return {
		kind: "text",
		value: field.name === "slug" ? row.relationshipSchemaSlug : row.relationshipSchemaName,
	};
};

const evalEventSystemRef = (name: string, row: EventFields): FieldValue =>
	Match.value(name).pipe(
		Match.when("id", () => ({ kind: "text" as const, value: row.eventId })),
		Match.when("createdAt", () => ({ kind: "date" as const, value: row.eventCreatedAt })),
		Match.when("updatedAt", () => ({ kind: "date" as const, value: row.eventUpdatedAt })),
		Match.when("occurredAt", () => ({ kind: "date" as const, value: row.eventOccurredAt })),
		Match.orElse(() => ({ kind: "null" as const, value: null })),
	);

export const evalEventFieldSelector = (field: FieldSelector, row: EventFields): FieldValue => {
	if (field.type === "system") {
		return evalEventSystemRef(field.name, row);
	}
	if (field.type === "property") {
		if (row.eventSchemaSlug !== field.schema) {
			return { kind: "null", value: null };
		}
		return valueToFieldValue(getNestedValue(row.eventProperties, field.path));
	}
	return { kind: "text", value: field.name === "slug" ? row.eventSchemaSlug : row.eventSchemaName };
};

export const evalExprForField = (expr: Expr, row: EntityQueryRow): FieldValue => {
	if (expr.type === "ref") {
		return evalFieldSelector(expr.field, row);
	}
	if (expr.type === "literal") {
		return valueToFieldValue(expr.value);
	}
	return { kind: "null", value: null };
};

export const fieldValueScalar = (value: FieldValue) => value.value;
