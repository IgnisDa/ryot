import { CompleteOidcLoginDocument } from "@ryot-app/generated/graphql/backend/graphql";
import { ClientError } from "graphql-request";
import { redirect } from "react-router";
import { $path } from "safe-routes";
import { z } from "zod";
import { oidcBrowserCookie } from "~/lib/oidc.server";
import {
	getCookiesForApplication,
	getCoreDetails,
	redirectWithToast,
	serverGqlService,
	twoFactorSessionStorage,
} from "~/lib/utilities.server";
import type { Route } from "./+types/api.auth";

const searchParamsSchema = z.object({
	code: z.string().min(1),
	state: z.string().min(1),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: Route.LoaderArgs) => {
	const input = searchParamsSchema.safeParse(
		Object.fromEntries(new URL(request.url).searchParams),
	);
	const browserToken = await oidcBrowserCookie.parse(
		request.headers.get("cookie"),
	);
	const headers = new Headers({
		"set-cookie": await oidcBrowserCookie.serialize("", { maxAge: 0 }),
	});
	if (!input.success || typeof browserToken !== "string" || !browserToken)
		return redirectWithToast(
			$path("/auth", { autoOidcLaunch: false }),
			{
				type: "error",
				message: "OIDC login expired or was not started in this browser",
			},
			{ headers },
		);

	try {
		const { completeOidcLogin } = await serverGqlService.request(
			CompleteOidcLoginDocument,
			{ input: { ...input.data, browserToken } },
		);
		await getCoreDetails();
		if (completeOidcLogin.__typename === "ApiKeyResponse") {
			const authHeaders = await getCookiesForApplication(
				completeOidcLogin.apiKey,
			);
			for (const cookie of authHeaders.getSetCookie())
				headers.append("set-cookie", cookie);
			return redirect($path("/"), { headers });
		}
		if (completeOidcLogin.__typename === "StringIdObject") {
			const session = await twoFactorSessionStorage.getSession();
			session.set("userId", completeOidcLogin.id);
			headers.append(
				"set-cookie",
				await twoFactorSessionStorage.commitSession(session),
			);
			return redirect($path("/two-factor"), { headers });
		}
	} catch (error) {
		if (!(error instanceof ClientError)) throw error;
		const registrationDisabled = error.response.errors?.some(
			(error) => error.message === "Registration is disabled",
		);
		if (registrationDisabled)
			return redirectWithToast(
				$path("/auth", { autoOidcLaunch: false }),
				{
					type: "error",
					message: "Registration is disabled",
				},
				{ headers },
			);
	}
	return redirectWithToast(
		$path("/auth", { autoOidcLaunch: false }),
		{
			type: "error",
			message: "OIDC login failed. Please start a new login.",
		},
		{ headers },
	);
};
