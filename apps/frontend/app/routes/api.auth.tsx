import { type LoaderFunctionArgs, redirect } from "@remix-run/node";
import {
	GetOidcTokenDocument,
	LoginUserDocument,
	RegisterErrorVariant,
	RegisterUserDocument,
	UserByOidcIssuerIdDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { parseSearchQuery } from "@ryot/ts-utils";
import { $path } from "remix-routes";
import { z } from "zod";
import {
	getCookiesForApplication,
	getCoreDetails,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({ code: z.string() });

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const input = parseSearchQuery(request, searchParamsSchema);
	const { getOidcToken } = await serverGqlService.request(
		GetOidcTokenDocument,
		input,
	);
	console.log("OIDC token response:", getOidcToken);
	const oidcInput = {
		email: getOidcToken.email,
		issuerId: getOidcToken.subject,
	};
	const { userByOidcIssuerId } = await serverGqlService.request(
		UserByOidcIssuerIdDocument,
		{ oidcIssuerId: oidcInput.issuerId },
	);
	if (!userByOidcIssuerId) {
		const { registerUser } = await serverGqlService.request(
			RegisterUserDocument,
			{ input: { data: { oidc: oidcInput } } },
		);
		if (
			registerUser.__typename === "RegisterError" &&
			registerUser.error === RegisterErrorVariant.Disabled
		)
			return redirectWithToast($path("/auth"), {
				message: "Registration is disabled",
				type: "error",
			});
	}
	await getCoreDetails();
	const { loginUser } = await serverGqlService.request(LoginUserDocument, {
		input: { oidc: oidcInput },
	});
	if (loginUser.__typename === "LoginResponse") {
		const headers = await getCookiesForApplication(loginUser.apiKey);
		return redirect($path("/"), { headers });
	}
	console.error("Login failed:", loginUser);
	return Response.json({ input });
};
