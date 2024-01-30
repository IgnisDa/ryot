import { parse } from "@conform-to/zod";
import { json } from "@remix-run/node";
import { UserLot } from "@ryot/generated/graphql/backend/graphql";
import { ZodTypeAny, output, z } from "zod";
import { authCookie } from "./cookies.server";

export const expectedEnvironmentVariables = z.object({
	DISABLE_TELEMETRY: z
		.string()
		.optional()
		.transform((v) => v === "true"),
	FRONTEND_UMAMI_SCRIPT_URL: z
		.string()
		.default("https://umami.diptesh.me/script.js"),
	FRONTEND_UMAMI_WEBSITE_ID: z
		.string()
		.default("5ecd6915-d542-4fda-aa5f-70f09f04e2e0"),
	FRONTEND_UMAMI_DOMAINS: z.string().optional(),
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

const emptyNumberString = z
	.any()
	.transform((v) => (!v ? undefined : parseInt(v)))
	.nullable();

export const MetadataSpecificsSchema = z.object({
	showSeasonNumber: emptyNumberString,
	showEpisodeNumber: emptyNumberString,
	podcastEpisodeNumber: emptyNumberString,
	animeEpisodeNumber: emptyNumberString,
	mangaChapterNumber: emptyNumberString,
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
