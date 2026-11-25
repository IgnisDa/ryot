import { randomUuid } from "@ryot-app/testing/random";
import { signInThroughWebsite, startWebsite } from "@ryot-app/website/test-harness";
import { deliverPaddleEvent } from "@ryot-app/website/test-payments";
import { Effect } from "effect";

import { createTestAuthClient, signInWithPassword } from "~/fixtures/kernel/auth";
import { assert, expect, it } from "~/support/effect-test";
import { getAdminAccessToken, getFrontendUrl } from "~/support/harness-target";

it.live("provisions a Cloud purchase and lets the customer sign into the instance", () =>
	Effect.gen(function* () {
		const website = yield* startWebsite({
			instance: { origin: getFrontendUrl(), adminToken: getAdminAccessToken() },
		});
		const email = `cloud-purchase-${yield* randomUuid}@ryot.test`;
		yield* signInThroughWebsite(website, email);
		const delivery = {
			product: "cloud" as const,
			eventId: yield* randomUuid,
			providerCustomerId: yield* randomUuid,
			customerId: yield* website.customerIdFor(email),
		};
		website.inbox.rejectNextDelivery();
		expect((yield* deliverPaddleEvent(website.origin, delivery)).status).toBe(503);
		expect((yield* deliverPaddleEvent(website.origin, delivery)).status).toBe(200);
		expect((yield* deliverPaddleEvent(website.origin, delivery)).status).toBe(200);
		const message = yield* website.inbox.findMessage(email, "Thank you for buying Ryot!");
		const resetUrl = message.text?.match(/https?:[^\s)]+\/reset-password\?token=[^\s)]+/)?.[0];
		assert(resetUrl, "Expected an instance password reset link in the purchase email");
		const token = new URL(resetUrl).searchParams.get("token");
		assert(token, "Expected a reset token");
		const password = "cloud-purchase-password-123!";
		const { error } = yield* Effect.promise(() =>
			createTestAuthClient().resetPassword({ token, newPassword: password }),
		);
		expect(error).toBeNull();
		const signIn = yield* signInWithPassword(email, password);
		expect(signIn.error).toBeNull();
		assert(signIn.token, "Expected an authenticated instance session");
	}),
);
