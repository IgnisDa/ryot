import { expect } from "bun:test";

import PurchaseCompleteEmail from "@ryot-app/email-templates/emails/purchase-complete";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { webRequest } from "@ryot-app/testing/web-request";
import { Effect } from "effect";

import { signInThroughWebsite, startWebsite } from "../support/harness";
import { deliverPaddleEvent, deliverPolarEvent } from "../support/payments";
import { websiteTest } from "../support/test";

websiteTest((test) => {
	test.effect(
		"retries failed fulfillment and ignores purchase replay for Paddle and Polar",
		() =>
			Effect.gen(function* () {
				const website = yield* startWebsite();
				for (const deliver of [deliverPaddleEvent, deliverPolarEvent]) {
					const email = `${yield* randomUuid}@ryot.test`;
					const cookie = yield* signInThroughWebsite(website, email);
					const customerId = yield* website.customerIdFor(email);
					const delivery = {
						customerId,
						eventId: yield* randomUuid,
						providerCustomerId: yield* randomUuid,
					};
					const keyRequests = () =>
						website.unkey.requests.filter(({ path }) => path === "/v2/keys.createKey");
					const purchaseEmails = () =>
						website.inbox.messages.filter(
							(msg) =>
								msg.subject === PurchaseCompleteEmail.subject &&
								msg.text?.includes("Your Pro Key is"),
						);
					const initialKeys = keyRequests().length;
					const initialEmails = purchaseEmails().length;
					expect(
						(yield* deliver(website.origin, { ...delivery, invalidSignature: true })).status,
					).toBe(401);
					expect(keyRequests()).toHaveLength(initialKeys);

					const renewalDelivery = {
						...delivery,
						plan: "yearly" as const,
						eventId: yield* randomUuid,
					};
					website.inbox.rejectNextDelivery();
					expect((yield* deliver(website.origin, delivery)).status).toBe(503);
					expect(keyRequests()).toHaveLength(initialKeys + 1);
					expect(purchaseEmails()).toHaveLength(initialEmails);
					expect((yield* deliver(website.origin, renewalDelivery)).status).toBe(503);
					expect(keyRequests()).toHaveLength(initialKeys + 1);
					expect((yield* deliver(website.origin, delivery)).status).toBe(200);
					expect((yield* deliver(website.origin, delivery)).status).toBe(200);
					expect(keyRequests()).toHaveLength(initialKeys + 1);
					expect(purchaseEmails()).toHaveLength(initialEmails + 1);
					expect(yield* website.purchasesFor(customerId)).toMatchObject([
						{ planType: "monthly", productType: "self_hosted" },
					]);

					const page = yield* webRequest(new URL("/me", website.origin), {
						headers: { Cookie: cookie },
					});
					expect(yield* Effect.promise(() => page.text())).toContain("Self Hosted");

					const renewal = yield* deliver(website.origin, renewalDelivery);
					expect(renewal.status).toBe(200);
					expect(website.unkey.requests.at(-1)).toMatchObject({
						path: "/v2/keys.updateKey",
						body: { enabled: true, keyId: `key_${initialKeys + 1}` },
					});
					expect(keyRequests()).toHaveLength(initialKeys + 1);
					expect(purchaseEmails()).toHaveLength(initialEmails + 1);
					expect(yield* website.purchasesFor(customerId)).toMatchObject([
						{ planType: "yearly", productType: "self_hosted" },
					]);

					const cancelled = yield* deliver(website.origin, {
						...delivery,
						kind: "cancelled",
						eventId: yield* randomUuid,
					});
					expect(cancelled.status).toBe(200);
					expect(website.unkey.requests.at(-1)).toMatchObject({
						path: "/v2/keys.updateKey",
						body: { enabled: false, keyId: `key_${initialKeys + 1}` },
					});
					const afterCancellation = yield* webRequest(new URL("/me", website.origin), {
						headers: { Cookie: cookie },
					});
					expect(yield* Effect.promise(() => afterCancellation.text())).toContain(
						"Choose Your Perfect Plan",
					);
				}
			}),
		testTimeout,
	);
});
