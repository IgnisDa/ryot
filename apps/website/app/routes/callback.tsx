import { eq } from "drizzle-orm";
import { redirect } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { customers } from "~/drizzle/schema.server";
import {
	OAUTH_CALLBACK_URL,
	db,
	oauthClient,
	websiteAuthCookie,
} from "~/lib/config.server";
import type { Route } from "./+types/callback";

export const loader = async ({ request }: Route.LoaderArgs) => {
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
	console.log("Customer login successful:", { customerId });
	return redirect($path("/me"), {
		headers: { "set-cookie": await websiteAuthCookie.serialize(customerId) },
	});
};
