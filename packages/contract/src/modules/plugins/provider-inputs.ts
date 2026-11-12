import { Schema } from "effect";

const nonEmptyRecord = <Value extends Schema.Top>(value: Value) =>
	Schema.Record(Schema.NonEmptyString, value).pipe(
		Schema.check(Schema.makeFilter((inputs) => Object.keys(inputs).length > 0)),
	);

const ProviderEntityPropertyKeys = Schema.Array(Schema.NonEmptyString).pipe(
	Schema.check(Schema.makeFilter((keys) => new Set(keys).size === keys.length)),
);

export const ProviderTranslationInputs = nonEmptyRecord(ProviderEntityPropertyKeys);

const ProviderRelatedGroup = Schema.Struct({
	relationshipSchemaSlug: Schema.NonEmptyString,
	direction: Schema.Literals(["incoming", "outgoing"]),
	synchronization: Schema.Literals(["authoritative", "additive"]),
});

/** Child entity schemas whose related groups a `related` script populates, with the properties that address each child. */
export const ProviderRelatedInputs = nonEmptyRecord(
	Schema.Struct({
		properties: ProviderEntityPropertyKeys,
		groups: Schema.NonEmptyArray(ProviderRelatedGroup).pipe(
			Schema.check(
				Schema.makeFilter(
					(groups) =>
						new Set(groups.map((group) => `${group.direction}:${group.relationshipSchemaSlug}`))
							.size === groups.length,
				),
			),
		),
	}),
);

export type ProviderRelatedInputs = typeof ProviderRelatedInputs.Type;
