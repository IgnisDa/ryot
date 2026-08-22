import { eq, type InferSelectModel } from "drizzle-orm";
import { Effect } from "effect";

import { customer } from "~/drizzle/schema.server";
import { getDb, paddleCustomDataSchema } from "~/lib/config.server";
import { fromPromise, type WebsiteFailure } from "~/lib/effect.server";

type Customer = InferSelectModel<typeof customer>;

export function findCustomerByField(
	field: keyof typeof customer.$inferSelect,
	value: string,
): Effect.Effect<Customer | undefined, WebsiteFailure> {
	return fromPromise(() => getDb().query.customer.findFirst({ where: eq(customer[field], value) }));
}

export function findCustomerByPolarId(polarCustomerId: string) {
	return findCustomerByField("polarCustomerId", polarCustomerId);
}

export function findCustomerByPaddleId(paddleCustomerId: string) {
	return findCustomerByField("paddleCustomerId", paddleCustomerId);
}

export function findCustomerById(customerId: string) {
	return findCustomerByField("id", customerId);
}

export function findCustomerByPaddleCustomData(customData: unknown) {
	const parsed = paddleCustomDataSchema.safeParse(customData);
	if (!parsed.success) {
		return Effect.as(Effect.void, undefined);
	}

	return findCustomerById(parsed.data.customerId);
}

export function findCustomerWithFallback(
	primaryId: string | undefined,
	primaryLookup: (id: string) => Effect.Effect<Customer | undefined, WebsiteFailure>,
	fallbackId: string | undefined,
	fallbackLookup?: (id: string) => Effect.Effect<Customer | undefined, WebsiteFailure>,
) {
	return Effect.gen(function* () {
		if (primaryId) {
			const primaryCustomer = yield* primaryLookup(primaryId);
			if (primaryCustomer) {
				return primaryCustomer;
			}
		}

		if (fallbackId && fallbackLookup) {
			return (yield* fallbackLookup(fallbackId)) ?? null;
		}

		return null;
	});
}
