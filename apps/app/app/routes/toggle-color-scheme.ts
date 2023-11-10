import { ActionFunctionArgs, redirect } from "@remix-run/node";
import { APP_ROUTES } from "~/lib/constants";
import { colorSchemeCookie } from "~/lib/cookies.server";

export const loader = () => redirect(APP_ROUTES.dashboard);

export const action = async ({ request }: ActionFunctionArgs) => {
	const currentColorScheme = await colorSchemeCookie.parse(
		request.headers.get("Cookie") || "",
	);
	const newColorScheme = currentColorScheme === "light" ? "dark" : "light";
	return redirect(APP_ROUTES.dashboard, {
		headers: {
			"Set-Cookie": await colorSchemeCookie.serialize(newColorScheme),
		},
	});
};
