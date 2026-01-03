import { getPrices, getServerVariables } from "~/lib/config.server";
import { getCustomerFromCookie } from "~/lib/utilities.server";
import type { Route } from "./+types/api.config";

export const loader = async ({ request }: Route.LoaderArgs) => {
	const serverVariables = getServerVariables();
	const customer = await getCustomerFromCookie(request);
	return {
		prices: getPrices(),
		isLoggedIn: !!customer,
		isSandbox: !!serverVariables.PADDLE_SANDBOX,
		clientToken: serverVariables.PADDLE_CLIENT_TOKEN,
		turnstileSiteKey: serverVariables.TURNSTILE_SITE_KEY,
	};
};
