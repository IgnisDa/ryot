import { prices, serverVariables } from "~/lib/config.server";

export const headers = () => ({
	"Cache-Control":
		"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
});

export const loader = async () => {
	return {
		prices,
		isSandbox: !!serverVariables.PADDLE_SANDBOX,
		clientToken: serverVariables.PADDLE_CLIENT_TOKEN,
		turnstileSiteKey: serverVariables.TURNSTILE_SITE_KEY,
	};
};
