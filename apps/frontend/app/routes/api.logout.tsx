import { redirect } from "react-router";
import { $path } from "safe-routes";
import { getLogoutCookies } from "~/lib/utilities.server";

export const loader = async () => {
	return redirect($path("/auth"), {
		headers: getLogoutCookies(),
	});
};
