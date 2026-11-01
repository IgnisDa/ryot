import { Schema } from "@ryot-app/plugin-kit/effect";

export const watchProviderOffers = ["stream", "free", "ads", "rent", "buy"] as const;

export type WatchProviderOffer = (typeof watchProviderOffers)[number];

const WatchProviderOfferSchema = Schema.Literals(watchProviderOffers);

const WatchProviderSchema = Schema.Struct({
	name: Schema.String,
	image: Schema.optionalKey(Schema.NullOr(Schema.String)),
	offers: Schema.optionalKey(Schema.NullOr(Schema.Array(WatchProviderOfferSchema))),
});

const WatchProviderCountrySchema = Schema.Struct({
	country: Schema.String,
	link: Schema.optionalKey(Schema.NullOr(Schema.String)),
	providers: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.NullOr(WatchProviderSchema)))),
});

export const WatchProviderListSchema = Schema.NullOr(
	Schema.Array(Schema.NullOr(WatchProviderCountrySchema)),
);

export type WatchProvider = Schema.Schema.Type<typeof WatchProviderSchema>;

export type WatchProviderList = Schema.Schema.Type<typeof WatchProviderListSchema>;
