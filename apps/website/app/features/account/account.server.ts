import PurchaseCompleteEmail from "@ryot-app/email-templates/emails/purchase-complete";
import { UserId } from "@ryot-app/instance-contract/user";
import dayjs from "dayjs";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { data, redirect } from "react-router";
import { match } from "ts-pattern";

import * as schema from "~/drizzle/schema.server";
import {
	getCancellation,
	getPurchaseInProgress,
	setPurchaseInProgress,
} from "~/features/billing/checkout-status.server";
import { beginPolarCheckout, cancelSubscription } from "~/features/billing/checkout.server";
import { createUnkeyKey, updateKeyAccess } from "~/features/billing/provisioning.server";
import { startUrl } from "~/lib/general";
import { getDb, getPrices, getServerVariables } from "~/server/config.server";
import { fromPromise } from "~/server/effect.server";
import { getActionIntent } from "~/server/forms.server";
import { resetUserPassword } from "~/server/instance-admin.server";
import { sendEmail } from "~/server/mail.server";

import { getCustomerWithActivePurchase, signOutCustomer } from "./session.server";

export const loadAccount = (request: Request) =>
	Effect.gen(function* () {
		const customerDetails = yield* getCustomerWithActivePurchase(request);
		if (!customerDetails) {
			return redirect(startUrl);
		}

		const serverVariables = getServerVariables();
		const isCancelling = getCancellation(customerDetails.id);
		const isPurchaseInProgress = getPurchaseInProgress(customerDetails.id);
		return {
			isCancelling,
			customerDetails,
			isPurchaseInProgress,
			renewOn: customerDetails.renewOn,
			isSandbox: !!serverVariables.PADDLE_SANDBOX,
			clientToken: serverVariables.PADDLE_CLIENT_TOKEN,
			paymentProvider: customerDetails.paymentProvider,
			prices: getPrices(customerDetails.paymentProvider),
		};
	});

export const updateAccount = (request: Request) =>
	Effect.gen(function* () {
		const intent = getActionIntent(request);
		const customer = yield* getCustomerWithActivePurchase(request);
		return yield* match(intent)
			.with("regenerateUnkeyKey", () =>
				Effect.gen(function* () {
					if (!customer?.planType) {
						throw new Error("No customer found");
					}
					if (!customer.unkeyKeyId) {
						throw new Error("No unkey key found");
					}
					const keyId = customer.unkeyKeyId;

					yield* updateKeyAccess(keyId, false);
					const renewOnDayjs = customer.renewOn ? dayjs(customer.renewOn) : undefined;
					const created = yield* createUnkeyKey(customer, renewOnDayjs ?? null);
					yield* fromPromise(() =>
						getDb()
							.update(schema.customer)
							.set({ unkeyKeyId: created.keyId })
							.where(eq(schema.customer.id, customer.id)),
					);
					const emailElement = PurchaseCompleteEmail({
						planType: customer.planType,
						renewOn: customer.renewOn ?? undefined,
						details: { key: created.key, kind: "self_hosted" },
					});
					if (!emailElement) {
						throw new Error("Failed to create email element");
					}
					yield* sendEmail({
						element: emailElement,
						recipient: customer.email,
						subject: PurchaseCompleteEmail.subject,
					});
					return data({});
				}),
			)
			.with("cancelSubscription", () =>
				customer
					? cancelSubscription(customer).pipe(Effect.as(data({ success: true })))
					: Effect.succeed(new Response(null, { status: 401 })),
			)
			.with("checkoutPolar", () =>
				customer
					? beginPolarCheckout(customer, request)
					: Effect.succeed(new Response(null, { status: 401 })),
			)
			.with("checkoutPaddle", () =>
				Effect.sync(() => {
					if (!customer) {
						throw new Error("No customer found");
					}
					setPurchaseInProgress(customer.id);
					return data({});
				}),
			)
			.with("generateResetLink", () =>
				Effect.gen(function* () {
					if (!customer?.ryotUserId) {
						return data({ error: "No associated app user found" });
					}
					if (customer.oidcIssuerId) {
						return data({ error: "Password reset is not available for OIDC accounts" });
					}

					return yield* resetUserPassword(UserId.make(customer.ryotUserId)).pipe(
						Effect.map((reset) => data({ email: reset.email, resetUrl: reset.resetUrl })),
						Effect.catchCause(() =>
							Effect.succeed(data({ error: "Failed to reach the backend server" })),
						),
					);
				}),
			)
			.with("logout", signOutCustomer)
			.otherwise(() => Effect.succeed(new Response(null, { status: 400 })));
	});
