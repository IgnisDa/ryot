import type { Result } from "@ryot-app/plugin-kit/effect";
import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	castNumber,
	castText,
	column,
	jsonPath,
	NullableNumber,
	selectedField,
	selectedRowsSource,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { LocalAssetLocator, RemoteAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";

const AssetLocator = Schema.Union([LocalAssetLocator, RemoteAssetLocator, S3AssetLocator]);
const nullableString = Schema.NullOr(Schema.String);
const nullableStrings = Schema.NullOr(Schema.Array(Schema.String));

export const pokemonPresentationSource = () => {
	const pokemon = table("entity", "entity");
	const property = (key: string) => jsonPath(column(pokemon, "properties"), key);
	return selectedRowsSource(pokemon, {
		selection: {
			presentationId: selectedField(column(pokemon, "id"), Schema.String),
			presentationTypes: selectedField(property("types"), nullableStrings),
			presentationName: selectedField(column(pokemon, "name"), Schema.String),
			presentationAbilities: selectedField(property("abilities"), nullableStrings),
			presentationHeight: selectedField(castNumber(property("height")), NullableNumber),
			presentationWeight: selectedField(castNumber(property("weight")), NullableNumber),
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
	return selectedRowsSource(move, {
		selection: {
			presentationId: selectedField(column(move, "id"), Schema.String),
			presentationName: selectedField(column(move, "name"), Schema.String),
			presentationType: selectedField(castText(property("type")), nullableString),
			presentationPower: selectedField(castNumber(property("power")), NullableNumber),
			presentationGeneration: selectedField(castText(property("generation")), nullableString),
			presentationDamageClass: selectedField(castText(property("damageClass")), nullableString),
		},
	});
};

export type MovePresentationSourceData = Result.Result.Success<
	ReturnType<ReturnType<typeof movePresentationSource>["decode"]>
>;
