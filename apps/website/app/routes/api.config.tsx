import { Effect } from "effect";

import { getCustomerFromCookie } from "~/features/account/session.server";
import type { ConfigData } from "~/lib/config";
import { getPrices, getServerVariables } from "~/server/config.server";
import { runPromise } from "~/server/runtime.server";

import type { Route } from "./+types/api.config";

export const loader = ({ request }: Route.LoaderArgs) =>
	runPromise(
		Effect.gen(function* () {
			const serverVariables = getServerVariables();
			const customer = yield* getCustomerFromCookie(request);
			return {
				isLoggedIn: !!customer,
				prices: getPrices(customer?.paymentProvider),
				turnstileSiteKey: serverVariables.TURNSTILE_SITE_KEY,
			} satisfies ConfigData;
		}),
	);
