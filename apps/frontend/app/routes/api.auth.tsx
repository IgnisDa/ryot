import { $path } from "@ignisda/remix-routes";
import { redirect, unstable_defineLoader } from "@remix-run/node";
import {
	CoreDetailsDocument,
	GetOidcTokenDocument,
	LoginUserDocument,
	RegisterUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { serialize } from "cookie";
import { z } from "zod";
import { zx } from "zodix";
import { AUTH_COOKIE_NAME } from "~/lib/generals";
import {
	combineHeaders,
	getCookiesForApplication,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({ code: z.string() });

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request }) => {
	const input = zx.parseQuery(request, searchParamsSchema);
	const { getOidcToken } = await serverGqlService.request(
		GetOidcTokenDocument,
		input,
	);
	const oidcInput = {
		email: getOidcToken.email,
		issuerId: getOidcToken.subject,
	};
	const [{ coreDetails }] = await Promise.all([
		serverGqlService.request(CoreDetailsDocument),
		serverGqlService.request(RegisterUserDocument, {
			input: { oidc: oidcInput },
		}),
	]);
	const { loginUser } = await serverGqlService.request(LoginUserDocument, {
		input: { oidc: oidcInput },
	});
	if (loginUser.__typename === "LoginResponse") {
		const cookies = await getCookiesForApplication(loginUser.apiKey);
		const options = { maxAge: coreDetails.tokenValidForDays * 24 * 60 * 60 };
		return redirect($path("/"), {
			headers: combineHeaders(
				{
					"set-cookie": serialize(AUTH_COOKIE_NAME, loginUser.apiKey, options),
				},
				cookies,
			),
		});
	}
	return Response.json({ input });
});
