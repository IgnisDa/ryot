import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";
import { QueryEngineValidationError } from "./errors";
import type { RuntimeRef } from "./expression";

export type PropertyType = AppPropertyDefinition["type"];

const eventReferencePrefix = "event";
const entityReferencePrefix = "entity";
const computedReferencePrefix = "computed";

export type QueryEngineSchemaLike = {
	slug: string;
	propertiesSchema: AppSchema;
};

export type QueryEngineEventSchemaLike = {
	id: string;
	slug: string;
	entitySchemaId: string;
	entitySchemaSlug: string;
	propertiesSchema: AppSchema;
};

export type QueryEngineEventJoinLike<
	TEventSchema extends QueryEngineEventSchemaLike = QueryEngineEventSchemaLike,
> = {
	key: string;
	kind: "latestEvent";
	eventSchemaSlug: string;
	eventSchemas: TEventSchema[];
	eventSchemaMap: Map<string, TEventSchema>;
};

export type QueryEngineReferenceContext<
	TSchema extends QueryEngineSchemaLike = QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike = QueryEngineEventJoinLike,
> = {
	schemaMap: Map<string, TSchema>;
	eventJoinMap: Map<string, TJoin>;
};

type RuntimeColumnConfig = {
	filter: boolean;
	display: boolean;
	property?: AppPropertyDefinition;
};

const entityRuntimeColumns = {
	image: { display: true, filter: false },
	id: {
		filter: true,
		display: true,
		property: { label: "ID", type: "string" },
	},
	name: {
		filter: true,
		display: true,
		property: { label: "Name", type: "string" },
	},
	externalId: {
		filter: true,
		display: true,
		property: { label: "External ID", type: "string" },
	},
	sandboxScriptId: {
		filter: true,
		display: true,
		property: { label: "Sandbox Script ID", type: "string" },
	},
	createdAt: {
		filter: true,
		display: true,
		property: { label: "Created At", type: "datetime" },
	},
	updatedAt: {
		filter: true,
		display: true,
		property: { label: "Updated At", type: "datetime" },
	},
} satisfies Record<string, RuntimeColumnConfig>;

const eventJoinColumns = {
	id: {
		filter: true,
		display: true,
		property: { label: "ID", type: "string" },
	},
	createdAt: {
		filter: true,
		display: true,
		property: { label: "Created At", type: "datetime" },
	},
	updatedAt: {
		filter: true,
		display: true,
		property: { label: "Updated At", type: "datetime" },
	},
} satisfies Record<string, RuntimeColumnConfig>;

const hasOwnKey = <T extends object>(
	value: T,
	key: PropertyKey,
): key is keyof T => {
	return Object.hasOwn(value, key);
};

const getRuntimeColumnConfig = <T extends Record<string, RuntimeColumnConfig>>(
	columns: T,
	column: string,
) => {
	if (!hasOwnKey(columns, column)) {
		return undefined;
	}

	return columns[column];
};

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
	return getRuntimeColumnConfig(entityRuntimeColumns, column)?.property ?? null;
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
	return getRuntimeColumnConfig(eventJoinColumns, column)?.property ?? null;
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
		throw new QueryEngineValidationError(
			error instanceof Error ? error.message : "Invalid field reference",
		);
	}

	throw new QueryEngineValidationError(
		"Explicit field references are required",
	);
};

export const getSchemaForReference = <TSchema extends QueryEngineSchemaLike>(
	schemaMap: Map<string, TSchema>,
	reference: Extract<RuntimeRef, { slug: string }>,
): TSchema => {
	const foundSchema = schemaMap.get(reference.slug);
	if (!foundSchema) {
		throw new QueryEngineValidationError(
			`Schema '${reference.slug}' is not part of this runtime request`,
		);
	}

	return foundSchema;
};

export const getEventJoinForReference = <
	TJoin extends QueryEngineEventJoinLike,
>(
	eventJoinMap: Map<string, TJoin>,
	reference:
		| Extract<RuntimeRef, { type: "event-join-column" }>
		| Extract<RuntimeRef, { type: "event-join-property" }>,
): TJoin => {
	const foundJoin = eventJoinMap.get(reference.joinKey);
	if (!foundJoin) {
		throw new QueryEngineValidationError(
			`Event join '${formatEventJoinReferencePrefix(reference.joinKey)}' is not part of this runtime request`,
		);
	}

	return foundJoin;
};

export const getEventJoinPropertyDefinition = <
	TJoin extends QueryEngineEventJoinLike,
>(
	join: TJoin,
	propertyName: string,
): AppPropertyDefinition | null => {
	const definitions = join.eventSchemas.map((schema) => {
		const property = schema.propertiesSchema.fields[propertyName];
		if (!property) {
			throw new QueryEngineValidationError(
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
			throw new QueryEngineValidationError(
				`Property '${propertyName}' has incompatible definitions across event schemas for join '${join.key}'`,
			);
		}
	}

	return firstDefinition;
};

export const getEventJoinPropertyType = <
	TJoin extends QueryEngineEventJoinLike,
>(
	join: TJoin,
	propertyName: string,
): PropertyType | null => {
	return getEventJoinPropertyDefinition(join, propertyName)?.type ?? null;
};
