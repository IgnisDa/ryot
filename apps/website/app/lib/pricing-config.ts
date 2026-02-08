import type { TPlanTypes, TProductTypes } from "~/drizzle/schema.server";

export type PricingMetadata = {
	trial?: number;
	amount?: number;
	linkToGithub?: boolean;
};

export const PRICING_METADATA: Record<
	TProductTypes,
	Record<TPlanTypes, PricingMetadata>
> = {
	cloud: {
		free: {},
		monthly: { amount: 3, trial: 7 },
		yearly: { amount: 30, trial: 14 },
		lifetime: { amount: 90 },
	},
	self_hosted: {
		free: { linkToGithub: true },
		monthly: { amount: 2 },
		yearly: { amount: 20 },
		lifetime: { amount: 60 },
	},
};
