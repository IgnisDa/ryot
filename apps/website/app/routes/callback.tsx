import { eq } from "drizzle-orm";
import * as openidClient from "openid-client";
import { redirect } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { customers } from "~/drizzle/schema.server";
import {
	assignPaymentProvider,
	getDb,
	getOauthCallbackUrl,
	websiteAuthCookie,
} from "~/lib/config.server";
import { oauthConfig } from "~/lib/utilities.server";
import type { Route } from "./+types/callback";

export const loader = async ({ request }: Route.LoaderArgs) => {
	const config = await oauthConfig();
	const requestUrl = new URL(request.url);
	const callbackUrl = new URL(getOauthCallbackUrl());
	callbackUrl.search = requestUrl.search;
	const tokenSet = await openidClient.authorizationCodeGrant(
		config,
		callbackUrl,
	);
	const claims = tokenSet.claims();
	if (!claims) throw new Error("No claims found in token set");
	const email = claims.email?.toString();
	if (!email || !claims.sub) throw new Error("Invalid claims");
	const alreadyCustomer = await getDb().query.customers.findFirst({
		where: eq(customers.email, email),
	});
	const customerId = await match(alreadyCustomer)
		.with(undefined, async () => {
			const paymentProvider = assignPaymentProvider(email);
			const dbCustomer = await getDb()
				.insert(customers)
				.values({ email, paymentProvider, oidcIssuerId: claims.sub })
				.returning({ id: customers.id })
				.onConflictDoUpdate({
					target: customers.oidcIssuerId,
					set: { oidcIssuerId: claims.sub },
				});
			return dbCustomer.at(0)?.id;
		})
		.otherwise((value) => value.id);
	if (!customerId) throw new Error("There was an error registering the user.");
	console.log("Customer login successful:", { customerId });
	return redirect($path("/me"), {
		headers: { "set-cookie": await websiteAuthCookie.serialize(customerId) },
	});
};
