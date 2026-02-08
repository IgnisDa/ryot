import { eq, type InferSelectModel } from "drizzle-orm";
import { customers } from "~/drizzle/schema.server";
import { getDb, paddleCustomDataSchema } from "~/lib/config.server";

type Customer = InferSelectModel<typeof customers>;

export async function findCustomerByField(
	field: keyof typeof customers.$inferSelect,
	value: string,
): Promise<Customer | undefined> {
	return await getDb().query.customers.findFirst({
		where: eq(customers[field], value),
	});
}

export async function findCustomerByPolarId(
	polarCustomerId: string,
): Promise<Customer | undefined> {
	return findCustomerByField("polarCustomerId", polarCustomerId);
}

export async function findCustomerByPaddleId(
	paddleCustomerId: string,
): Promise<Customer | undefined> {
	return findCustomerByField("paddleCustomerId", paddleCustomerId);
}

export async function findCustomerById(
	customerId: string,
): Promise<Customer | undefined> {
	return findCustomerByField("id", customerId);
}

export async function findCustomerByPaddleCustomData(
	customData: unknown,
): Promise<Customer | undefined> {
	const parsed = paddleCustomDataSchema.safeParse(customData);
	if (!parsed.success) return undefined;

	return findCustomerById(parsed.data.customerId);
}

export async function findCustomerWithFallback(
	primaryId: string | undefined,
	primaryLookup: (id: string) => Promise<Customer | undefined>,
	fallbackId: string | undefined,
	fallbackLookup?: (id: string) => Promise<Customer | undefined>,
): Promise<Customer | null> {
	if (primaryId) {
		const customer = await primaryLookup(primaryId);
		if (customer) return customer;
	}

	if (fallbackId && fallbackLookup)
		return (await fallbackLookup(fallbackId)) ?? null;

	return null;
}
