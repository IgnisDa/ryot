import { parseWithZod } from "@conform-to/zod";
import {
	json,
	unstable_composeUploadHandlers,
	unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import {
	GetPresignedS3UrlDocument,
	PresignedPutS3UrlDocument,
	type UserLot,
} from "@ryot/generated/graphql/backend/graphql";
import { type ZodTypeAny, type output, z } from "zod";
import { API_URL, gqlClient } from "./api.server";
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
	isDemo: boolean;
};

const emptyNumberString = z
	.any()
	.transform((v) => (!v ? undefined : Number.parseInt(v)))
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
	const submission = parseWithZod(formData, { schema });
	if (submission.status !== "success")
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

export const uploadFileAndGetKey = async (
	fileName: string,
	prefix: string,
	contentType: string,
	body: ArrayBuffer | Buffer,
) => {
	const { presignedPutS3Url } = await gqlClient.request(
		PresignedPutS3UrlDocument,
		{ input: { fileName, prefix } },
	);
	await fetch(presignedPutS3Url.uploadUrl, {
		method: "PUT",
		body,
		headers: { "Content-Type": contentType },
	});
	return presignedPutS3Url.key;
};

export const getPresignedGetUrl = async (key: string) => {
	const { getPresignedS3Url } = await gqlClient.request(
		GetPresignedS3UrlDocument,
		{ key },
	);
	return getPresignedS3Url;
};

const asyncIterableToFile = async (
	asyncIterable: AsyncIterable<Uint8Array>,
	filename: string,
) => {
	const blob = [];
	for await (const chunk of asyncIterable) blob.push(chunk);
	return new File(blob, filename);
};

export const temporaryFileUploadHandler = unstable_composeUploadHandlers(
	async (params) => {
		if (params.filename && params.data) {
			const formData = new FormData();
			const file = await asyncIterableToFile(params.data, params.filename);
			formData.append("files[]", file, params.filename);
			const resp = await fetch(`${API_URL}/upload`, {
				method: "POST",
				body: formData,
			});
			const data = await resp.json();
			return data[0];
		}
		return undefined;
	},
	unstable_createMemoryUploadHandler(),
);

export const s3FileUploader = (prefix: string) =>
	unstable_composeUploadHandlers(async (params) => {
		if (params.filename && params.data) {
			const file = await asyncIterableToFile(params.data, params.filename);
			const key = await uploadFileAndGetKey(
				file.name,
				prefix,
				file.type,
				await file.arrayBuffer(),
			);
			return key;
		}
		return undefined;
	}, unstable_createMemoryUploadHandler());
