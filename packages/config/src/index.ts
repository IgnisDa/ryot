import type { AuthoredSchemaText } from "@ryot-app/contract/modules/plugins/manifest-text";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import {
	type AppBooleanProperty,
	type AppChoice,
	type AppEnumProperty,
	type AppIntegerProperty,
	type AppObjectProperty,
	type AppPropertyDefinition,
	type AppSchema,
	type AppSchemaFields,
	type AppStringProperty,
	isAppPropertyRequired,
} from "@ryot-app/contract/schema/property-schema";
import type { Option } from "effect";
import { Config, Effect, Redacted, Schema, SchemaIssue } from "effect";

const ConfigValueType: unique symbol = Symbol.for("@ryot-app/config/ConfigValue");

type Validation = { readonly required?: true | undefined };

type FieldOptions<A, Text = string> = {
	readonly label: Text;
	readonly description: string;
	readonly hint?: Text | undefined;
	readonly secret?: true | undefined;
	readonly envKey?: string | undefined;
	readonly hidden?: boolean | undefined;
	readonly defaultValue?: A | undefined;
	readonly validation?: undefined | Validation;
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

const fieldSchemaOptions = <A, Text>(options: FieldOptions<A, Text>) =>
	({
		label: options.label,
		description: options.description,
		...(options.hint === undefined ? {} : { hint: options.hint }),
		...(options.secret === true ? { secret: true } : {}),
		...(options.defaultValue !== undefined ? { defaultValue: options.defaultValue } : {}),
		...(options.validation !== undefined ? { validation: options.validation } : {}),
	}) satisfies {
		readonly label: Text;
		readonly hint?: Text;
		readonly description: string;
		readonly secret?: true | undefined;
		readonly defaultValue?: A | undefined;
		readonly validation?: undefined | Validation;
	};

/** Labels are `Text`: plain strings for the application, manifest text for plugins. */
export interface ConfigFields<Text = unknown> {
	readonly [key: string]: ConfigNode<Text>;
}

export type ConfigValues<F extends ConfigFields> = { readonly [K in keyof F]: ConfigValue<F[K]> };

export type ConfigEnvironmentKeyResolver = (
	path: ReadonlyArray<string>,
	field: AppPropertyDefinition<unknown>,
) => string;
export type ConfigNode<Text = unknown> =
	| ConfigGroupDefinition<ConfigFields<Text>, Text>
	| ConfigFieldDefinition<unknown, AppPropertyDefinition<Text>>;

export type ConfigGroupDefinition<F extends ConfigFields = ConfigFields, Text = string> = {
	readonly fields: F;
	readonly kind: "group";
	readonly schema: AppObjectProperty<Text>;
	readonly [ConfigValueType]?: ConfigValues<F>;
};

export type ConfigValue<D extends ConfigNode | ConfigDefinition> =
	D extends ConfigGroupDefinition<infer F>
		? ConfigValues<F>
		: D extends ConfigFieldDefinition<infer A>
			? A
			: D extends ConfigDefinition<infer F>
				? ConfigValues<F>
				: never;

export type ConfigFieldDefinition<
	A = unknown,
	P extends AppPropertyDefinition<unknown> = AppPropertyDefinition<unknown>,
> = {
	readonly schema: P;
	readonly kind: "field";
	readonly hidden: boolean;
	readonly [ConfigValueType]?: A;
	readonly envKey?: string | undefined;
};

export type ConfigDefinition<F extends ConfigFields = ConfigFields, Text = string> = {
	readonly fields: F;
	readonly label: string;
	readonly description: string;
	readonly schema: AppSchema<Text>;
	readonly [ConfigValueType]?: ConfigValues<F>;
	readonly config: Config.Config<ConfigValues<F>>;
};

export const stringField = <Text, const O extends FieldOptions<string, Text>>(
	options: O & { readonly label: Text },
): ConfigFieldDefinition<FieldValue<string, O>, AppStringProperty<Text>> => ({
	kind: "field",
	envKey: options.envKey,
	hidden: options.hidden ?? false,
	schema: { type: "string", ...fieldSchemaOptions<string, Text>(options) },
});

export const integerField = <Text, const O extends FieldOptions<number, Text>>(
	options: O & { readonly label: Text },
): ConfigFieldDefinition<FieldValue<number, O>, AppIntegerProperty<Text>> => ({
	kind: "field",
	envKey: options.envKey,
	hidden: options.hidden ?? false,
	schema: { type: "integer", ...fieldSchemaOptions<number, Text>(options) },
});

export const booleanField = <Text, const O extends FieldOptions<boolean, Text>>(
	options: O & { readonly label: Text },
): ConfigFieldDefinition<FieldValue<boolean, O>, AppBooleanProperty<Text>> => ({
	kind: "field",
	envKey: options.envKey,
	hidden: options.hidden ?? false,
	schema: { type: "boolean", ...fieldSchemaOptions<boolean, Text>(options) },
});

export const enumField = <
	Text,
	const Values extends readonly [AppChoice<unknown>, ...AppChoice<unknown>[]],
	const O extends FieldOptions<Values[number]["value"], Text>,
>(
	options: O & {
		readonly label: Text;
		readonly choices: {
			readonly kind: "static";
			readonly values: Values & ReadonlyArray<AppChoice<Text>>;
		};
	},
): ConfigFieldDefinition<FieldValue<Values[number]["value"], O>, AppEnumProperty<Text>> => ({
	kind: "field",
	envKey: options.envKey,
	hidden: options.hidden ?? false,
	schema: {
		type: "enum",
		choices: options.choices,
		...fieldSchemaOptions<Values[number]["value"], Text>(options),
	},
});

export const group = <Text, const F extends ConfigFields<Text>>(
	options: { readonly label: Text; readonly description: string },
	fields: F,
): ConfigGroupDefinition<F, Text> => ({
	fields,
	kind: "group",
	schema: {
		type: "object",
		label: options.label,
		validation: { required: true },
		properties: schemaFields(fields),
		description: options.description,
	},
});

const schemaFields = <Text>(fields: ConfigFields<Text>): AppSchemaFields<Text> =>
	Object.fromEntries(Object.entries(fields).map(([key, definition]) => [key, definition.schema]));

const primitiveConfig = (
	field: AppPropertyDefinition<unknown>,
	envKey: string,
): Config.Config<unknown> => {
	if (field.type === "boolean") {
		return Config.Boolean(envKey);
	}
	if (field.type === "integer") {
		return Config.Int(envKey);
	}
	if (field.type === "number") {
		return Config.Number(envKey);
	}
	if (field.type === "enum") {
		if (field.choices.kind === "dynamic") {
			return Config.String(envKey).pipe(
				Config.mapEffect(() =>
					Effect.fail(
						new Config.ConfigError(
							new Schema.SchemaError(
								new SchemaIssue.InvalidValue({
									message: `${envKey} has unresolved dynamic choices`,
								}),
							),
						),
					),
				),
			);
		}
		const choices = field.choices.values.map((choice) => choice.value);
		return Config.String(envKey).pipe(
			Config.mapEffect((value) =>
				choices.includes(value)
					? Effect.succeed(value)
					: Effect.fail(
							new Config.ConfigError(
								new Schema.SchemaError(
									new SchemaIssue.InvalidValue({
										message: `${envKey} must be one of: ${choices.join(", ")}`,
									}),
								),
							),
						),
			),
		);
	}
	return Config.String(envKey);
};

const leafConfig = (
	field: AppPropertyDefinition<unknown>,
	envKey: string,
	redactSecrets: boolean,
) => {
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
	return isAppPropertyRequired(field) ? config : config.pipe(Config.option);
};

const configFromFields = (
	fields: AppSchemaFields<unknown>,
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
	schema: AppSchema<unknown>,
	envKeyResolver: ConfigEnvironmentKeyResolver,
) => configFromFields(schema.fields, envKeyResolver, false, []);

const define = <Text, const F extends ConfigFields<Text>>(
	fields: F,
	options: undefined | { readonly label?: string; readonly description?: string },
	resolveEnvKey: ConfigEnvironmentKeyResolver,
	redactSecrets: boolean,
): ConfigDefinition<F, Text> => ({
	fields,
	label: options?.label ?? "Application configuration",
	description: options?.description ?? "Application configuration",
	schema: { unknownKeys: "strict", fields: schemaFields<Text>(fields) },
	config: configFromDefinitionFields(fields, resolveEnvKey, redactSecrets),
});

export const defineConfig = <const F extends ConfigFields<string>>(
	fields: F,
	options?: { readonly label?: string; readonly description?: string },
) =>
	define<string, F>(
		fields,
		options,
		(path) => {
			let node: undefined | ConfigNode;
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

export const definePluginConfig = <const F extends ConfigFields<AuthoredSchemaText>>(
	packageId: PluginPackageId,
	fields: PluginFields<F>,
) =>
	define<AuthoredSchemaText, F>(
		fields,
		undefined,
		(path) => pluginConfigEnvironmentKey(packageId, path.join("_")),
		false,
	);
