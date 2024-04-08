import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	json,
	redirect,
} from "@remix-run/node";
import {
	GetOidcRedirectUrlDocument,
	GetOidcTokenDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { z } from "zod";
import { zx } from "zodix";
import { gqlClient } from "~/lib/utilities.server";

const searchParamsSchema = z.object({ code: z.string() });

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const input = zx.parseQuery(request, searchParamsSchema);
	const { getOidcToken } = await gqlClient.request(GetOidcTokenDocument, input);
	console.log(getOidcToken);
	return json({ input });
};

export const action = async (_args: ActionFunctionArgs) => {
	const { getOidcRedirectUrl } = await gqlClient.request(
		GetOidcRedirectUrlDocument,
	);
	return redirect(getOidcRedirectUrl.url);
};
