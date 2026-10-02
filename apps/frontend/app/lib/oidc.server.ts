import { GetOidcRedirectUrlDocument } from "@ryot/generated/graphql/backend/graphql";
import { createCookie, redirect } from "react-router";
import { serverGqlService } from "~/lib/utilities.server";

export const oidcBrowserCookie = createCookie("OidcBrowser", {
	path: "/",
	httpOnly: true,
	sameSite: "lax",
	maxAge: 60 * 10,
});

export const startOidcLogin = async () => {
	const { getOidcRedirectUrl } = await serverGqlService.request(
		GetOidcRedirectUrlDocument,
	);
	const redirectUri = new URL(
		getOidcRedirectUrl.authorizationUrl,
	).searchParams.get("redirect_uri");
	const cookie = await oidcBrowserCookie.serialize(
		getOidcRedirectUrl.browserToken,
		{ secure: redirectUri?.startsWith("https://") === true },
	);
	return redirect(getOidcRedirectUrl.authorizationUrl, {
		headers: { "set-cookie": cookie },
	});
};
