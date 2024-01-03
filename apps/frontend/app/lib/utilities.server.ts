import { parse } from "@conform-to/zod";
import { json } from "@remix-run/node";
import { UserLot } from "@ryot/generated/graphql/backend/graphql";
import { ZodTypeAny, output, z } from "zod";
import { zx } from "zodix";
import { authCookie } from "./cookies.server";

export const expectedEnvironmentVariables = z.object({
	FRONTEND_UMAMI_WEBSITE_ID: z.string().optional(),
	FRONTEND_UMAMI_DOMAINS: z.string().optional(),
	FRONTEND_UMAMI_SCRIPT_URL: z.string().optional(),
});

/**
 * Combine multiple header objects into one (uses append so headers are not overridden)
 */
export function combineHeaders(
	...headers: Array<ResponseInit["headers"] | null | undefined>
) {
	const combined = new Headers();
	for (const header of headers) {
		if (!header) continue;
		for (const [key, value] of new Headers(header).entries()) {
			combined.append(key, value);
		}
	}
	return combined;
}

export type ApplicationUser = {
	__typename: "User";
	id: number;
	email?: string | null | undefined;
	name: string;
	lot: UserLot;
};

export const ShowAndPodcastSchema = z.object({
	showSeasonNumber: zx.IntAsString.optional().nullable(),
	showEpisodeNumber: zx.IntAsString.optional().nullable(),
	podcastEpisodeNumber: zx.IntAsString.optional().nullable(),
});

export const processSubmission = <Schema extends ZodTypeAny>(
	formData: FormData,
	schema: Schema,
): output<Schema> => {
	const submission = parse(formData, { schema });
	if (submission.intent !== "submit")
		throw json({ status: "idle", submission } as const);
	if (!submission.value)
		throw json({ status: "error", submission } as const, { status: 400 });
	return submission.value;
};

export const getLogoutCookies = async () => {
	return await authCookie.serialize("", {
		expires: new Date(0),
	});
};
