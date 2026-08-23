import { Schema } from "@ryot-app/plugin-kit/effect";

export const watchProviderOffers = ["stream", "free", "ads", "rent", "buy"] as const;

export type WatchProviderOffer = (typeof watchProviderOffers)[number];

const WatchProviderOfferSchema = Schema.Literals(watchProviderOffers);

const WatchProviderSchema = Schema.Struct({
	name: Schema.String,
	image: Schema.NullOr(Schema.String),
	offers: Schema.Array(WatchProviderOfferSchema),
});

const WatchProviderCountrySchema = Schema.Struct({
	country: Schema.String,
	link: Schema.NullOr(Schema.String),
	providers: Schema.Array(WatchProviderSchema),
});

export const WatchProviderListSchema = Schema.NullOr(Schema.Array(WatchProviderCountrySchema));

export type WatchProvider = Schema.Schema.Type<typeof WatchProviderSchema>;
