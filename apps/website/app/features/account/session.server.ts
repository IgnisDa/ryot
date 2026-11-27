import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { createCookie, redirect, redirectDocument } from "react-router";
import { $path } from "safe-routes";
import { z } from "zod";

import { customer, customerPurchase } from "~/drizzle/schema.server";
import { formatDateToNaiveDate } from "~/features/billing/renewal";
import { startUrl } from "~/lib/general";
import { assignPaymentProvider, getDb, getServerVariables } from "~/server/config.server";
import { fromPromise, WebsiteFailure } from "~/server/effect.server";

const sessionCookie = () =>
	createCookie("WebsiteAuth", {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		maxAge: 60 * 60 * 24 * 365,
		secure: new URL(getServerVariables().FRONTEND_URL).protocol === "https:",
		secrets: [sha256Hex("ryot-website-session\0" + getServerVariables().SERVER_ADMIN_ACCESS_TOKEN)],
	});

export const signInCustomer = Effect.fn(function* (email: string, oidcIssuerId?: string) {
	const db = getDb();
	const created = (yield* fromPromise(() =>
		db
			.insert(customer)
			.values({ email, oidcIssuerId, paymentProvider: assignPaymentProvider(email) })
			.onConflictDoNothing()
			.returning({ id: customer.id }),
	)).at(0);
	const account =
		created ??
		(yield* fromPromise(() => db.query.customer.findFirst({ where: eq(customer.email, email) }))) ??
		(oidcIssuerId &&
			(yield* fromPromise(() =>
				db.query.customer.findFirst({ where: eq(customer.oidcIssuerId, oidcIssuerId) }),
			)));
	if (!account) {
		return yield* new WebsiteFailure({ cause: "Customer registration failed" });
	}
	const cookie = yield* fromPromise(() => sessionCookie().serialize(account.id));
	return redirect($path("/me"), { headers: { "Set-Cookie": cookie } });
});

export const signOutCustomer = Effect.fn(function* () {
	const cookie = yield* fromPromise(() =>
		sessionCookie().serialize("", { maxAge: 0, expires: new Date(0) }),
	);
	return redirectDocument(startUrl, { headers: { "Set-Cookie": cookie } });
});

export const getCustomerFromCookie = Effect.fn(function* (request: Request) {
	const cookie = yield* fromPromise((): Promise<unknown> =>
		sessionCookie().parse(request.headers.get("cookie")),
	);
	const customerId = z.uuid().safeParse(cookie);
	if (!customerId.success) {
		return null;
	}
	return yield* fromPromise(() =>
		getDb().query.customer.findFirst({ where: eq(customer.id, customerId.data) }),
	);
});

export const getCustomerWithActivePurchase = Effect.fn(function* (request: Request) {
	const account = yield* getCustomerFromCookie(request);
	if (!account) {
		return null;
	}
	const active = yield* fromPromise(() =>
		getDb().query.customerPurchase.findFirst({
			orderBy: [desc(customerPurchase.createdOn)],
			where: and(eq(customerPurchase.customerId, account.id), isNull(customerPurchase.cancelledOn)),
		}),
	);
	return {
		...account,
		planType: active?.planType ?? null,
		productType: active?.productType ?? null,
		ryotUserId: active?.productType === "cloud" ? account.ryotUserId : null,
		renewOn: active?.renewOn ? formatDateToNaiveDate(active.renewOn) : null,
		unkeyKeyId: active?.productType === "self_hosted" ? account.unkeyKeyId : null,
	};
});
