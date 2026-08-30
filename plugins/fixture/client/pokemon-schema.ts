import { AssetLocator } from "@ryot-app/client-sdk";
import { Schema } from "@ryot-app/client-sdk/effect";

export const PokemonArtworkSchema = AssetLocator;
export const PokemonNumberSchema = Schema.NullOr(Schema.Number);
export const PokemonStringsSchema = Schema.NullOr(Schema.Array(Schema.String));
export const PokemonArtworkListSchema = Schema.NullOr(Schema.Array(PokemonArtworkSchema));
export const PokemonDetailsSchema = Schema.Struct({
	height: PokemonNumberSchema,
	weight: PokemonNumberSchema,
	abilities: PokemonStringsSchema,
});

export type PokemonArtworkAsset = Schema.Schema.Type<typeof PokemonArtworkSchema>;
export type PokemonDetailsData = Schema.Schema.Type<typeof PokemonDetailsSchema>;
