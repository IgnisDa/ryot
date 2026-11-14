import type {
	AggregateOrdering,
	OrderBy,
	Ordering,
	ParameterExpression,
	Predicate,
	ScalarExpression,
	TableReference,
} from "@ryot-app/contract/modules/ryotql/authored";
import type { AggregateOrderBy } from "@ryot-app/contract/modules/ryotql/language";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";

type EnumValues<Property> = Property extends {
	readonly choices: {
		readonly kind: "static";
		readonly values: readonly { readonly value: infer Value extends string }[];
	};
}
	? Value
	: never;
type KeysOfType<
	Definition extends AppSchema,
	Types extends AppPropertyDefinition["type"],
> = string &
	{
		[Key in keyof Definition["fields"]]: Definition["fields"][Key]["type"] extends Types
			? Key
			: never;
	}[keyof Definition["fields"]];
type OptionalKeys<Definition extends AppSchema> = string &
	{
		[Key in keyof Definition["fields"]]: Definition["fields"][Key] extends
			{ readonly defaultValue: unknown } | { readonly validation: { readonly required: true } }
			? never
			: Key;
	}[keyof Definition["fields"]];

export const parameters = <const Definition extends AppSchema>(schema: Definition) => ({
	schema,
	whenSet: (name: OptionalKeys<Definition>, predicate: Predicate): Predicate => ({
		predicate,
		type: "whenSet",
		parameter: name,
	}),
	sourceEntity: (name: SourceKeys<Definition>, alias: string): TableReference => ({
		alias,
		parameter: name,
		type: "sourceEntity",
	}),
	list: <const Name extends KeysOfType<Definition, "array" | "enum-array">>(
		name: Name,
	): ParameterExpression & { readonly name: Name } => ({ name, type: "parameter" }),
	value: <
		const Name extends string &
			Exclude<
				keyof Definition["fields"],
				KeysOfType<Definition, "array" | "object" | "enum-array">
			>,
	>(
		name: Name,
	): ParameterExpression & { readonly name: Name } => ({ name, type: "parameter" }),
	choice: <
		const Name extends KeysOfType<Definition, "enum">,
		const Cases extends Readonly<
			Record<
				EnumValues<Definition["fields"][Name]>,
				Ordering | Predicate | ScalarExpression | AggregateOrdering | readonly unknown[]
			>
		>,
	>(
		name: Name,
		cases: Cases,
	) => ({ cases, parameter: name, type: "choice" as const }),
});

export const now = (): Extract<ScalarExpression, { readonly type: "now" }> => ({ type: "now" });
export const dateAdd = (
	expr: ScalarExpression,
	amount: number | ParameterExpression,
	unit: Extract<ScalarExpression, { readonly type: "dateAdd" }>["unit"],
): ScalarExpression => ({ expr, unit, amount, type: "dateAdd" });
export const reportingTimeZone = { type: "context", name: "reportingTimeZone" } as const;
export const filter = (): Extract<Predicate, { readonly type: "filter" }> => ({ type: "filter" });
export const sort = (otherwise: readonly OrderBy[]): Ordering => ({ otherwise, type: "sort" });
export const aggregateSort = (otherwise: readonly AggregateOrderBy[]): AggregateOrdering => ({
	otherwise,
	type: "sort",
});

type SourceKeys<Definition extends AppSchema> = string &
	{
		[Key in keyof Definition["fields"]]: Definition["fields"][Key] extends {
			readonly type: "string";
			readonly reference: { readonly kind: "entity-source" };
		}
			? Key
			: never;
	}[keyof Definition["fields"]];
