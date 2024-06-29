import { parseWithZod } from "@conform-to/zod";
import { $path } from "@ignisda/remix-routes";
import {
	createCookie,
	createCookieSessionStorage,
	redirect,
	unstable_composeUploadHandlers,
	unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import {
	CoreDetailsDocument,
	CoreEnabledFeaturesDocument,
	GetPresignedS3UrlDocument,
	PresignedPutS3UrlDocument,
	type User,
	UserCollectionsListDocument,
	type UserPreferences,
	UserPreferencesDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { UserDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { type CookieSerializeOptions, parse, serialize } from "cookie";
import { GraphQLClient } from "graphql-request";
import { withoutHost } from "ufo";
import { v4 as randomUUID } from "uuid";
import { type ZodTypeAny, type output, z } from "zod";
import {
	AUTH_COOKIE_NAME,
	CORE_DETAILS_COOKIE_NAME,
	USER_DETAILS_COOKIE_NAME,
	USER_PREFERENCES_COOKIE_NAME,
	redirectToQueryParam,
} from "~/lib/generals";

export const API_URL = process.env.API_URL || "http://localhost:8000/backend";

export const serverGqlService = new GraphQLClient(`${API_URL}/graphql`, {
	headers: { Connection: "keep-alive" },
});

export const getCookieValue = (request: Request, cookieName: string) => {
	return parse(request.headers.get("cookie") || "")[cookieName];
};

const getAuthorizationCookie = (request: Request) => {
	return getCookieValue(request, AUTH_COOKIE_NAME);
};

export const getAuthorizationHeader = async (
	request?: Request,
	token?: string,
) => {
	let cookie: string;
	if (request) cookie = await getAuthorizationCookie(request);
	else if (token) cookie = token;
	else cookie = "";
	return { Authorization: `Bearer ${cookie}` };
};

export const getIsAuthenticated = (request: Request) => {
	const cookie = getAuthorizationCookie(request);
	if (!cookie) return [false, null] as const;
	const value = getCookieValue(request, USER_DETAILS_COOKIE_NAME);
	return [true, JSON.parse(value) as User] as const;
};

export const redirectIfNotAuthenticatedOrUpdated = async (request: Request) => {
	const [isAuthenticated, userDetails] = getIsAuthenticated(request);
	const nextUrl = withoutHost(request.url);
	if (!isAuthenticated) {
		throw redirect($path("/auth", { [redirectToQueryParam]: nextUrl }), {
			status: 302,
			headers: combineHeaders(
				await createToastHeaders({
					type: "error",
					message: "You must be logged in to view this page",
				}),
				getLogoutCookies(),
			),
		});
	}
	return userDetails;
};

const expectedServerVariables = z.object({
	DISABLE_TELEMETRY: z
		.string()
		.optional()
		.transform((v) => v === "true"),
	FRONTEND_UMAMI_SCRIPT_URL: z.string().optional(),
	FRONTEND_UMAMI_WEBSITE_ID: z.string().optional(),
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
		for (const [key, value] of new Headers(header).entries())
			combined.append(key, value);
	}
	return combined;
}

const emptyNumberString = z
	.any()
	.transform((v) => (!v ? undefined : Number.parseInt(v)))
	.nullable();

export const MetadataIdSchema = z.object({ metadataId: z.string() });

export const MetadataSpecificsSchema = z.object({
	showSeasonNumber: emptyNumberString,
	showEpisodeNumber: emptyNumberString,
	podcastEpisodeNumber: emptyNumberString,
	animeEpisodeNumber: emptyNumberString,
	mangaChapterNumber: emptyNumberString,
	mangaVolumeNumber: emptyNumberString,
});

export const processSubmission = <Schema extends ZodTypeAny>(
	formData: FormData,
	schema: Schema,
): output<Schema> => {
	const submission = parseWithZod(formData, { schema });
	if (submission.status !== "success")
		throw Response.json({ status: "idle", submission } as const);
	if (!submission.value)
		throw Response.json({ status: "error", submission } as const, {
			status: 400,
		});
	return submission.value;
};

export const getUserCollectionsList = async (request: Request) => {
	const { userCollectionsList } = await serverGqlService.request(
		UserCollectionsListDocument,
		{},
		await getAuthorizationHeader(request),
	);
	return userCollectionsList;
};

export const uploadFileAndGetKey = async (
	fileName: string,
	prefix: string,
	contentType: string,
	body: ArrayBuffer | Buffer,
) => {
	const { presignedPutS3Url } = await serverGqlService.request(
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
	const { getPresignedS3Url } = await serverGqlService.request(
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

export const getUserPreferences = async (request: Request) => {
	await redirectIfNotAuthenticatedOrUpdated(request);
	const preferences = getCookieValue(request, USER_PREFERENCES_COOKIE_NAME);
	return JSON.parse(preferences) as UserPreferences;
};

export const getCoreEnabledFeatures = async () => {
	const { coreEnabledFeatures } = await serverGqlService.request(
		CoreEnabledFeaturesDocument,
	);
	return coreEnabledFeatures;
};

export const serverVariables = expectedServerVariables.parse(process.env);

export const toastSessionStorage = createCookieSessionStorage({
	cookie: {
		sameSite: "lax",
		path: "/",
		httpOnly: true,
		secrets: (process.env.SESSION_SECRET || "").split(","),
		name: "Toast",
	},
});

export const colorSchemeCookie = createCookie("ColorScheme", {
	maxAge: 60 * 60 * 24 * 365,
});

export const toastKey = "toast";

const TypeSchema = z.enum(["message", "success", "error"]);
const ToastSchema = z.object({
	message: z.string(),
	id: z.string().default(() => randomUUID()),
	title: z.string().optional(),
	type: TypeSchema.default("message"),
});

export type Toast = z.infer<typeof ToastSchema>;
export type OptionalToast = Omit<Toast, "id" | "type"> & {
	id?: string;
	type?: z.infer<typeof TypeSchema>;
};

export async function redirectWithToast(
	url: string,
	toast: OptionalToast,
	init?: ResponseInit,
) {
	return redirect(url, {
		...init,
		headers: combineHeaders(init?.headers, await createToastHeaders(toast)),
	});
}

export async function createToastHeaders(optionalToast: OptionalToast) {
	const session = await toastSessionStorage.getSession();
	const toast = ToastSchema.parse(optionalToast);
	session.flash(toastKey, toast);
	const cookie = await toastSessionStorage.commitSession(session);
	return new Headers({ "set-cookie": cookie });
}

export async function getToast(request: Request) {
	const session = await toastSessionStorage.getSession(
		request.headers.get("cookie"),
	);
	const result = ToastSchema.safeParse(session.get(toastKey));
	const toast = result.success ? result.data : null;
	return {
		toast,
		headers: toast
			? new Headers({
					"set-cookie": await toastSessionStorage.destroySession(session),
				})
			: null,
	};
}

export const getCookiesForApplication = async (token: string) => {
	const [{ coreDetails }, { userPreferences }, { userDetails }] =
		await Promise.all([
			serverGqlService.request(CoreDetailsDocument),
			serverGqlService.request(
				UserPreferencesDocument,
				undefined,
				await getAuthorizationHeader(undefined, token),
			),
			serverGqlService.request(
				UserDetailsDocument,
				undefined,
				await getAuthorizationHeader(undefined, token),
			),
		]);
	const maxAge = coreDetails.tokenValidForDays * 24 * 60 * 60;
	const options = { maxAge, path: "/" } satisfies CookieSerializeOptions;
	return combineHeaders(
		{
			"set-cookie": serialize(
				CORE_DETAILS_COOKIE_NAME,
				JSON.stringify(coreDetails),
				options,
			),
		},
		{
			"set-cookie": serialize(
				USER_PREFERENCES_COOKIE_NAME,
				JSON.stringify(userPreferences),
				options,
			),
		},
		{
			"set-cookie": serialize(
				USER_DETAILS_COOKIE_NAME,
				JSON.stringify(userDetails),
				options,
			),
		},
		{ "set-cookie": serialize(AUTH_COOKIE_NAME, token, options) },
	);
};

export const getLogoutCookies = () => {
	return combineHeaders(
		{ "set-cookie": serialize(AUTH_COOKIE_NAME, "", { expires: new Date(0) }) },
		{
			"set-cookie": serialize(CORE_DETAILS_COOKIE_NAME, "", {
				expires: new Date(0),
			}),
		},
		{
			"set-cookie": serialize(USER_PREFERENCES_COOKIE_NAME, "", {
				expires: new Date(0),
			}),
		},
		{
			"set-cookie": serialize(USER_DETAILS_COOKIE_NAME, "", {
				expires: new Date(0),
			}),
		},
	);
};

export const extendResponseHeaders = (
	responseHeaders: Headers,
	headers: Headers,
) => {
	for (const [key, value] of headers.entries())
		responseHeaders.append(key, value);
	return responseHeaders;
};
