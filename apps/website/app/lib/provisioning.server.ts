import { UserId } from "@ryot-app/contract/schema/brands";
import PurchaseCompleteEmail, {
	type PurchaseCompleteEmailProps,
} from "@ryot-app/transactional/emails/purchase-complete";
import { and, eq, type InferSelectModel, isNull } from "drizzle-orm";
import { Effect } from "effect";
import type { HttpClient } from "effect/http";

import * as schema from "~/drizzle/schema.server";
import type { TPaymentProviders, TPlanTypes, TProductTypes } from "~/drizzle/schema.server";

import { provisionUser, resetUserPassword, setUserDisabled } from "./api.server";
import { GRACE_PERIOD, getDb, getUnkeyClient } from "./config.server";
import { fromPromise, type WebsiteFailure } from "./effect.server";
import {
	calculateRenewalDate,
	createUnkeyKey,
	formatDateToNaiveDate,
	sendEmail,
} from "./utilities.server";

type Customer = InferSelectModel<typeof schema.customer>;

export type PaymentProviderIdentity = {
	providerPriceId?: string;
	providerProductId?: string;
	paymentProvider: TPaymentProviders;
};

type CloudAuthDetails = Extract<
	NonNullable<PurchaseCompleteEmailProps["details"]>,
	{ kind: "cloud" }
>["auth"];

function getCloudAuthDetails(
	userId: string,
	email: string,
	oidcIssuerId: string | null,
): Effect.Effect<CloudAuthDetails, WebsiteFailure, HttpClient.HttpClient> {
	return Effect.gen(function* () {
		if (oidcIssuerId) {
			return { email, provider: "google" };
		}

		const reset = yield* resetUserPassword(UserId.make(userId));

		return { username: email, provider: "password", passwordChangeUrl: reset.resetUrl };
	});
}

function handleCloudPurchase(
	customer: Customer,
): Effect.Effect<
	{ ryotUserId: string; unkeyKeyId: null; details: PurchaseCompleteEmailProps["details"] },
	WebsiteFailure,
	HttpClient.HttpClient
> {
	return Effect.gen(function* () {
		const { email, oidcIssuerId } = customer;

		if (customer.ryotUserId) {
			yield* setUserDisabled(UserId.make(customer.ryotUserId), false);
			const auth = yield* getCloudAuthDetails(customer.ryotUserId, email, oidcIssuerId);
			return {
				unkeyKeyId: null,
				ryotUserId: customer.ryotUserId,
				details: { auth, kind: "cloud" },
			};
		}

		const provisioned = yield* provisionUser(
			oidcIssuerId
				? { email, name: email, oidcIssuerId, provider: "oidc" }
				: { email, name: email, provider: "credential" },
		);

		const auth = yield* getCloudAuthDetails(provisioned.userId, email, oidcIssuerId);

		return { unkeyKeyId: null, ryotUserId: provisioned.userId, details: { auth, kind: "cloud" } };
	});
}

function handleSelfHostedPurchase(
	customer: Customer,
	planType: TPlanTypes,
): Effect.Effect<
	{ ryotUserId: null; unkeyKeyId: string; details: PurchaseCompleteEmailProps["details"] },
	WebsiteFailure
> {
	return Effect.gen(function* () {
		const unkey = getUnkeyClient();
		const renewalDate = calculateRenewalDate(planType);

		if (customer.unkeyKeyId) {
			const keyId = customer.unkeyKeyId;
			yield* fromPromise(() =>
				unkey.keys.updateKey({
					keyId,
					enabled: true,
					meta: renewalDate
						? { expiry: formatDateToNaiveDate(renewalDate.add(GRACE_PERIOD, "days")) }
						: undefined,
				}),
			);
			return {
				ryotUserId: null,
				unkeyKeyId: customer.unkeyKeyId,
				details: { kind: "self_hosted", key: "API key reactivated with new expiry" },
			};
		}

		const created = yield* createUnkeyKey(
			customer,
			renewalDate ? renewalDate.add(GRACE_PERIOD, "days") : undefined,
		);
		return {
			ryotUserId: null,
			unkeyKeyId: created.keyId,
			details: { key: created.key, kind: "self_hosted" },
		};
	});
}

export function provisionNewPurchase(
	customer: Customer,
	planType: TPlanTypes,
	productType: TProductTypes,
	paymentProviderCustomerId: string,
	providerIdentity: PaymentProviderIdentity,
) {
	return Effect.gen(function* () {
		const { details, ryotUserId, unkeyKeyId } =
			productType === "cloud"
				? yield* handleCloudPurchase(customer)
				: yield* handleSelfHostedPurchase(customer, planType);

		const renewalDate = calculateRenewalDate(planType);
		const renewOn = renewalDate ? formatDateToNaiveDate(renewalDate) : undefined;

		const emailElement = PurchaseCompleteEmail({ renewOn, details, planType });
		if (!emailElement) {
			throw new Error("Failed to create email element");
		}

		yield* sendEmail({
			element: emailElement,
			recipient: customer.email,
			subject: PurchaseCompleteEmail.subject,
		});

		yield* fromPromise(() =>
			getDb()
				.insert(schema.customerPurchase)
				.values({
					planType,
					productType,
					customerId: customer.id,
					...providerIdentity,
					renewOn: renewalDate?.toDate(),
				}),
		);

		const updateData: {
			ryotUserId?: string | null;
			unkeyKeyId?: string | null;
			polarCustomerId?: string | null;
			paddleCustomerId?: string | null;
		} = {};

		if (ryotUserId && ryotUserId !== customer.ryotUserId) {
			updateData.ryotUserId = ryotUserId;
		}
		if (unkeyKeyId && unkeyKeyId !== customer.unkeyKeyId) {
			updateData.unkeyKeyId = unkeyKeyId;
		}

		if (customer.paymentProvider === "paddle" && paymentProviderCustomerId) {
			if (paymentProviderCustomerId !== customer.paddleCustomerId) {
				updateData.paddleCustomerId = paymentProviderCustomerId;
			}
		} else if (customer.paymentProvider === "polar" && paymentProviderCustomerId) {
			if (paymentProviderCustomerId !== customer.polarCustomerId) {
				updateData.polarCustomerId = paymentProviderCustomerId;
			}
		}

		if (Object.keys(updateData).length > 0) {
			yield* fromPromise(() =>
				getDb().update(schema.customer).set(updateData).where(eq(schema.customer.id, customer.id)),
			);
		}
	});
}

export function provisionRenewal(
	customer: Customer,
	planType: TPlanTypes,
	productType: TProductTypes,
	activePurchase: InferSelectModel<typeof schema.customerPurchase>,
	providerIdentity: PaymentProviderIdentity,
) {
	return Effect.gen(function* () {
		const renewalDate = calculateRenewalDate(planType);
		yield* fromPromise(() =>
			getDb()
				.update(schema.customerPurchase)
				.set({
					planType,
					productType,
					...providerIdentity,
					updatedOn: new Date(),
					renewOn: renewalDate?.toDate(),
				})
				.where(eq(schema.customerPurchase.id, activePurchase.id)),
		);

		if (customer.ryotUserId) {
			yield* setUserDisabled(UserId.make(customer.ryotUserId), false);
		}

		if (customer.unkeyKeyId) {
			const unkey = getUnkeyClient();
			const keyId = customer.unkeyKeyId;

			yield* fromPromise(() =>
				unkey.keys.updateKey({
					keyId,
					enabled: true,
					meta: renewalDate
						? { expiry: formatDateToNaiveDate(renewalDate.add(GRACE_PERIOD, "days")) }
						: undefined,
				}),
			);
		}
	});
}

export function revokePurchase(customer: Customer) {
	return Effect.gen(function* () {
		yield* fromPromise(() =>
			getDb()
				.update(schema.customerPurchase)
				.set({ updatedOn: new Date(), cancelledOn: new Date() })
				.where(
					and(
						eq(schema.customerPurchase.customerId, customer.id),
						isNull(schema.customerPurchase.cancelledOn),
					),
				),
		);

		if (customer.ryotUserId) {
			yield* setUserDisabled(UserId.make(customer.ryotUserId), true);
		}

		if (customer.unkeyKeyId) {
			const unkey = getUnkeyClient();
			const keyId = customer.unkeyKeyId;
			yield* fromPromise(() => unkey.keys.updateKey({ keyId, enabled: false }));
		}
	});
}

export function getActivePurchase(customerId: string) {
	return fromPromise(() =>
		getDb().query.customerPurchase.findFirst({
			where: and(
				eq(schema.customerPurchase.customerId, customerId),
				isNull(schema.customerPurchase.cancelledOn),
			),
		}),
	);
}

export function handlePurchaseOrRenewal(
	customer: Customer,
	planType: TPlanTypes,
	productType: TProductTypes,
	paymentProviderCustomerId: string,
	providerIdentity: PaymentProviderIdentity,
) {
	return Effect.gen(function* () {
		const activePurchase = yield* getActivePurchase(customer.id);

		if (!activePurchase) {
			yield* Effect.log("Customer purchased plan:", {
				planType,
				productType,
				providerIdentity,
				paymentProviderCustomerId,
			});
			yield* provisionNewPurchase(
				customer,
				planType,
				productType,
				paymentProviderCustomerId,
				providerIdentity,
			);
		} else {
			yield* Effect.log("Customer renewed plan:", {
				planType,
				productType,
				paymentProviderCustomerId,
			});
			yield* provisionRenewal(customer, planType, productType, activePurchase, providerIdentity);
		}
	});
}
