import type { PurchaseCompleteEmailProps } from "@ryot-app/email-templates/emails/purchase-complete";
import { UserId } from "@ryot-app/instance-contract/user";
import type { Dayjs } from "dayjs";
import { Effect } from "effect";
import type { HttpClient } from "effect/http";

import type { customer } from "~/drizzle/schema.server";
import { getServerVariables, getUnkeyClient } from "~/server/config.server";
import { fromPromise, type WebsiteFailure } from "~/server/effect.server";
import { provisionUser, resetUserPassword, setUserDisabled } from "~/server/instance-admin.server";

import { formatDateToNaiveDate, gracePeriodDays } from "./renewal";

export type Customer = typeof customer.$inferSelect;

const expiry = (renewOn: null | Dayjs) =>
	renewOn ? { expiry: formatDateToNaiveDate(renewOn.add(gracePeriodDays, "days")) } : undefined;

export const updateKeyAccess = (keyId: string, enabled: boolean, renewOn?: null | Dayjs) =>
	fromPromise(() =>
		getUnkeyClient().keys.updateKey({
			keyId,
			enabled,
			...(renewOn === undefined ? {} : { meta: expiry(renewOn) ?? {} }),
		}),
	);

export const createUnkeyKey = (customer: Customer, renewOn: null | Dayjs) =>
	fromPromise(() =>
		getUnkeyClient().keys.createKey({
			name: customer.email,
			meta: expiry(renewOn),
			externalId: customer.id,
			apiId: getServerVariables().UNKEY_API_ID,
		}),
	).pipe(Effect.map((created) => created.data));

export const setPurchaseAccess = Effect.fn(function* (
	customer: Customer,
	enabled: boolean,
	renewOn?: null | Dayjs,
) {
	if (customer.ryotUserId) {
		yield* setUserDisabled(UserId.make(customer.ryotUserId), !enabled);
	}
	if (customer.unkeyKeyId) {
		yield* updateKeyAccess(customer.unkeyKeyId, enabled, renewOn);
	}
});

export const provisionCloudUser = Effect.fn(function* (customer: Customer) {
	if (customer.ryotUserId) {
		yield* setUserDisabled(UserId.make(customer.ryotUserId), false);
		return customer.ryotUserId;
	}
	const { email, oidcIssuerId } = customer;
	const { userId } = yield* provisionUser(
		oidcIssuerId
			? { email, name: email, oidcIssuerId, provider: "oidc" }
			: { email, name: email, provider: "credential" },
	);
	return userId;
});

export const cloudPurchaseNotice = (
	customer: Customer,
	userId: string,
): Effect.Effect<
	NonNullable<PurchaseCompleteEmailProps["details"]>,
	WebsiteFailure,
	HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		if (customer.oidcIssuerId) {
			return { kind: "cloud", auth: { provider: "google", email: customer.email } };
		}
		const reset = yield* resetUserPassword(UserId.make(userId));
		return {
			kind: "cloud",
			auth: { provider: "password", username: customer.email, passwordChangeUrl: reset.resetUrl },
		};
	});
