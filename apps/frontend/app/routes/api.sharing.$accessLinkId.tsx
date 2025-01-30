import {
	ProcessAccessLinkDocument,
	type ProcessAccessLinkInput,
} from "@ryot/generated/graphql/backend/graphql";
import {
	parseParameters,
	parseSearchQuery,
	zodBoolAsString,
} from "@ryot/ts-utils";
import { type LoaderFunctionArgs, redirect } from "react-router";
import { $path } from "remix-routes";
import { safeRedirect } from "remix-utils/safe-redirect";
import { z } from "zod";
import { redirectToQueryParam } from "~/lib/generals";
import {
	createToastHeaders,
	getCookiesForApplication,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	isAccountDefault: zodBoolAsString.optional(),
	[redirectToQueryParam]: z.string().optional(),
});

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const routeParams = parseParameters(
		params,
		z.object({ accessLinkId: z.string() }),
	);
	const query = parseSearchQuery(request, searchParamsSchema);
	const input: ProcessAccessLinkInput = {};
	if (query.isAccountDefault) input.username = routeParams.accessLinkId;
	else input.id = routeParams.accessLinkId;
	const { processAccessLink } = await serverGqlService.request(
		ProcessAccessLinkDocument,
		{ input },
	);
	if (processAccessLink.__typename === "ProcessAccessLinkResponse") {
		const headers = await getCookiesForApplication(
			processAccessLink.apiKey,
			processAccessLink.tokenValidForDays,
		);
		return redirect(
			safeRedirect(
				query[redirectToQueryParam] ||
					processAccessLink.redirectTo ||
					$path("/"),
			),
			{ headers },
		);
	}
	return redirect($path("/auth"), {
		headers: await createToastHeaders({
			type: "error",
			title: "Error processing access link",
			message: `Encountered: ${processAccessLink.error}`,
		}),
	});
};
