import { redirect, unstable_defineLoader } from "@remix-run/node";
import { $path } from "remix-routes";
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
	if (!claims.email || !claims.sub) throw new Error("Invalid claims");
	const dbCustomer = await db
		.insert(customers)
		.values({ email: claims.email, oidcIssuerId: claims.sub })
		.returning({ id: customers.id })
		.onConflictDoUpdate({
			target: customers.oidcIssuerId,
			set: { oidcIssuerId: claims.sub },
		});
	const customerId = dbCustomer.at(0)?.id;
	if (!customerId) throw new Error("There was an error registering the user.");
	return redirect($path("/me"), {
		headers: { "set-cookie": await authCookie.serialize(customerId) },
	});
});
