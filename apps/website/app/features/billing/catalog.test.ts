import { expect, test } from "bun:test";

import { findPaymentPlan, getActivePaymentCatalog } from "./catalog";
import { calculateRenewalDate, formatDateToNaiveDate } from "./renewal";

test("resolves legacy prices when fulfilling renewals while only active prices appear in checkout", () => {
	const legacyPrice = "pri_01j3jhddt6kejw8b03qb0480n6";
	expect(
		findPaymentPlan("paddle", "production", (_, price) => price.priceId === legacyPrice),
	).toMatchObject({ planType: "monthly", productType: "cloud" });
	expect(
		getActivePaymentCatalog("paddle", "production").flatMap((product) =>
			product.prices.map((price) => price.priceId),
		),
	).not.toContain(legacyPrice);
});

test("calculates monthly and yearly renewal dates at month boundaries", () => {
	const purchase = new Date(2028, 0, 31, 12);
	const monthly = calculateRenewalDate("monthly", purchase);
	const yearly = calculateRenewalDate("yearly", purchase);
	expect(monthly && formatDateToNaiveDate(monthly)).toBe("2028-02-29");
	expect(yearly && formatDateToNaiveDate(yearly)).toBe("2029-01-31");
	expect(calculateRenewalDate("lifetime", purchase)).toBeNull();
	expect(calculateRenewalDate("free", purchase)).toBeNull();
});
