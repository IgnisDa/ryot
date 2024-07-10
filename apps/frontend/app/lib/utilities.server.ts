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
	UserCollectionsListDocument,
	UserPreferencesDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { UserDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { isEmpty } from "@ryot/ts-utils";
import { type CookieSerializeOptions, parse, serialize } from "cookie";
import { GraphQLClient } from "graphql-request";
import { withoutHost } from "ufo";
import { v4 as randomUUID } from "uuid";
import { type ZodTypeAny, type output, z } from "zod";
import {
	AUTH_COOKIE_NAME,
	CurrentWorkoutKey,
	dayjsLib,
	queryClient,
	queryFactory,
	redirectToQueryParam,
} from "~/lib/generals";

export const API_URL = process.env.API_URL || "http://localhost:8000/backend";

export const serverGqlService = new GraphQLClient(`${API_URL}/graphql`, {
	headers: { Connection: "keep-alive" },
});

export const getCookieValue = (request: Request, cookieName: string) => {
	return parse(request.headers.get("cookie") || "")[cookieName];
};

export const getAuthorizationCookie = (request: Request) => {
	return getCookieValue(request, AUTH_COOKIE_NAME);
};

export const getAuthorizationHeader = (request?: Request, token?: string) => {
	let cookie: string;
	if (request) cookie = getAuthorizationCookie(request);
	else if (token) cookie = token;
	else cookie = "";
	return { Authorization: `Bearer ${cookie}` };
};

export const redirectIfNotAuthenticatedOrUpdated = async (request: Request) => {
	const { userDetails } = await getCachedUserDetails(request);
	if (!userDetails || userDetails.__typename === "UserDetailsError") {
		const nextUrl = withoutHost(request.url);
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
	FRONTEND_OIDC_BUTTON_LABEL: z
		.string()
		.default("Continue with OpenID Connect"),
});

/**
 * Combine multiple header objects into one (uses append so headers are not overridden)
 */
export const combineHeaders = (
	...headers: Array<ResponseInit["headers"] | null | undefined>
) => {
	const combined = new Headers();
	for (const header of headers) {
		if (!header) continue;
		for (const [key, value] of new Headers(header).entries())
			combined.append(key, value);
	}
	return combined;
};

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

export const getCachedCoreDetails = async () => {
	return await queryClient.ensureQueryData({
		queryKey: queryFactory.miscellaneous.coreDetails().queryKey,
		queryFn: () => serverGqlService.request(CoreDetailsDocument),
	});
};

export const getCachedUserDetails = async (request: Request) => {
	const token = getAuthorizationCookie(request);
	return await queryClient.ensureQueryData({
		queryKey: queryFactory.users.details(token).queryKey,
		queryFn: () =>
			serverGqlService.request(
				UserDetailsDocument,
				undefined,
				getAuthorizationHeader(request),
			),
	});
};

export const getCachedUserPreferences = async (request: Request) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	return queryClient.ensureQueryData({
		queryKey: queryFactory.users.preferences(userDetails.id).queryKey,
		queryFn: () =>
			serverGqlService
				.request(
					UserPreferencesDocument,
					undefined,
					getAuthorizationHeader(request),
				)
				.then((data) => data.userPreferences),
	});
};

export const getCachedUserCollectionsList = async (request: Request) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	return queryClient.ensureQueryData({
		queryKey: queryFactory.collections.userList(userDetails.id).queryKey,
		queryFn: () =>
			serverGqlService
				.request(
					UserCollectionsListDocument,
					{},
					getAuthorizationHeader(request),
				)
				.then((data) => data.userCollectionsList),
		staleTime: dayjsLib.duration(1, "hour").asMilliseconds(),
	});
};

export const removeCachedUserCollectionsList = async (request: Request) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	queryClient.removeQueries({
		queryKey: queryFactory.collections.userList(userDetails.id).queryKey,
	});
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

export const redirectWithToast = async (
	url: string,
	toast: OptionalToast,
	init?: ResponseInit,
) => {
	return redirect(url, {
		...init,
		headers: combineHeaders(init?.headers, await createToastHeaders(toast)),
	});
};

export const createToastHeaders = async (optionalToast: OptionalToast) => {
	const session = await toastSessionStorage.getSession();
	const toast = ToastSchema.parse(optionalToast);
	session.flash(toastKey, toast);
	const cookie = await toastSessionStorage.commitSession(session);
	return new Headers({ "set-cookie": cookie });
};

export const getToast = async (request: Request) => {
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
};

export const getCookiesForApplication = async (token: string) => {
	const [{ coreDetails }] = await Promise.all([getCachedCoreDetails()]);
	const maxAge = coreDetails.tokenValidForDays * 24 * 60 * 60;
	const options = { maxAge, path: "/" } satisfies CookieSerializeOptions;
	return combineHeaders({
		"set-cookie": serialize(AUTH_COOKIE_NAME, token, options),
	});
};

export const getLogoutCookies = () => {
	return combineHeaders({
		"set-cookie": serialize(AUTH_COOKIE_NAME, "", { expires: new Date(0) }),
	});
};

export const extendResponseHeaders = (
	responseHeaders: Headers,
	headers: Headers,
) => {
	for (const [key, value] of headers.entries())
		responseHeaders.append(key, value);
	return responseHeaders;
};

export const isWorkoutActive = (request: Request) => {
	const cookies = request.headers.get("cookie");
	const inProgress = parse(cookies || "")[CurrentWorkoutKey] === "true";
	return inProgress;
};

export const redirectUsingEnhancedCookieSearchParams = async (
	request: Request,
	cookieName: string,
) => {
	const preferences = await getCachedUserPreferences(request);
	const searchParams = new URL(request.url).searchParams;
	if (searchParams.size > 0 || !preferences.general.persistQueries) return;
	const cookies = parse(request.headers.get("cookie") || "");
	const savedSearchParams = cookies[cookieName];
	if (!isEmpty(savedSearchParams)) throw redirect(`?${savedSearchParams}`);
};
