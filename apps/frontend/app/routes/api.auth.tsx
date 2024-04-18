import { $path } from "@ignisda/remix-routes";
import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	json,
	redirect,
} from "@remix-run/node";
import {
	CoreDetailsDocument,
	GetOidcRedirectUrlDocument,
	GetOidcTokenDocument,
	LoginUserDocument,
	RegisterUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { z } from "zod";
import { zx } from "zodix";
import {
	authCookie,
	combineHeaders,
	getCookiesForApplication,
	gqlClient,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({ code: z.string() });

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const input = zx.parseQuery(request, searchParamsSchema);
	const { getOidcToken } = await gqlClient.request(GetOidcTokenDocument, input);
	const oidcInput = {
		email: getOidcToken.email,
		issuerId: getOidcToken.subject,
	};
	const [{ coreDetails }] = await Promise.all([
		gqlClient.request(CoreDetailsDocument),
		gqlClient.request(RegisterUserDocument, { input: { oidc: oidcInput } }),
	]);
	const { loginUser } = await gqlClient.request(LoginUserDocument, {
		input: { oidc: oidcInput },
	});
	if (loginUser.__typename === "LoginResponse") {
		const cookies = await getCookiesForApplication(loginUser.apiKey);
		const options = { maxAge: coreDetails.tokenValidForDays * 24 * 60 * 60 };
		return redirect($path("/"), {
			headers: combineHeaders(
				{ "set-cookie": await authCookie.serialize(loginUser.apiKey, options) },
				cookies,
			),
		});
	}
	return json({ input });
};

export const action = async (_args: ActionFunctionArgs) => {
	const { getOidcRedirectUrl } = await gqlClient.request(
		GetOidcRedirectUrlDocument,
	);
	return redirect(getOidcRedirectUrl);
};
