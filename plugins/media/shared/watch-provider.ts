export const watchProviderOffers = ["stream", "free", "ads", "rent", "buy"] as const;

export type WatchProviderOffer = (typeof watchProviderOffers)[number];
