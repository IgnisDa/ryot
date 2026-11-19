import { Effect } from "effect";

import type { ConfigData } from "~/lib/config";
import { getPrices, getServerVariables } from "~/lib/config.server";
import { runPromise } from "~/lib/runtime.server";
import { getCustomerFromCookie } from "~/lib/utilities.server";

import type { Route } from "./+types/api.config";

export const loader = ({ request }: Route.LoaderArgs) =>
	runPromise(
		Effect.gen(function* () {
			const serverVariables = getServerVariables();
			const customer = yield* getCustomerFromCookie(request);
			return {
				prices: getPrices(),
				isLoggedIn: !!customer,
				isSandbox: !!serverVariables.PADDLE_SANDBOX,
				clientToken: serverVariables.PADDLE_CLIENT_TOKEN,
				turnstileSiteKey: serverVariables.TURNSTILE_SITE_KEY,
			} satisfies ConfigData;
		}),
	);
