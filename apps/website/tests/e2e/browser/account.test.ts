import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { Effect, Schema } from "effect";

import { fromPromise } from "../../../app/server/effect.server";
import { openWebsiteBrowser } from "../support/browser";
import { readLoginCode, signInThroughWebsite, startWebsite } from "../support/harness";
import { deliverPaddleEvent } from "../support/payments";
import { websiteTest } from "../support/test";

websiteTest((test) => {
	test.effect(
		"signs in with an emailed code and protects the account after sign-out",
		() =>
			Effect.gen(function* () {
				const website = yield* startWebsite();
				const page = yield* openWebsiteBrowser();
				const email = "login@ryot.test";

				yield* fromPromise(() => page.goto(`${website.origin}/me`));
				yield* fromPromise(() => page.waitForURL("**/#start-here"));
				const registration = page.locator("#start-here");
				yield* fromPromise(() => registration.getByPlaceholder("Enter your email").fill(email));
				yield* fromPromise(() =>
					registration.getByRole("button", { name: "Start Your Free Trial" }).click(),
				);
				const code = yield* readLoginCode(website.inbox, email);
				yield* fromPromise(() => registration.locator("input[name=otpCode]").fill(code));
				yield* fromPromise(() =>
					registration.getByRole("button", { name: "Verify login code" }).click(),
				);
				yield* fromPromise(() => page.waitForURL("**/me"));
				yield* fromPromise(() => page.getByRole("button", { name: "Sign out" }).click());
				yield* fromPromise(() => page.waitForURL("**/#start-here"));
				yield* fromPromise(() => page.goto(`${website.origin}/me`));
				yield* fromPromise(() => page.waitForURL("**/#start-here"));
			}),
		testTimeout,
	);

	test.effect(
		"hands the selected Self Hosted plan to checkout and shows the paid plan",
		() =>
			Effect.gen(function* () {
				const website = yield* startWebsite();
				const email = "purchase@ryot.test";
				const cookie = yield* signInThroughWebsite(website, email);
				const page = yield* openWebsiteBrowser();
				yield* fromPromise(() =>
					page
						.context()
						.addCookies([
							{
								name: "WebsiteAuth",
								url: website.origin,
								value: cookie.slice("WebsiteAuth=".length),
							},
						]),
				);
				yield* fromPromise(() => page.goto(`${website.origin}/me`));
				yield* fromPromise(() =>
					page.getByRole("button", { exact: true, name: "Self Hosted" }).click(),
				);
				yield* fromPromise(() => page.getByRole("button", { name: "Choose this" }).last().click());
				const checkoutData = yield* fromPromise(() =>
					page.locator("body[data-paddle-checkout]").getAttribute("data-paddle-checkout"),
				);
				const checkout = yield* Schema.decodeUnknownEffect(
					Schema.fromJsonString(
						Schema.Struct({
							customer: Schema.Struct({ email: Schema.String }),
							customData: Schema.Struct({ customerId: Schema.String }),
							items: Schema.Array(
								Schema.Struct({ priceId: Schema.String, quantity: Schema.Finite }),
							),
						}),
					),
				)(checkoutData);
				expect(checkout).toMatchObject({
					customer: { email },
					items: [{ quantity: 1, priceId: "pri_01kzgt9sztgq4jrd6sc408mbse" }],
				});
				const { customerId } = checkout.customData;
				const paid = yield* deliverPaddleEvent(website.origin, {
					customerId,
					plan: "lifetime",
					providerCustomerId: "purchase-paddle-customer",
				});
				expect(paid.status).toBe(200);
				yield* fromPromise(() => page.reload());
				yield* fromPromise(() => page.getByText("Lifetime", { exact: true }).waitFor());
				yield* fromPromise(() => page.getByText("key_1", { exact: true }).waitFor());
				return undefined;
			}),
		testTimeout,
	);
});
