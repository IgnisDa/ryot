import { and, eq, inArray, isNull } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "~/drizzle/schema.server";
import { getDb, getServerVariables } from "./config.server";
import {
	getLegacyPaymentCatalog,
	getPaymentEnvironment,
} from "./payment-catalog";

const MIGRATIONS_FOLDER = "app/drizzle/migrations";

const backfillLegacyPurchaseProviderIdentity = async () => {
	const db = getDb();
	const serverVariables = getServerVariables();
	const environments = {
		polar: getPaymentEnvironment(serverVariables.POLAR_SANDBOX),
		paddle: getPaymentEnvironment(serverVariables.PADDLE_SANDBOX),
	};

	let backfilledPurchases = 0;
	for (const paymentProvider of schema.paymentProviders.enumValues) {
		const providerCustomerIds = db
			.select({ id: schema.customers.id })
			.from(schema.customers)
			.where(eq(schema.customers.paymentProvider, paymentProvider));
		const catalog = getLegacyPaymentCatalog(
			paymentProvider,
			environments[paymentProvider],
		);

		for (const product of catalog)
			for (const price of product.prices) {
				if (!price.priceId) continue;
				if (paymentProvider === "polar" && !price.productId) continue;

				const backfilled = await db
					.update(schema.customerPurchases)
					.set({
						paymentProvider,
						providerPriceId: price.priceId,
						providerProductId: price.productId ?? null,
					})
					.where(
						and(
							eq(schema.customerPurchases.planType, price.name),
							eq(schema.customerPurchases.productType, product.type),
							isNull(schema.customerPurchases.paymentProvider),
							inArray(schema.customerPurchases.customerId, providerCustomerIds),
						),
					)
					.returning({ id: schema.customerPurchases.id });
				backfilledPurchases += backfilled.length;
			}
	}

	if (backfilledPurchases > 0)
		console.log(
			`Backfilled provider identity for ${backfilledPurchases} purchases`,
		);
};

export const runMigrations = async () => {
	await migrate(getDb(), { migrationsFolder: MIGRATIONS_FOLDER });
	await backfillLegacyPurchaseProviderIdentity();
};
