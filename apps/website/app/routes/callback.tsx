import { redirect, unstable_defineLoader } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { $path } from "remix-routes";
import { match } from "ts-pattern";
import { customers } from "~/drizzle/schema.server";
import {
	OAUTH_CALLBACK_URL,
	authCookie,
	db,
	oauthClient,
} from "~/lib/config.server";

export const loader = unstable_defineLoader(async ({ request }) => {
	const client = await oauthClient();
	const params = client.callbackParams(request.url);
	const tokenSet = await client.callback(OAUTH_CALLBACK_URL, params, {
		state: params.state,
	});
	const claims = tokenSet.claims();
	const email = claims.email;
	if (!email || !claims.sub) throw new Error("Invalid claims");
	const alreadyCustomer = await db.query.customers.findFirst({
		where: eq(customers.email, email),
	});
	const customerId = await match(alreadyCustomer)
		.with(undefined, async () => {
			const dbCustomer = await db
				.insert(customers)
				.values({ email, oidcIssuerId: claims.sub })
				.returning({ id: customers.id })
				.onConflictDoUpdate({
					target: customers.oidcIssuerId,
					set: { oidcIssuerId: claims.sub },
				});
			return dbCustomer.at(0)?.id;
		})
		.otherwise((value) => value.id);
	if (!customerId) throw new Error("There was an error registering the user.");
	return redirect($path("/me"), {
		headers: { "set-cookie": await authCookie.serialize(customerId) },
	});
});
