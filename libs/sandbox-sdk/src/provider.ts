import * as z from "@ryot/sandbox-sdk/zod";

import {
	jsonValueSchema,
	SANDBOX_SCRIPT_DEFINITION,
	type GenericDriver,
	type GenericScriptDefinition,
	type SandboxManifest,
} from "./core.js";

export type ProviderManifest = Extract<SandboxManifest, { kind: "provider" }>;

export const providerSearchInputSchema = z
	.object({
		query: z.string().trim().catch(""),
		page: z.coerce.number().min(1).transform(Math.floor).catch(1),
		pageSize: z.coerce.number().min(1).max(100).transform(Math.floor).catch(20),
	})
	.strict();

const nullPropertySchema = z.object({ kind: z.literal("null"), value: z.null() }).strict();
const numberPropertySchema = z.object({ kind: z.literal("number"), value: z.number() }).strict();
const textPropertySchema = z
	.object({ kind: z.literal("text"), value: z.string().trim().min(1) })
	.strict();

export const providerSearchItemSchema = z
	.object({
		externalId: z.string().trim().min(1),
		titleProperty: textPropertySchema,
		imageProperty: jsonValueSchema.optional(),
		calloutProperty: jsonValueSchema.optional(),
		secondarySubtitleProperty: jsonValueSchema.optional(),
		primarySubtitleProperty: z.union([nullPropertySchema, numberPropertySchema]).optional(),
	})
	.strict();

export const providerSearchResultSchema = z
	.object({
		items: z.array(providerSearchItemSchema).readonly(),
		details: z
			.object({
				totalItems: z.number(),
				nextPage: z.number().nullable(),
			})
			.strict()
			.optional(),
	})
	.strict();

export const providerDetailsInputSchema = z
	.object({ externalId: z.string().trim().min(1, "externalId is required") })
	.strict();

export const providerDetailsRelatedEntitySchema = z
	.object({
		name: z.string(),
		externalId: z.string(),
		scriptSlug: z.string(),
		relationshipProperties: jsonValueSchema.optional(),
	})
	.strict();

export const providerDetailsRelatedEntityGroupSchema = z
	.object({
		direction: z.enum(["incoming", "outgoing"]),
		entities: z.array(providerDetailsRelatedEntitySchema).readonly(),
		synchronization: z.enum(["authoritative", "additive"]),
		relationshipSchemaSlug: z.string(),
	})
	.strict();

export type ProviderDetailsChildEntity = {
	readonly name: string;
	readonly externalId: string;
	readonly entitySchemaSlug: string;
	readonly properties: z.output<typeof jsonValueSchema>;
	readonly childEntities?: readonly ProviderDetailsChildEntity[] | undefined;
};

export const providerDetailsChildEntitySchema: z.ZodType<ProviderDetailsChildEntity> = z.lazy(() =>
	z
		.object({
			name: z.string(),
			externalId: z.string(),
			properties: jsonValueSchema,
			entitySchemaSlug: z.string(),
			childEntities: z.array(providerDetailsChildEntitySchema).readonly().optional(),
		})
		.strict(),
);

export const providerDetailsResultSchema = z
	.object({
		name: z.string(),
		properties: jsonValueSchema,
		childEntities: z.array(providerDetailsChildEntitySchema).readonly().optional(),
		relatedEntityGroups: z.array(providerDetailsRelatedEntityGroupSchema).readonly().optional(),
	})
	.strict();

export const providerResolveInputSchema = z
	.object({
		value: z.string().trim().min(1),
		identifierType: z.string().trim().min(1),
	})
	.strict();

export const providerResolveResultSchema = z.object({ externalId: z.string().nullable() }).strict();

export const providerTranslateInputSchema = z
	.object({
		properties: jsonValueSchema.optional(),
		language: z.string().trim().min(1),
		externalId: z.string().trim().min(1),
		entitySchemaSlug: z.string().trim().min(1),
	})
	.strict();

export const providerTranslateResultSchema = z
	.object({
		name: z.string().nullable().optional(),
		properties: z.record(z.string(), jsonValueSchema).nullable().optional(),
	})
	.strict();

export const providerDriverContracts = {
	search: { input: providerSearchInputSchema, output: providerSearchResultSchema },
	details: { input: providerDetailsInputSchema, output: providerDetailsResultSchema },
	resolve: { input: providerResolveInputSchema, output: providerResolveResultSchema },
	translate: { input: providerTranslateInputSchema, output: providerTranslateResultSchema },
} as const;

export type ProviderSearchItem = z.output<typeof providerSearchItemSchema>;
export type ProviderSearchInput = z.output<typeof providerSearchInputSchema>;
export type ProviderSearchResult = z.output<typeof providerSearchResultSchema>;
export type ProviderDetailsInput = z.output<typeof providerDetailsInputSchema>;
export type ProviderDetailsResult = z.output<typeof providerDetailsResultSchema>;
export type ProviderResolveInput = z.output<typeof providerResolveInputSchema>;
export type ProviderResolveResult = z.output<typeof providerResolveResultSchema>;
export type ProviderTranslateInput = z.output<typeof providerTranslateInputSchema>;
export type ProviderTranslateResult = z.output<typeof providerTranslateResultSchema>;
export type ProviderDetailsRelatedEntity = z.output<typeof providerDetailsRelatedEntitySchema>;
export type ProviderDetailsRelatedEntityGroup = z.output<
	typeof providerDetailsRelatedEntityGroupSchema
>;

export type ProviderDriverName = keyof typeof providerDriverContracts;

export type ProviderDriver<
	Manifest extends ProviderManifest,
	Name extends ProviderDriverName,
> = GenericDriver<
	(typeof providerDriverContracts)[Name]["input"],
	(typeof providerDriverContracts)[Name]["output"],
	Manifest["capabilities"]
>;

export const defineProviderDriver = <
	const Manifest extends ProviderManifest,
	const Name extends ProviderDriverName,
>(
	_manifest: Manifest,
	name: Name,
	run: ProviderDriver<Manifest, Name>["run"],
): ProviderDriver<Manifest, Name> => ({
	run,
	input: providerDriverContracts[name].input,
	output: providerDriverContracts[name].output,
});

type StandardProviderDrivers<Manifest extends ProviderManifest> = {
	readonly [Name in ProviderDriverName]: ProviderDriver<Manifest, Name>;
};

export type ProviderDefinition<
	Manifest extends ProviderManifest,
	Drivers extends Partial<StandardProviderDrivers<Manifest>> & Record<string, unknown>,
> = GenericScriptDefinition<Manifest, Drivers>;

export const defineProvider = <
	const Manifest extends ProviderManifest,
	const Drivers extends Partial<StandardProviderDrivers<Manifest>> & Record<string, unknown>,
>(definition: {
	readonly manifest: Manifest;
	readonly drivers: Drivers;
}): ProviderDefinition<Manifest, Drivers> => ({
	...definition,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
