import { getActionIntent } from "@ryot/ts-utils";
import { data, redirect } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { queryClient, queryFactory } from "~/lib/shared/react-query";
import {
	colorSchemeCookie,
	getAuthorizationCookie,
} from "~/lib/utilities.server";
import type { Route } from "./+types/actions";

export const loader = async () => redirect($path("/"));

export const action = async ({ request }: Route.ActionArgs) => {
	const intent = getActionIntent(request);
	const headers = new Headers();
	await match(intent)
		.with("invalidateUserDetails", () => {
			const cookie = getAuthorizationCookie(request);
			queryClient.removeQueries({
				queryKey: queryFactory.miscellaneous.userDetails(cookie).queryKey,
			});
		})
		.with("toggleColorScheme", async () => {
			const currentColorScheme = await colorSchemeCookie.parse(
				request.headers.get("cookie") || "",
			);
			const newColorScheme = currentColorScheme === "dark" ? "light" : "dark";
			headers.append(
				"set-cookie",
				await colorSchemeCookie.serialize(newColorScheme),
			);
		})
		.run();
	return data({}, { headers });
};
