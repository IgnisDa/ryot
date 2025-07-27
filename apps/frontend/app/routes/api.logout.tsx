import { LogoutUserDocument } from "@ryot/generated/graphql/backend/graphql";
import { redirect } from "react-router";
import { $path } from "safe-routes";
import { getLogoutCookies, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/api.logout";

export const loader = async ({ request }: Route.LoaderArgs) => {
	await serverGqlService.authenticatedRequest(request, LogoutUserDocument);
	return redirect($path("/auth"), {
		headers: getLogoutCookies(),
	});
};
