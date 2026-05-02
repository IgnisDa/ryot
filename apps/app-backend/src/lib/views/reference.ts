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

// Partial override map for entity SQL column names. Used in events mode where
// entity data is stored under prefixed column names to avoid conflicts with the
// event row's own columns (e.g., `entity_properties` instead of `properties`).
export type EntityColumnOverrides = {
	id?: string;
	properties?: string;
	created_at?: string;
	updated_at?: string;
};

export type QueryEngineReferenceContext<
	TSchema extends QueryEngineSchemaLike = QueryEngineSchemaLike,
	TJoin extends QueryEngineEventJoinLike = QueryEngineEventJoinLike,
> = {
	userId?: string;
	supportsPrimaryEventRefs?: boolean;
	schemaMap: Map<string, TSchema>;
	eventJoinMap: Map<string, TJoin>;
	eventSchemaSlugs?: ReadonlySet<string>;
	entityColumnOverrides?: EntityColumnOverrides;
	eventSchemaMap?: Map<string, QueryEngineEventSchemaLike[]>;
};

type RuntimeColumnConfig = {
	filter: boolean;
	display: boolean;
	property?: AppPropertyDefinition;
};

type RuntimePropertyType = "boolean" | "datetime" | "string";

function createRuntimeProperty(
	label: string,
	type: "boolean",
	description: string,
): Extract<AppPropertyDefinition, { type: "boolean" }>;
function createRuntimeProperty(
	label: string,
	type: "datetime",
	description: string,
): Extract<AppPropertyDefinition, { type: "datetime" }>;
function createRuntimeProperty(
	label: string,
	type: "string",
	description: string,
): Extract<AppPropertyDefinition, { type: "string" }>;
function createRuntimeProperty(
	label: string,
	type: RuntimePropertyType,
	description: string,
): AppPropertyDefinition {
	return { label, type, description };
}

const entityRuntimeColumns = {
	image: { display: true, filter: false },
	id: {
		filter: true,
		display: true,
		property: createRuntimeProperty("ID", "string", "Entity id"),
	},
	name: {
		filter: true,
		display: true,
		property: createRuntimeProperty("Name", "string", "Entity name"),
	},
	externalId: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"External ID",
			"string",
			"External identifier",
		),
	},
	sandboxScriptId: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Sandbox Script ID",
			"string",
			"Sandbox script identifier",
		),
	},
	createdAt: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Created At",
			"datetime",
			"Creation timestamp",
		),
	},
	updatedAt: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Updated At",
			"datetime",
			"Last update timestamp",
		),
	},
} satisfies Record<string, RuntimeColumnConfig>;

const eventJoinColumns = {
	id: {
		filter: true,
		display: true,
		property: createRuntimeProperty("ID", "string", "Event id"),
	},
	createdAt: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Created At",
			"datetime",
			"Event creation timestamp",
		),
	},
	updatedAt: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Updated At",
			"datetime",
			"Event update timestamp",
		),
	},
} satisfies Record<string, RuntimeColumnConfig>;

const eventRuntimeColumns = {
	id: {
		filter: true,
		display: true,
		property: createRuntimeProperty("ID", "string", "Event id"),
	},
	createdAt: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Created At",
			"datetime",
			"Event creation timestamp",
		),
	},
	updatedAt: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Updated At",
			"datetime",
			"Event update timestamp",
		),
	},
} satisfies Record<string, RuntimeColumnConfig>;

const eventSchemaRuntimeColumns = {
	id: {
		filter: true,
		display: true,
		property: createRuntimeProperty("ID", "string", "Event schema id"),
	},
	name: {
		filter: true,
		display: true,
		property: createRuntimeProperty("Name", "string", "Event schema name"),
	},
	slug: {
		filter: true,
		display: true,
		property: createRuntimeProperty("Slug", "string", "Event schema slug"),
	},
	isBuiltin: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Is Builtin",
			"boolean",
			"Whether the event schema is built in",
		),
	},
	createdAt: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Created At",
			"datetime",
			"Event schema creation timestamp",
		),
	},
	updatedAt: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Updated At",
			"datetime",
			"Event schema update timestamp",
		),
	},
} satisfies Record<string, RuntimeColumnConfig>;

const entitySchemaRuntimeColumns = {
	id: {
		filter: true,
		display: true,
		property: createRuntimeProperty("ID", "string", "Schema id"),
	},
	icon: {
		display: true,
		filter: false,
		property: createRuntimeProperty("Icon", "string", "Schema icon"),
	},
	name: {
		filter: true,
		display: true,
		property: createRuntimeProperty("Name", "string", "Schema name"),
	},
	slug: {
		filter: true,
		display: true,
		property: createRuntimeProperty("Slug", "string", "Schema slug"),
	},
	userId: {
		filter: true,
		display: true,
		property: createRuntimeProperty("User ID", "string", "Owner user id"),
	},
	isBuiltin: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Is Builtin",
			"boolean",
			"Whether the schema is built in",
		),
	},
	createdAt: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Created At",
			"datetime",
			"Schema creation timestamp",
		),
	},
	updatedAt: {
		filter: true,
		display: true,
		property: createRuntimeProperty(
			"Updated At",
			"datetime",
			"Schema update timestamp",
		),
	},
	accentColor: {
		filter: false,
		display: true,
		property: createRuntimeProperty(
			"Accent Color",
			"string",
			"Schema accent color",
		),
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

export const sortFilterBuiltins: ReadonlySet<string> = new Set([
	...Object.entries(entityRuntimeColumns)
		.filter(([, value]) => value.filter)
		.map(([key]) => key),
	...Object.entries(entitySchemaRuntimeColumns)
		.filter(([, value]) => value.filter)
		.map(([key]) => key),
]);

export const displayBuiltins: ReadonlySet<string> = new Set([
	...Object.entries(entityRuntimeColumns)
		.filter(([, value]) => value.display)
		.map(([key]) => key),
	...Object.entries(entitySchemaRuntimeColumns)
		.filter(([, value]) => value.display)
		.map(([key]) => key),
]);

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

export const getEntitySchemaColumnPropertyDefinition = (
	column: string,
): AppPropertyDefinition | null => {
	return (
		getRuntimeColumnConfig(entitySchemaRuntimeColumns, column)?.property ?? null
	);
};

export const getEntitySchemaColumnPropertyType = (
	column: string,
): PropertyType | null => {
	return getEntitySchemaColumnPropertyDefinition(column)?.type ?? null;
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

export const serializeComparablePropertyDefinition = (
	property: AppPropertyDefinition,
): string => {
	const { description: _description, label: _label, ...rest } = property;

	if (property.type === "array") {
		return JSON.stringify({
			...rest,
			items: JSON.parse(serializeComparablePropertyDefinition(property.items)),
		});
	}

	if (property.type === "object") {
		return JSON.stringify({
			...rest,
			properties: Object.fromEntries(
				Object.entries(property.properties).map(([key, value]) => [
					key,
					JSON.parse(serializeComparablePropertyDefinition(value)),
				]),
			),
		});
	}

	return JSON.stringify(rest);
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
	reference: Extract<RuntimeRef, { type: "event-join" }>,
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

	const firstSerialized =
		serializeComparablePropertyDefinition(firstDefinition);
	for (const definition of restDefinitions) {
		if (serializeComparablePropertyDefinition(definition) !== firstSerialized) {
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

export const getEventColumnPropertyDefinition = (
	column: string,
): AppPropertyDefinition | null => {
	return getRuntimeColumnConfig(eventRuntimeColumns, column)?.property ?? null;
};

export const getEventColumnPropertyType = (
	column: string,
): PropertyType | null => {
	return getEventColumnPropertyDefinition(column)?.type ?? null;
};

export const getEventSchemaColumnPropertyDefinition = (
	column: string,
): AppPropertyDefinition | null => {
	return (
		getRuntimeColumnConfig(eventSchemaRuntimeColumns, column)?.property ?? null
	);
};

export const getEventSchemaColumnPropertyType = (
	column: string,
): PropertyType | null => {
	return getEventSchemaColumnPropertyDefinition(column)?.type ?? null;
};

export const eventSortFilterBuiltins: ReadonlySet<string> = new Set(
	Object.entries(eventRuntimeColumns)
		.filter(([, value]) => value.filter)
		.map(([key]) => key),
);

export const eventDisplayBuiltins: ReadonlySet<string> = new Set(
	Object.entries(eventRuntimeColumns)
		.filter(([, value]) => value.display)
		.map(([key]) => key),
);

export const eventSchemaSortFilterBuiltins: ReadonlySet<string> = new Set(
	Object.entries(eventSchemaRuntimeColumns)
		.filter(([, value]) => value.filter)
		.map(([key]) => key),
);

export const eventSchemaDisplayBuiltins: ReadonlySet<string> = new Set(
	Object.entries(eventSchemaRuntimeColumns)
		.filter(([, value]) => value.display)
		.map(([key]) => key),
);
