import { parseWithZod } from "@conform-to/zod";
import { $path } from "@ignisda/remix-routes";
import {
	json,
	redirect,
	unstable_composeUploadHandlers,
	unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import {
	type CookieOptions,
	createCookie,
	createCookieSessionStorage,
} from "@remix-run/node";
import {
	type CoreDetails,
	CoreDetailsDocument,
	CoreEnabledFeaturesDocument,
	GetPresignedS3UrlDocument,
	PresignedPutS3UrlDocument,
	UserCollectionsListDocument,
	type UserLot,
	type UserPreferences,
	UserPreferencesDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { UserDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { GraphQLClient } from "graphql-request";
import { withQuery, withoutHost } from "ufo";
import { v4 as randomUUID } from "uuid";
import { type ZodTypeAny, type output, z } from "zod";
import { zx } from "zodix";
import { redirectToQueryParam } from "./generals";

const isProduction = process.env.NODE_ENV === "production";
export const API_URL = process.env.API_URL || "http://localhost:8000/backend";

export const gqlClient = new GraphQLClient(`${API_URL}/graphql`, {
	headers: { Connection: "keep-alive" },
});

const getAuthorizationCookie = async (request: Request) => {
	const cookie = await authCookie.parse(request.headers.get("cookie") || "");
	return cookie;
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

export const getIsAuthenticated = async (request: Request) => {
	const cookie = await getAuthorizationCookie(request);
	if (!cookie) return [false, null] as const;
	try {
		const { userDetails } = await gqlClient.request(
			UserDetailsDocument,
			undefined,
			await getAuthorizationHeader(request),
		);
		return [userDetails.__typename === "User", userDetails] as const;
	} catch {
		return [false, null] as const;
	}
};

export const redirectIfNotAuthenticatedOrUpdated = async (request: Request) => {
	const [isAuthenticated, userDetails] = await getIsAuthenticated(request);
	const nextUrl = withoutHost(request.url);
	if (!isAuthenticated || userDetails.__typename !== "User") {
		throw redirect(
			withQuery($path("/auth/login"), { [redirectToQueryParam]: nextUrl }),
			{
				status: 302,
				headers: combineHeaders(
					await createToastHeaders({
						type: "error",
						message: "You must be logged in to view this page",
					}),
					await getLogoutCookies(),
				),
			},
		);
	}
	return userDetails;
};

const expectedServerVariables = z.object({
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
	FRONTEND_INSECURE_COOKIES: zx.BoolAsString.optional(),
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

export type ApplicationUser = {
	__typename: "User";
	id: number;
	name: string;
	lot: UserLot;
	oidcIssuerId?: string;
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

export const getUserCollectionsList = async (request: Request) => {
	const { userCollectionsList } = await gqlClient.request(
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

export const getCoreEnabledFeatures = async () => {
	const { coreEnabledFeatures } = await gqlClient.request(
		CoreEnabledFeaturesDocument,
	);
	return coreEnabledFeatures;
};

export const serverVariables = expectedServerVariables.parse(process.env);

const commonCookieOptions = {
	sameSite: "lax",
	path: "/",
	httpOnly: true,
	secrets: (process.env.SESSION_SECRET || "").split(","),
	secure: isProduction ? !serverVariables.FRONTEND_INSECURE_COOKIES : false,
} satisfies CookieOptions;

export const authCookie = createCookie("Auth", commonCookieOptions);

export const userPreferencesCookie = createCookie(
	"UserPreferences",
	commonCookieOptions,
);

export const coreDetailsCookie = createCookie(
	"CoreDetails",
	commonCookieOptions,
);

export const userDetailsCookie = createCookie(
	"UserDetails",
	commonCookieOptions,
);

export const toastSessionStorage = createCookieSessionStorage({
	cookie: { ...commonCookieOptions, name: "Toast" },
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
			gqlClient.request(CoreDetailsDocument),
			gqlClient.request(
				UserPreferencesDocument,
				undefined,
				await getAuthorizationHeader(undefined, token),
			),
			gqlClient.request(
				UserDetailsDocument,
				undefined,
				await getAuthorizationHeader(undefined, token),
			),
		]);
	const cookieMaxAge = coreDetails.tokenValidForDays * 24 * 60 * 60;
	return combineHeaders(
		{
			"set-cookie": await coreDetailsCookie.serialize(coreDetails, {
				maxAge: cookieMaxAge,
			}),
		},
		{
			"set-cookie": await userPreferencesCookie.serialize(userPreferences, {
				maxAge: cookieMaxAge,
			}),
		},
		{
			"set-cookie": await userDetailsCookie.serialize(userDetails, {
				maxAge: cookieMaxAge,
			}),
		},
	);
};

export const getLogoutCookies = async () => {
	return combineHeaders(
		{
			"set-cookie": await authCookie.serialize("", {
				expires: new Date(0),
			}),
		},
		{
			"set-cookie": await coreDetailsCookie.serialize("", {
				expires: new Date(0),
			}),
		},
		{
			"set-cookie": await userPreferencesCookie.serialize("", {
				expires: new Date(0),
			}),
		},
		{
			"set-cookie": await userDetailsCookie.serialize("", {
				expires: new Date(0),
			}),
		},
	);
};

export const getCoreDetails = async (request: Request) => {
	const details = await coreDetailsCookie.parse(
		request.headers.get("cookie") || "",
	);
	return details as CoreDetails;
};

export const getUserPreferences = async (request: Request) => {
	await redirectIfNotAuthenticatedOrUpdated(request);
	const prefs = await userPreferencesCookie.parse(
		request.headers.get("cookie") || "",
	);
	return prefs as UserPreferences;
};

export const getUserDetails = async (request: Request) => {
	await redirectIfNotAuthenticatedOrUpdated(request);
	const details = await userDetailsCookie.parse(
		request.headers.get("cookie") || "",
	);
	return details as ApplicationUser;
};
