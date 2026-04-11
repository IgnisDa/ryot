import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";
import { ViewRuntimeValidationError } from "./errors";
import type { RuntimeRef } from "./expression";

export type PropertyType = AppPropertyDefinition["type"];

const eventReferencePrefix = "event";
const entityReferencePrefix = "entity";
const computedReferencePrefix = "computed";

export type ViewRuntimeSchemaLike = {
	slug: string;
	propertiesSchema: AppSchema;
};

export type ViewRuntimeEventSchemaLike = {
	id: string;
	slug: string;
	entitySchemaId: string;
	entitySchemaSlug: string;
	propertiesSchema: AppSchema;
};

export type ViewRuntimeEventJoinLike<
	TEventSchema extends ViewRuntimeEventSchemaLike = ViewRuntimeEventSchemaLike,
> = {
	key: string;
	kind: "latestEvent";
	eventSchemaSlug: string;
	eventSchemas: TEventSchema[];
	eventSchemaMap: Map<string, TEventSchema>;
};

export type ViewRuntimeReferenceContext<
	TSchema extends ViewRuntimeSchemaLike = ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike = ViewRuntimeEventJoinLike,
> = {
	schemaMap: Map<string, TSchema>;
	eventJoinMap: Map<string, TJoin>;
};

const entityRuntimeColumns = {
	image: { display: true, filter: false },
	id: { display: true, filter: true, property: { type: "string" as const } },
	name: { display: true, filter: true, property: { type: "string" as const } },
	createdAt: {
		filter: true,
		display: true,
		property: { type: "datetime" as const },
	},
	updatedAt: {
		filter: true,
		display: true,
		property: { type: "datetime" as const },
	},
};

const eventJoinColumns = {
	id: { display: true, filter: true, property: { type: "string" as const } },
	createdAt: {
		filter: true,
		display: true,
		property: { type: "datetime" as const },
	},
	updatedAt: {
		filter: true,
		display: true,
		property: { type: "datetime" as const },
	},
};

type EntityRuntimeColumn = keyof typeof entityRuntimeColumns;
type EventJoinColumn = keyof typeof eventJoinColumns;

export const sortFilterBuiltins: ReadonlySet<string> = new Set(
	Object.entries(entityRuntimeColumns)
		.filter(([, value]) => value.filter)
		.map(([key]) => key),
);

export const displayBuiltins: ReadonlySet<string> = new Set(
	Object.entries(entityRuntimeColumns)
		.filter(([, value]) => value.display)
		.map(([key]) => key),
);

export const getEntityColumnPropertyDefinition = (
	column: string,
): AppPropertyDefinition | null => {
	const config = entityRuntimeColumns[column as EntityRuntimeColumn];
	return config && "property" in config ? config.property : null;
};

export const getEntityColumnPropertyType = (
	column: string,
): PropertyType | null => {
	if (column === "createdAt" || column === "updatedAt") {
		return "date";
	}

	return getEntityColumnPropertyDefinition(column)?.type ?? null;
};

export const getEventJoinColumnPropertyDefinition = (
	column: string,
): AppPropertyDefinition | null => {
	const config = eventJoinColumns[column as EventJoinColumn];
	return config && "property" in config ? config.property : null;
};

export const getEventJoinColumnPropertyType = (
	column: string,
): PropertyType | null => {
	if (column === "createdAt" || column === "updatedAt") {
		return "date";
	}

	return getEventJoinColumnPropertyDefinition(column)?.type ?? null;
};

const formatEventJoinReferencePrefix = (joinKey: string) => `event.${joinKey}`;

const stringifyPropertyDefinition = (property: AppPropertyDefinition) => {
	return JSON.stringify(property);
};

export const parseFieldPath = (field: string): RuntimeRef => {
	const [namespace, segment, tail, ...rest] = field.split(".");
	if (namespace === computedReferencePrefix) {
		if (!segment || tail || rest.length > 0) {
			throw new Error(`Invalid field path: ${field}`);
		}

		return { key: segment, type: "computed-field" };
	}

	if (namespace === eventReferencePrefix) {
		if (!segment || !tail || rest.length > 0) {
			throw new Error(`Invalid field path: ${field}`);
		}

		if (tail.startsWith("@")) {
			return {
				joinKey: segment,
				type: "event-join-column",
				column: tail.slice(1),
			};
		}

		return {
			property: tail,
			joinKey: segment,
			type: "event-join-property",
		};
	}

	if (
		namespace !== entityReferencePrefix ||
		!segment ||
		!tail ||
		rest.length > 0
	) {
		throw new Error(`Invalid field path: ${field}`);
	}

	if (tail.startsWith("@")) {
		return { slug: segment, column: tail.slice(1), type: "entity-column" };
	}

	return { slug: segment, property: tail, type: "schema-property" };
};

export const getPropertyType = (
	schema: { slug: string; propertiesSchema: AppSchema },
	propertyName: string,
): PropertyType | null => {
	return schema.propertiesSchema.fields[propertyName]?.type ?? null;
};

export const buildSchemaMap = <TSchema extends { slug: string }>(
	schemas: TSchema[],
): Map<string, TSchema> => {
	return new Map(schemas.map((schema) => [schema.slug, schema]));
};

export const buildEventJoinMap = <TJoin extends { key: string }>(
	joins: TJoin[],
): Map<string, TJoin> => {
	return new Map(joins.map((join) => [join.key, join]));
};

export const resolveRuntimeReference = (reference: string): RuntimeRef => {
	try {
		if (
			reference.startsWith(`${computedReferencePrefix}.`) ||
			reference.startsWith(`${entityReferencePrefix}.`) ||
			reference.startsWith(`${eventReferencePrefix}.`)
		) {
			return parseFieldPath(reference);
		}
	} catch (error) {
		throw new ViewRuntimeValidationError(
			error instanceof Error ? error.message : "Invalid field reference",
		);
	}

	throw new ViewRuntimeValidationError(
		"Explicit field references are required",
	);
};

export const getSchemaForReference = <TSchema extends ViewRuntimeSchemaLike>(
	schemaMap: Map<string, TSchema>,
	reference: Extract<RuntimeRef, { slug: string }>,
): TSchema => {
	const foundSchema = schemaMap.get(reference.slug);
	if (!foundSchema) {
		throw new ViewRuntimeValidationError(
			`Schema '${reference.slug}' is not part of this runtime request`,
		);
	}

	return foundSchema;
};

export const getEventJoinForReference = <
	TJoin extends ViewRuntimeEventJoinLike,
>(
	eventJoinMap: Map<string, TJoin>,
	reference:
		| Extract<RuntimeRef, { type: "event-join-column" }>
		| Extract<RuntimeRef, { type: "event-join-property" }>,
): TJoin => {
	const foundJoin = eventJoinMap.get(reference.joinKey);
	if (!foundJoin) {
		throw new ViewRuntimeValidationError(
			`Event join '${formatEventJoinReferencePrefix(reference.joinKey)}' is not part of this runtime request`,
		);
	}

	return foundJoin;
};

export const getEventJoinPropertyDefinition = <
	TJoin extends ViewRuntimeEventJoinLike,
>(
	join: TJoin,
	propertyName: string,
): AppPropertyDefinition | null => {
	const definitions = join.eventSchemas.map((schema) => {
		const property = schema.propertiesSchema.fields[propertyName];
		if (!property) {
			throw new ViewRuntimeValidationError(
				`Property '${propertyName}' not found in event schema '${schema.slug}' for join '${join.key}'`,
			);
		}

		return property;
	});

	const [firstDefinition, ...rest] = definitions;
	if (!firstDefinition) {
		return null;
	}

	const firstSerialized = stringifyPropertyDefinition(firstDefinition);
	for (const definition of rest) {
		if (stringifyPropertyDefinition(definition) !== firstSerialized) {
			throw new ViewRuntimeValidationError(
				`Property '${propertyName}' has incompatible definitions across event schemas for join '${join.key}'`,
			);
		}
	}

	return firstDefinition;
};

export const getEventJoinPropertyType = <
	TJoin extends ViewRuntimeEventJoinLike,
>(
	join: TJoin,
	propertyName: string,
): PropertyType | null => {
	return getEventJoinPropertyDefinition(join, propertyName)?.type ?? null;
};
