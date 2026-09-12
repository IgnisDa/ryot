import { Schema, SchemaGetter } from "@ryot-app/plugin-kit/effect";

export const showEpisodeOrderTypes = [
	"original-air-date",
	"absolute",
	"dvd",
	"digital",
	"story-arc",
	"production",
	"tv",
] as const;

const ShowEpisodeOrderSchema = Schema.Struct({
	name: Schema.String,
	externalId: Schema.String,
	description: Schema.NullOr(Schema.String),
	type: Schema.Literals(showEpisodeOrderTypes),
	groups: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			order: Schema.Number,
			episodeExternalIds: Schema.Array(Schema.String),
		}),
	),
});

const ShowEpisodeOrderArraySchema = Schema.Array(ShowEpisodeOrderSchema);

/** A show's stored episode orders; a show that never stored any has none. */
export const ShowEpisodeOrderListSchema = Schema.NullOr(ShowEpisodeOrderArraySchema).pipe(
	Schema.decodeTo(ShowEpisodeOrderArraySchema, {
		encode: SchemaGetter.transform((orders) => orders),
		decode: SchemaGetter.transform((orders) => orders ?? []),
	}),
);

export type ShowEpisodeOrder = Schema.Schema.Type<typeof ShowEpisodeOrderSchema>;
