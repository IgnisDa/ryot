import { DeleteS3ObjectDocument } from "@ryot/generated/graphql/backend/graphql";
import { getActionIntent } from "@ryot/ts-utils";
import { data, redirect } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { queryClient, queryFactory } from "~/lib/shared/react-query";
import { colorSchemeCookie, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/actions";

export const loader = async () => redirect($path("/"));

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	let returnData = {};
	const headers = new Headers();
	await match(intent)
		.with("invalidateUserDetails", () => {
			queryClient.removeQueries({
				queryKey: queryFactory.miscellaneous.userDetails().queryKey,
			});
		})
		.with("deleteS3Asset", async () => {
			const key = formData.get("key") as string;
			const { deleteS3Object } = await serverGqlService.authenticatedRequest(
				request,
				DeleteS3ObjectDocument,
				{ key },
			);
			returnData = { success: deleteS3Object };
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
	return data(returnData, { headers });
};
