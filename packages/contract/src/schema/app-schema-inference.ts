import type { AppPropertyDefinition, AppSchema, AppSchemaFields } from "./property-schema";

export type AppSchemaInput<Definition extends AppSchema> = AppSchemaFieldValues<
	Definition["fields"]
>;

export type AppSchemaValue<Definition extends AppSchema> = AppSchemaFieldValues<
	Definition["fields"],
	true
>;

export type AppSchemaFieldValues<
	Fields extends AppSchemaFields,
	Defaults extends boolean = false,
> = { readonly [Key in RequiredKeys<Fields, Defaults>]: FieldValue<Fields[Key], Defaults> } & {
	readonly [Key in Exclude<keyof Fields, RequiredKeys<Fields, Defaults>>]?:
		FieldValue<Fields[Key], Defaults> | (Defaults extends false ? undefined : never);
};

export type AppPropertyValue<
	Property extends AppPropertyDefinition,
	Defaults extends boolean = false,
> = Property extends { readonly type: "number" | "integer" }
	? number
	: Property extends { readonly type: "boolean" }
		? boolean
		: Property extends { readonly type: "enum" }
			? ChoiceValue<Property>
			: Property extends { readonly type: "enum-array" }
				? readonly ChoiceValue<Property>[]
				: Property extends {
							readonly type: "array";
							readonly items: infer Item extends AppPropertyDefinition;
					  }
					? readonly FieldValue<Item, Defaults>[]
					: Property extends {
								readonly type: "object";
								readonly properties: infer Fields extends AppSchemaFields;
						  }
						? AppSchemaFieldValues<Fields, Defaults>
						: string;

type ChoiceValue<Property> = Property extends {
	readonly choices: {
		readonly kind: "static";
		readonly values: readonly { readonly value: infer Value extends string }[];
	};
}
	? Value
	: string;
type FieldValue<
	Property extends AppPropertyDefinition,
	Defaults extends boolean,
> = Property extends { readonly validation: { readonly required: true } }
	? AppPropertyValue<Property, Defaults>
	: null | AppPropertyValue<Property, Defaults>;

type RequiredKeys<Fields extends AppSchemaFields, Defaults extends boolean> = {
	[Key in keyof Fields]: Defaults extends true
		? Fields[Key] extends
				{ readonly defaultValue: unknown } | { readonly validation: { readonly required: true } }
			? Key
			: never
		: Fields[Key] extends { readonly defaultValue: unknown }
			? never
			: Fields[Key] extends { readonly validation: { readonly required: true } }
				? Key
				: never;
}[keyof Fields];
