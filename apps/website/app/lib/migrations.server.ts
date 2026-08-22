import { and, eq, inArray, isNull } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Effect } from "effect";

import * as schema from "~/drizzle/schema.server";

import { getDb, getServerVariables } from "./config.server";
import { fromPromise, type WebsiteFailure } from "./effect.server";
import { getLegacyPaymentCatalog, getPaymentEnvironment } from "./payment-catalog";

const MIGRATIONS_FOLDER = "app/drizzle/migrations";

const backfillLegacyPurchaseProviderIdentity = Effect.fn("backfillLegacyPurchaseProviderIdentity")(
	function* () {
		const db = getDb();
		const serverVariables = getServerVariables();
		const environments = {
			polar: getPaymentEnvironment(serverVariables.POLAR_SANDBOX),
			paddle: getPaymentEnvironment(serverVariables.PADDLE_SANDBOX),
		};

		const backfillOperations: Array<Effect.Effect<unknown[], WebsiteFailure>> = [];
		for (const paymentProvider of schema.paymentProviders.enumValues) {
			const providerCustomerIds = db
				.select({ id: schema.customer.id })
				.from(schema.customer)
				.where(eq(schema.customer.paymentProvider, paymentProvider));
			const catalog = getLegacyPaymentCatalog(paymentProvider, environments[paymentProvider]);

			for (const product of catalog) {
				for (const price of product.prices) {
					if (!price.priceId) {
						continue;
					}
					if (paymentProvider === "polar" && !price.productId) {
						continue;
					}

					backfillOperations.push(
						fromPromise(() =>
							db
								.update(schema.customerPurchase)
								.set({
									paymentProvider,
									providerPriceId: price.priceId,
									providerProductId: price.productId ?? null,
								})
								.where(
									and(
										eq(schema.customerPurchase.planType, price.name),
										eq(schema.customerPurchase.productType, product.type),
										isNull(schema.customerPurchase.paymentProvider),
										inArray(schema.customerPurchase.customerId, providerCustomerIds),
									),
								)
								.returning({ id: schema.customerPurchase.id }),
						),
					);
				}
			}
		}

		const backfilled = yield* Effect.all(backfillOperations, { concurrency: "unbounded" });
		const backfilledPurchases = backfilled.reduce((total, rows) => total + rows.length, 0);
		if (backfilledPurchases > 0) {
			yield* Effect.log(`Backfilled provider identity for ${backfilledPurchases} purchases`);
		}
	},
);

export const runMigrations = Effect.fn("runMigrations")(function* () {
	yield* fromPromise(() => migrate(getDb(), { migrationsFolder: MIGRATIONS_FOLDER }));
	yield* backfillLegacyPurchaseProviderIdentity();
});
