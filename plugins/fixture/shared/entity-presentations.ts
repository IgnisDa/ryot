import type { Result } from "@ryot-app/plugin-kit/effect";
import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	castNumber,
	castText,
	column,
	eq,
	inArray,
	jsonPath,
	literal,
	selectedField,
	selectedRowsSource,
	table,
	type SelectedSelection,
} from "@ryot-app/plugin-kit/ryotql";
import { LocalAssetLocator, RemoteAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";

const selectedPresentationSource = <const Selection extends SelectedSelection>(input: {
	readonly selection: Selection;
	readonly slug: string;
}) => {
	const entity = table("entity", "entity");
	const source = selectedRowsSource(entity, { selection: input.selection });
	return {
		...source,
		query: (entityIds: readonly string[]) =>
			source.query({
				limit: 100,
				where: and(
					eq(column(entity, "entitySchemaSlug"), literal(input.slug)),
					inArray(
						column(entity, "id"),
						entityIds.map((entityId) => literal(entityId)),
					),
				),
			}),
	};
};

const AssetLocator = Schema.Union([LocalAssetLocator, RemoteAssetLocator, S3AssetLocator]);
const nullableNumber = Schema.NullOr(Schema.Finite);
const nullableString = Schema.NullOr(Schema.String);
const nullableStrings = Schema.NullOr(Schema.Array(Schema.String));

export const pokemonPresentationSource = () => {
	const pokemon = table("entity", "entity");
	const property = (key: string) => jsonPath(column(pokemon, "properties"), key);
	return selectedPresentationSource({
		slug: "pokemon",
		selection: {
			presentationId: selectedField(column(pokemon, "id"), Schema.String),
			presentationTypes: selectedField(property("types"), nullableStrings),
			presentationName: selectedField(column(pokemon, "name"), Schema.String),
			presentationAbilities: selectedField(property("abilities"), nullableStrings),
			presentationHeight: selectedField(castNumber(property("height")), nullableNumber),
			presentationWeight: selectedField(castNumber(property("weight")), nullableNumber),
			presentationArtwork: selectedField(
				jsonPath(column(pokemon, "properties"), "images", 0),
				Schema.NullOr(AssetLocator),
			),
		},
	});
};

export type PokemonPresentationSourceData = Result.Result.Success<
	ReturnType<ReturnType<typeof pokemonPresentationSource>["decode"]>
>;

export const movePresentationSource = () => {
	const move = table("entity", "entity");
	const property = (key: string) => jsonPath(column(move, "properties"), key);
	return selectedPresentationSource({
		slug: "move",
		selection: {
			presentationId: selectedField(column(move, "id"), Schema.String),
			presentationName: selectedField(column(move, "name"), Schema.String),
			presentationType: selectedField(castText(property("type")), nullableString),
			presentationPower: selectedField(castNumber(property("power")), nullableNumber),
			presentationGeneration: selectedField(castText(property("generation")), nullableString),
			presentationDamageClass: selectedField(castText(property("damageClass")), nullableString),
		},
	});
};

export type MovePresentationSourceData = Result.Result.Success<
	ReturnType<ReturnType<typeof movePresentationSource>["decode"]>
>;
