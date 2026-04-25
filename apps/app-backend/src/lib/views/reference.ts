import type {
	AppPropertyDefinition,
	AppSchema,
	RuntimeRef,
} from "@ryot/ts-utils";
import { QueryEngineValidationError } from "./errors";

export type PropertyType = AppPropertyDefinition["type"];

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
	// Required for SQL compilation (event-aggregate subqueries). Optional during
	// validation-only paths where no SQL is generated.
	userId?: string;
	schemaMap: Map<string, TSchema>;
	eventJoinMap: Map<string, TJoin>;
	// Set of event schema slugs visible to the current user for the entity
	// schemas in the query. Used to validate event-aggregate references. When
	// absent, event-aggregate slug validation is skipped.
	eventSchemaSlugs?: ReadonlySet<string>;
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
	return getEventJoinColumnPropertyDefinition(column)?.type ?? null;
};

const formatEventJoinReferencePrefix = (joinKey: string) => `event.${joinKey}`;

const stringifyPropertyDefinition = (property: AppPropertyDefinition) => {
	return JSON.stringify(property);
};

export const getPropertyDefinition = (
	schema: { slug: string; propertiesSchema: AppSchema },
	propertyPath: string[],
): AppPropertyDefinition | null => {
	const [first, ...rest] = propertyPath;
	if (!first) {
		return null;
	}

	const definition = schema.propertiesSchema.fields[first];
	if (!definition) {
		return null;
	}

	if (rest.length === 0) {
		return definition;
	}

	let current: AppPropertyDefinition = definition;
	for (const segment of rest) {
		if (current.type !== "object") {
			return null;
		}

		const next = current.properties[segment];
		if (!next) {
			return null;
		}

		current = next;
	}

	return current;
};

export const getPropertyType = (
	schema: { slug: string; propertiesSchema: AppSchema },
	propertyPath: string[],
): PropertyType | null => {
	return getPropertyDefinition(schema, propertyPath)?.type ?? null;
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

export const getSchemaForReference = <TSchema extends QueryEngineSchemaLike>(
	schemaMap: Map<string, TSchema>,
	reference: Extract<RuntimeRef, { type: "entity" }>,
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
	reference: Extract<RuntimeRef, { type: "event" }>,
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
	propertyPath: string[],
): AppPropertyDefinition => {
	const [first, ...rest] = propertyPath;
	if (!first) {
		throw new QueryEngineValidationError(
			`Property path must not be empty for join '${join.key}'`,
		);
	}

	const definitions = join.eventSchemas.map((schema) => {
		const rootProperty = schema.propertiesSchema.fields[first];
		if (!rootProperty) {
			throw new QueryEngineValidationError(
				`Property '${propertyPath.join(".")}' not found in event schema '${schema.slug}' for join '${join.key}'`,
			);
		}

		let current: AppPropertyDefinition = rootProperty;
		for (const segment of rest) {
			if (current.type !== "object") {
				throw new QueryEngineValidationError(
					`Property '${propertyPath.join(".")}' not found in event schema '${schema.slug}' for join '${join.key}'`,
				);
			}

			const next = current.properties[segment];
			if (!next) {
				throw new QueryEngineValidationError(
					`Property '${propertyPath.join(".")}' not found in event schema '${schema.slug}' for join '${join.key}'`,
				);
			}

			current = next;
		}

		return current;
	});

	const [firstDefinition, ...restDefinitions] = definitions;
	if (!firstDefinition) {
		throw new QueryEngineValidationError(
			`Join '${join.key}' has no event schemas`,
		);
	}

	const firstSerialized = stringifyPropertyDefinition(firstDefinition);
	for (const definition of restDefinitions) {
		if (stringifyPropertyDefinition(definition) !== firstSerialized) {
			throw new QueryEngineValidationError(
				`Property '${propertyPath.join(".")}' has incompatible definitions across event schemas for join '${join.key}'`,
			);
		}
	}

	return firstDefinition;
};

export const getEventJoinPropertyType = <
	TJoin extends QueryEngineEventJoinLike,
>(
	join: TJoin,
	propertyPath: string[],
): PropertyType => {
	return getEventJoinPropertyDefinition(join, propertyPath).type;
};
