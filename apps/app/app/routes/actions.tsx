import { ActionFunctionArgs, redirect } from "@remix-run/node";
import { namedAction } from "remix-utils/named-action";
import { APP_ROUTES } from "~/lib/constants";
import { authCookie, colorSchemeCookie } from "~/lib/cookies.server";

export const loader = () => redirect(APP_ROUTES.dashboard);

export const action = async ({ request }: ActionFunctionArgs) => {
	return namedAction(request, {
		toggleColorScheme: async () => {
			const currentColorScheme = await colorSchemeCookie.parse(
				request.headers.get("Cookie") || "",
			);
			const newColorScheme = currentColorScheme === "light" ? "dark" : "light";
			return redirect(APP_ROUTES.dashboard, {
				headers: {
					"Set-Cookie": await colorSchemeCookie.serialize(newColorScheme),
				},
			});
		},
		logout: async () => {
			return redirect(APP_ROUTES.auth.login, {
				headers: {
					"Set-Cookie": await authCookie.serialize("", {
						expires: new Date(0),
					}),
				},
			});
		},
	});
};
