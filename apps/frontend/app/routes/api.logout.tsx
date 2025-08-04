import { LogoutUserDocument } from "@ryot/generated/graphql/backend/graphql";
import { parseSearchQuery } from "@ryot/ts-utils";
import { redirect } from "react-router";
import { safeRedirect } from "remix-utils/safe-redirect";
import { $path } from "safe-routes";
import { z } from "zod";
import { redirectToQueryParam } from "~/lib/shared/constants";
import { getLogoutCookies, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/api.logout";

const searchParamsSchema = z.object({
	[redirectToQueryParam]: z.string().optional(),
});

export const loader = async ({ request }: Route.LoaderArgs) => {
	const query = parseSearchQuery(request, searchParamsSchema);
	await serverGqlService.authenticatedRequest(request, LogoutUserDocument);

	const redirectUrl = query[redirectToQueryParam]
		? safeRedirect(query[redirectToQueryParam])
		: $path("/auth");

	return redirect(redirectUrl, {
		headers: getLogoutCookies(),
	});
};
