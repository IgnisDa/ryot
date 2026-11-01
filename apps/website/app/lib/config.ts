import { z } from "zod";

const paymentPriceSchema = z.object({
	trial: z.number().optional(),
	amount: z.number().optional(),
	priceId: z.string().optional(),
	productId: z.string().optional(),
	linkToGithub: z.boolean().optional(),
	name: z.enum(["free", "monthly", "yearly", "lifetime"]),
});

export const configDataSchema = z.object({
	isSandbox: z.boolean(),
	clientToken: z.string(),
	isLoggedIn: z.boolean(),
	turnstileSiteKey: z.string(),
	prices: z.array(
		z.object({ prices: z.array(paymentPriceSchema), type: z.enum(["cloud", "self_hosted"]) }),
	),
});

export type ConfigData = z.infer<typeof configDataSchema>;
