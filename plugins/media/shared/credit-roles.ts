import { Schema } from "@ryot-app/plugin-kit/effect";

/** Roles that providers derive rather than name; stored as codes and labelled through the catalog. */
export const creditRoleCodes = [
	"actor",
	"voice_actor",
	"creator",
	"author",
	"narrator",
	"artist",
	"developer",
	"publisher",
	"porting",
	"supporting",
	"production_company",
	"network",
	"studio",
	"distributor",
	"special_effects",
] as const;

export type CreditRoleCode = (typeof creditRoleCodes)[number];

export const CreditRoleCodeSchema = Schema.Literals(creditRoleCodes);

export const isCreditRoleCode = Schema.is(CreditRoleCodeSchema);

/** A creator without an entity: `role` is the source's own name, `roleCode` a role the provider implies. */
export const UnlinkedCreatorSchema = Schema.Struct({
	name: Schema.String,
	role: Schema.optionalKey(Schema.String),
	roleCode: Schema.optionalKey(CreditRoleCodeSchema),
});

export type UnlinkedCreator = typeof UnlinkedCreatorSchema.Type;
