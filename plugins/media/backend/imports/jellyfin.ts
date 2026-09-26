import { Schema } from "@ryot-app/sandbox-sdk/effect";

const AUTH = 'MediaBrowser Client="ryot", Device="ryot", DeviceId="ryot-import", Version="1.0.0"';
const ProviderIds = Schema.optional(
	Schema.Struct({
		Imdb: Schema.optional(Schema.String),
		Tmdb: Schema.optional(Schema.String),
		Tvdb: Schema.optional(Schema.String),
	}),
);
export const Item = Schema.Struct({
	ProviderIds,
	Id: Schema.String,
	Name: Schema.String,
	Type: Schema.optional(Schema.String),
	SeriesId: Schema.optional(Schema.String),
	IndexNumber: Schema.optional(Schema.Int),
	SeriesName: Schema.optional(Schema.String),
	ParentIndexNumber: Schema.optional(Schema.Int),
	UserData: Schema.optional(
		Schema.Struct({
			IsFavorite: Schema.optional(Schema.Boolean),
			LastPlayedDate: Schema.optional(Schema.String),
		}),
	),
});
export const AuthResponse = Schema.Struct({
	AccessToken: Schema.String,
	User: Schema.Struct({ Id: Schema.String }),
});
export const ItemsResponse = Schema.Struct({ Items: Schema.Array(Item) });
export const headers = (token?: string) => ({
	Accept: "application/json",
	"Content-Type": "application/json",
	Authorization: token ? `${AUTH}, Token="${token}"` : AUTH,
});
