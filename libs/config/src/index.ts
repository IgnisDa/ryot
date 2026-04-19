import type {
	AppBooleanProperty,
	AppEnumProperty,
	AppIntegerProperty,
	AppObjectProperty,
	AppPropertyDefinition,
	AppSchema,
	AppSchemaFields,
	AppStringProperty,
} from "@ryot/contract/schema/property-schema";
import { Config, Effect, Option, Redacted, Schema, SchemaIssue } from "effect";

const ConfigValueType: unique symbol = Symbol.for("@ryot/config/ConfigValue");

type Validation = { readonly required?: true | undefined };

type FieldOptions<A> = {
	readonly label: string;
	readonly description: string;
	readonly secret?: true | undefined;
	readonly envKey?: string | undefined;
	readonly hidden?: boolean | undefined;
	readonly defaultValue?: A | undefined;
	readonly validation?: Validation | undefined;
};

type FieldValue<A, O> = O extends { readonly secret: true }
	? O extends { readonly defaultValue: A }
		? Redacted.Redacted<A>
		: O extends { readonly validation: { readonly required: true } }
			? Redacted.Redacted<A>
			: Option.Option<Redacted.Redacted<A>>
	: O extends { readonly defaultValue: A }
		? A
		: O extends { readonly validation: { readonly required: true } }
			? A
			: Option.Option<A>;

const fieldSchemaOptions = <A>(options: FieldOptions<A>) =>
	({
		label: options.label,
		description: options.description,
		...(options.secret === true ? { secret: true } : {}),
		...(options.defaultValue !== undefined ? { defaultValue: options.defaultValue } : {}),
		...(options.validation !== undefined ? { validation: options.validation } : {}),
	}) satisfies {
		readonly label: string;
		readonly description: string;
		readonly secret?: true | undefined;
		readonly defaultValue?: A | undefined;
		readonly validation?: Validation | undefined;
	};

export type ConfigFieldDefinition<
	A = unknown,
	P extends AppPropertyDefinition = AppPropertyDefinition,
> = {
	readonly schema: P;
	readonly kind: "field";
	readonly hidden: boolean;
	readonly [ConfigValueType]?: A;
	readonly envKey?: string | undefined;
};

export type ConfigGroupDefinition<F extends ConfigFields = ConfigFields> = {
	readonly fields: F;
	readonly kind: "group";
	readonly schema: AppObjectProperty;
	readonly [ConfigValueType]?: ConfigValues<F>;
};

export type ConfigNode = ConfigFieldDefinition | ConfigGroupDefinition;
export interface ConfigFields {
	readonly [key: string]: ConfigNode;
}

export type ConfigValue<D extends ConfigNode | ConfigDefinition> =
	D extends ConfigGroupDefinition<infer F>
		? ConfigValues<F>
		: D extends ConfigFieldDefinition<infer A>
			? A
			: D extends ConfigDefinition<infer F>
				? ConfigValues<F>
				: never;

export type ConfigValues<F extends ConfigFields> = { readonly [K in keyof F]: ConfigValue<F[K]> };

export type ConfigDefinition<F extends ConfigFields = ConfigFields> = {
	readonly fields: F;
	readonly label: string;
	readonly schema: AppSchema;
	readonly description: string;
	readonly [ConfigValueType]?: ConfigValues<F>;
	readonly config: Config.Config<ConfigValues<F>>;
};

export type ConfigEnvironmentKeyResolver = (
	path: ReadonlyArray<string>,
	field: AppPropertyDefinition,
) => string;

export type ConfigReferencePlugin = {
	readonly name: string;
	readonly slug: string;
	readonly schema: AppSchema | ConfigDefinition;
};

export const stringField = <const O extends FieldOptions<string>>(
	options: O,
): ConfigFieldDefinition<FieldValue<string, O>, AppStringProperty> => ({
	kind: "field",
	envKey: options.envKey,
	hidden: options.hidden ?? false,
	schema: { type: "string", ...fieldSchemaOptions(options) },
});

export const integerField = <const O extends FieldOptions<number>>(
	options: O,
): ConfigFieldDefinition<FieldValue<number, O>, AppIntegerProperty> => ({
	kind: "field",
	envKey: options.envKey,
	hidden: options.hidden ?? false,
	schema: { type: "integer", ...fieldSchemaOptions(options) },
});

export const booleanField = <const O extends FieldOptions<boolean>>(
	options: O,
): ConfigFieldDefinition<FieldValue<boolean, O>, AppBooleanProperty> => ({
	kind: "field",
	envKey: options.envKey,
	hidden: options.hidden ?? false,
	schema: { type: "boolean", ...fieldSchemaOptions(options) },
});

export const enumField = <
	const Values extends readonly [string, ...string[]],
	const O extends FieldOptions<Values[number]>,
>(
	options: O & { readonly options: Values },
): ConfigFieldDefinition<FieldValue<Values[number], O>, AppEnumProperty> => ({
	kind: "field",
	envKey: options.envKey,
	hidden: options.hidden ?? false,
	schema: { type: "enum", options: options.options, ...fieldSchemaOptions(options) },
});

export const group = <const F extends ConfigFields>(
	options: { readonly label: string; readonly description: string },
	fields: F,
) =>
	({
		fields,
		kind: "group",
		schema: {
			type: "object",
			label: options.label,
			validation: { required: true },
			properties: schemaFields(fields),
			description: options.description,
		},
	}) as ConfigGroupDefinition<F>;

const schemaFields = (fields: ConfigFields): AppSchemaFields =>
	Object.fromEntries(Object.entries(fields).map(([key, definition]) => [key, definition.schema]));

const primitiveConfig = (field: AppPropertyDefinition, envKey: string): Config.Config<unknown> => {
	if (field.type === "boolean") {
		return Config.boolean(envKey);
	}
	if (field.type === "integer") {
		return Config.int(envKey);
	}
	if (field.type === "number") {
		return Config.number(envKey);
	}
	if (field.type === "enum") {
		return Config.string(envKey).pipe(
			Config.mapOrFail((value) =>
				field.options.includes(value)
					? Effect.succeed(value)
					: Effect.fail(
							new Config.ConfigError(
								new Schema.SchemaError(
									new SchemaIssue.InvalidValue(Option.some(value), {
										message: `${envKey} must be one of: ${field.options.join(", ")}`,
									}),
								),
							),
						),
			),
		);
	}
	return Config.string(envKey);
};

const leafConfig = (field: AppPropertyDefinition, envKey: string, redactSecrets: boolean) => {
	let config = primitiveConfig(field, envKey);
	if (redactSecrets && field.secret === true) {
		config = config.pipe(Config.map(Redacted.make));
	}

	if (field.defaultValue !== undefined) {
		const value =
			redactSecrets && field.secret === true
				? Redacted.make(field.defaultValue)
				: field.defaultValue;
		return config.pipe(Config.withDefault(value));
	}
	return field.validation?.required === true ? config : config.pipe(Config.option);
};

const configFromFields = (
	fields: AppSchemaFields,
	resolveEnvKey: ConfigEnvironmentKeyResolver,
	redactSecrets: boolean,
	path: ReadonlyArray<string>,
): Config.Config<Record<string, unknown>> =>
	Config.all(
		Object.fromEntries(
			Object.entries(fields).map(([key, field]) => {
				const fieldPath = [...path, key];
				const config =
					field.type === "object"
						? configFromFields(field.properties, resolveEnvKey, redactSecrets, fieldPath)
						: leafConfig(field, resolveEnvKey(fieldPath, field), redactSecrets);
				return [key, config];
			}),
		),
	);

function configFromDefinitionFields<const F extends ConfigFields>(
	fields: F,
	resolveEnvKey: ConfigEnvironmentKeyResolver,
	redactSecrets: boolean,
): Config.Config<ConfigValues<F>>;
function configFromDefinitionFields(
	fields: ConfigFields,
	resolveEnvKey: ConfigEnvironmentKeyResolver,
	redactSecrets: boolean,
) {
	return configFromFields(schemaFields(fields), resolveEnvKey, redactSecrets, []);
}

export const configFromAppSchema = (
	schema: AppSchema,
	envKeyResolver: ConfigEnvironmentKeyResolver,
) => configFromFields(schema.fields, envKeyResolver, false, []);

const define = <const F extends ConfigFields>(
	fields: F,
	options: { readonly label?: string; readonly description?: string } | undefined,
	resolveEnvKey: ConfigEnvironmentKeyResolver,
	redactSecrets: boolean,
) => {
	const schema = { fields: schemaFields(fields), unknownKeys: "strict" } satisfies AppSchema;
	return {
		fields,
		schema,
		label: options?.label ?? "Application configuration",
		description: options?.description ?? "Application configuration",
		config: configFromDefinitionFields(fields, resolveEnvKey, redactSecrets),
	} satisfies ConfigDefinition<F>;
};

export const defineConfig = <const F extends ConfigFields>(
	fields: F,
	options?: { readonly label?: string; readonly description?: string },
) =>
	define(
		fields,
		options,
		(path) => {
			let node: ConfigNode | undefined;
			let children: ConfigFields = fields;
			for (const segment of path) {
				node = children[segment];
				children = node?.kind === "group" ? node.fields : {};
			}
			if (node?.kind !== "field" || node.envKey === undefined) {
				throw new Error(`Config field ${path.join(".")} requires an envKey`);
			}
			return node.envKey;
		},
		true,
	);

type PluginFields<F extends ConfigFields> =
	Extract<F[keyof F], ConfigGroupDefinition | { readonly envKey: string }> extends never
		? F
		: never;

const normalizeEnvironmentSegment = (value: string) =>
	value
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase();

export const pluginConfigEnvironmentKey = (pluginSlug: string, key: string) =>
	`RYOT_PLUGIN_${normalizeEnvironmentSegment(pluginSlug)}_${normalizeEnvironmentSegment(key)}`;

export const definePluginConfig = <const F extends ConfigFields>(
	pluginSlug: string,
	fields: PluginFields<F>,
) =>
	define(
		fields,
		undefined,
		(path) => pluginConfigEnvironmentKey(pluginSlug, path.join("_")),
		false,
	);

const isDefinition = (value: AppSchema | ConfigDefinition): value is ConfigDefinition =>
	"schema" in value && "fields" in value;

const fieldHidden = (definition: ConfigDefinition | undefined, path: ReadonlyArray<string>) => {
	let fields = definition?.fields;
	let node: ConfigNode | undefined;
	for (const segment of path) {
		node = fields?.[segment];
		fields = node?.kind === "group" ? node.fields : undefined;
	}
	return node?.kind === "field" && node.hidden;
};

const formatDefaultValue = (value: unknown) =>
	typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? String(value)
		: JSON.stringify(value);

const renderTable = (
	schema: AppSchemaFields,
	definition: ConfigDefinition | undefined,
	resolveEnvKey: ConfigEnvironmentKeyResolver,
	lines: string[],
	path: ReadonlyArray<string>,
	level: number,
) => {
	const directFields = Object.entries(schema).filter(
		([key, field]) => field.type !== "object" && !fieldHidden(definition, [...path, key]),
	);
	if (directFields.length > 0) {
		lines.push(
			"| App Config Key | Variable | Description | Required | Sensitive | Default |",
			"|---|---|---|---|---|---|",
			...directFields.map(([key, field]) => {
				const fieldPath = [...path, key];
				const fallback =
					field.defaultValue === undefined ? "—" : `\`${formatDefaultValue(field.defaultValue)}\``;
				return `| \`${fieldPath.join(".")}\` | \`${resolveEnvKey(fieldPath, field)}\` | ${field.description} | ${field.validation?.required === true ? "Yes" : "No"} | ${field.secret === true ? "Yes" : "No"} | ${fallback} |`;
			}),
			"",
		);
	}
	for (const [key, field] of Object.entries(schema)) {
		if (field.type !== "object") {
			continue;
		}
		lines.push(`${"#".repeat(level)} ${field.description}\n`);
		renderTable(field.properties, definition, resolveEnvKey, lines, [...path, key], level + 1);
	}
};

export const renderConfigReference = (
	core: ConfigDefinition,
	plugins: ReadonlyArray<ConfigReferencePlugin>,
) => {
	const lines = [
		"# App Backend Configuration Reference\n",
		"> This file is auto-generated on dev server startup. Do not edit manually.\n",
		`## ${core.description}\n`,
	];
	renderTable(
		core.schema.fields,
		core,
		(path) => {
			let fields = core.fields;
			let node: ConfigNode | undefined;
			for (const segment of path) {
				node = fields[segment];
				fields = node?.kind === "group" ? node.fields : {};
			}
			return node?.kind === "field" ? (node.envKey ?? "") : "";
		},
		lines,
		[],
		3,
	);
	for (const plugin of plugins) {
		const definition = isDefinition(plugin.schema) ? plugin.schema : undefined;
		const schema = isDefinition(plugin.schema) ? plugin.schema.schema : plugin.schema;
		const fields = Object.entries(schema.fields).filter(([key]) => !fieldHidden(definition, [key]));
		if (fields.length === 0) {
			continue;
		}
		lines.push(
			`## ${plugin.name} plugin configuration\n`,
			"| Plugin Config Key | Variable | Label | Description | Required | Sensitive | Default |",
			"|---|---|---|---|---|---|---|",
			...fields.map(([key, field]) => {
				const fallback =
					field.defaultValue === undefined ? "—" : `\`${formatDefaultValue(field.defaultValue)}\``;
				return `| \`${plugin.slug}.${key}\` | \`${pluginConfigEnvironmentKey(plugin.slug, key)}\` | ${field.label} | ${field.description} | ${field.validation?.required === true ? "Yes" : "No"} | ${field.secret === true ? "Yes" : "No"} | ${fallback} |`;
			}),
			"",
		);
	}
	return lines.join("\n");
};
