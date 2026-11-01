import { eq } from "drizzle-orm";
import { Effect } from "effect";
import * as openidClient from "openid-client";
import { redirect } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";

import { customer } from "~/drizzle/schema.server";
import {
	assignPaymentProvider,
	getDb,
	getOauthCallbackUrl,
	websiteAuthCookie,
} from "~/lib/config.server";
import { fromPromise } from "~/lib/effect.server";
import { runPromise } from "~/lib/runtime.server";
import { oauthConfig } from "~/lib/utilities.server";

import type { Route } from "./+types/callback";

export const loader = ({ request }: Route.LoaderArgs) =>
	runPromise(
		Effect.gen(function* () {
			const config = yield* oauthConfig;
			const requestUrl = new URL(request.url);
			const callbackUrl = new URL(getOauthCallbackUrl());
			callbackUrl.search = requestUrl.search;
			const tokenSet = yield* fromPromise(() =>
				openidClient.authorizationCodeGrant(config, callbackUrl),
			);
			const claims = tokenSet.claims();
			if (!claims) {
				throw new Error("No claims found in token set");
			}
			const email = typeof claims.email === "string" ? claims.email : undefined;
			if (!email || !claims.sub) {
				throw new Error("Invalid claims");
			}
			const alreadyCustomer = yield* fromPromise(() =>
				getDb().query.customer.findFirst({ where: eq(customer.email, email) }),
			);
			const customerId = yield* match(alreadyCustomer)
				.with(undefined, () =>
					Effect.gen(function* () {
						const paymentProvider = assignPaymentProvider(email);
						const dbCustomer = yield* fromPromise(() =>
							getDb()
								.insert(customer)
								.values({ email, paymentProvider, oidcIssuerId: claims.sub })
								.returning({ id: customer.id })
								.onConflictDoUpdate({
									target: customer.oidcIssuerId,
									set: { oidcIssuerId: claims.sub },
								}),
						);
						return dbCustomer.at(0)?.id;
					}),
				)
				.otherwise((value) => Effect.succeed(value.id));
			if (!customerId) {
				throw new Error("There was an error registering the user.");
			}
			yield* Effect.log("Customer login successful:", { customerId });
			return redirect($path("/me"), {
				headers: {
					"set-cookie": yield* fromPromise(() => websiteAuthCookie.serialize(customerId)),
				},
			});
		}),
	);
