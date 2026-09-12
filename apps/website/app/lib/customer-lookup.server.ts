import { eq, type InferSelectModel } from "drizzle-orm";

import { customer } from "~/drizzle/schema.server";
import { getDb, paddleCustomDataSchema } from "~/lib/config.server";

type Customer = InferSelectModel<typeof customer>;

export async function findCustomerByField(
	field: keyof typeof customer.$inferSelect,
	value: string,
): Promise<Customer | undefined> {
	return await getDb().query.customer.findFirst({ where: eq(customer[field], value) });
}

export async function findCustomerByPolarId(polarCustomerId: string) {
	return findCustomerByField("polarCustomerId", polarCustomerId);
}

export async function findCustomerByPaddleId(paddleCustomerId: string) {
	return findCustomerByField("paddleCustomerId", paddleCustomerId);
}

export async function findCustomerById(customerId: string) {
	return findCustomerByField("id", customerId);
}

export async function findCustomerByPaddleCustomData(customData: unknown) {
	const parsed = paddleCustomDataSchema.safeParse(customData);
	if (!parsed.success) {
		return undefined;
	}

	return findCustomerById(parsed.data.customerId);
}

export async function findCustomerWithFallback(
	primaryId: string | undefined,
	primaryLookup: (id: string) => Promise<Customer | undefined>,
	fallbackId: string | undefined,
	fallbackLookup?: (id: string) => Promise<Customer | undefined>,
) {
	if (primaryId) {
		const primaryCustomer = await primaryLookup(primaryId);
		if (primaryCustomer) {
			return primaryCustomer;
		}
	}

	if (fallbackId && fallbackLookup) {
		return (await fallbackLookup(fallbackId)) ?? null;
	}

	return null;
}
