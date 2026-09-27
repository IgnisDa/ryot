import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

const Guid = Schema.Struct({ id: Schema.String });
const Directory = Schema.Struct({ key: Schema.String, type: Schema.String, title: Schema.String });
const Metadata = Schema.Struct({
	key: Schema.String,
	type: Schema.String,
	title: Schema.String,
	index: Schema.optional(Schema.Int),
	parentIndex: Schema.optional(Schema.Int),
	ratingKey: Schema.optional(Schema.String),
	Guid: Schema.optional(Schema.Array(Guid)),
	lastViewedAt: Schema.optional(Schema.Union([Schema.Int, Schema.String])),
});
export const DirectoriesResponse = Schema.Struct({
	MediaContainer: Schema.Struct({
		Directory: Schema.Array(Directory).pipe(
			Schema.withDecodingDefault(Effect.succeed<ReadonlyArray<typeof Directory.Type>>([])),
			Schema.withConstructorDefault(Effect.sync(() => [])),
		),
	}),
});
export const MetadataResponse = Schema.Struct({
	MediaContainer: Schema.Struct({ Metadata: Schema.optional(Schema.Array(Metadata)) }),
});
export const providerIds = (guids: ReadonlyArray<{ id: string }> | undefined) => {
	const get = (prefix: string) =>
		guids?.find(({ id }) => id.startsWith(`${prefix}://`))?.id.slice(prefix.length + 3);
	return { imdb: get("imdb"), tmdb: get("tmdb"), tvdb: get("tvdb") };
};
