import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import {
	createCookie,
	createCookieSessionStorage,
	redirect,
	unstable_composeUploadHandlers,
	unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import {
	BackendError,
	CoreDetailsDocument,
	GetPresignedS3UrlDocument,
	PresignedPutS3UrlDocument,
	UserCollectionsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { UserDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { isEmpty } from "@ryot/ts-utils";
import { type SerializeOptions, parse, serialize } from "cookie";
import {
	ClientError,
	GraphQLClient,
	type RequestDocument,
	type Variables,
} from "graphql-request";
import { jwtDecode } from "jwt-decode";
import type { VariablesAndRequestHeadersArgs } from "node_modules/graphql-request/build/legacy/helpers/types";
import { $path } from "remix-routes";
import { match } from "ts-pattern";
import { withoutHost } from "ufo";
import { v4 as randomUUID } from "uuid";
import { z } from "zod";
import {
	FRONTEND_AUTH_COOKIE_NAME,
	pageQueryParam,
	redirectToQueryParam,
	toastKey,
	zodEmptyDecimalString,
	zodEmptyNumberString,
} from "~/lib/generals";

export const API_URL = process.env.API_URL || "http://127.0.0.1:8000/backend";

class AuthenticatedGraphQLClient extends GraphQLClient {
	async authenticatedRequest<T, V extends Variables = Variables>(
		remixRequest: Request,
		docs: RequestDocument | TypedDocumentNode<T, V>,
		...vars: VariablesAndRequestHeadersArgs<V>
	): Promise<T> {
		const authHeaders = {
			Authorization: `Bearer ${getAuthorizationCookie(remixRequest)}`,
		};
		vars[1] = { ...authHeaders, ...vars[1] };
		try {
			return await this.request<T, V>(docs, ...vars);
		} catch (e) {
			if (!(e instanceof ClientError)) throw e;
			const error = e.response.errors?.at(0)?.message || "";
			throw await match(error)
				.with(
					BackendError.NoAuthToken,
					BackendError.NoUserId,
					BackendError.SessionExpired,
					async () => {
						return redirect($path("/auth"), {
							headers: combineHeaders(
								getLogoutCookies(),
								await createToastHeaders({
									type: "error",
									message: "Your session has expired",
								}),
							),
						});
					},
				)
				.otherwise((error) => {
					const message = match(error)
						.with(
							BackendError.MutationNotAllowed,
							() => "You do not have permission to perform this action",
						)
						.with(
							BackendError.AdminOnlyAction,
							() => "You must be an admin to perform this action",
						)
						.otherwise(() => error);
					return Response.json({ message });
				});
		}
	}
}

export const serverGqlService = new AuthenticatedGraphQLClient(
	`${API_URL}/graphql`,
	{ headers: { Connection: "keep-alive" } },
);

export const getCookieValue = (request: Request, cookieName: string) =>
	parse(request.headers.get("cookie") || "")[cookieName];

export const getAuthorizationCookie = (request: Request) =>
	getCookieValue(request, FRONTEND_AUTH_COOKIE_NAME);

export const redirectIfNotAuthenticatedOrUpdated = async (request: Request) => {
	try {
		const userDetails = await getUserDetails(request);
		const getResponseInit = async (toastMessage: string) => ({
			status: 302,
			headers: combineHeaders(
				await createToastHeaders({ type: "error", message: toastMessage }),
				getLogoutCookies(),
			),
		});
		if (!userDetails || userDetails.__typename === "UserDetailsError") {
			const nextUrl = withoutHost(request.url);
			throw redirect(
				$path("/auth", { [redirectToQueryParam]: nextUrl }),
				await getResponseInit("You must be logged in to view this page"),
			);
		}
		if (userDetails.isDisabled)
			throw redirect(
				$path("/auth"),
				await getResponseInit("This account has been disabled"),
			);

		return userDetails;
	} catch {
		throw redirect($path("/auth"), {
			headers: combineHeaders(
				await createToastHeaders({
					type: "error",
					message: "Your session has expired",
				}),
				getLogoutCookies(),
			),
		});
	}
};

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

export const MetadataIdSchema = z.object({ metadataId: z.string() });

export const MetadataSpecificsSchema = z.object({
	showSeasonNumber: zodEmptyNumberString,
	showEpisodeNumber: zodEmptyNumberString,
	podcastEpisodeNumber: zodEmptyNumberString,
	animeEpisodeNumber: zodEmptyNumberString,
	mangaChapterNumber: zodEmptyDecimalString,
	mangaVolumeNumber: zodEmptyNumberString,
});

export const getDecodedJwt = (request: Request) => {
	const token = getAuthorizationCookie(request) ?? "";
	return jwtDecode<{
		sub: string;
		access_link?: { id: string; is_demo?: boolean };
	}>(token);
};

export const getCoreDetails = async () => {
	return await serverGqlService
		.request(CoreDetailsDocument)
		.then((d) => d.coreDetails);
};

const getUserDetails = async (request: Request) => {
	const { userDetails } = await serverGqlService.authenticatedRequest(
		request,
		UserDetailsDocument,
		undefined,
	);
	return userDetails;
};

export const getUserPreferences = async (request: Request) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	return userDetails.preferences;
};

export const getUserCollectionsList = async (request: Request) => {
	const { userCollectionsList } = await serverGqlService.authenticatedRequest(
		request,
		UserCollectionsListDocument,
		{},
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

export const toastSessionStorage = createCookieSessionStorage({
	cookie: {
		sameSite: "lax",
		path: "/",
		secrets: (process.env.SESSION_SECRET || "").split(","),
		name: toastKey,
	},
});

export const colorSchemeCookie = createCookie("ColorScheme", {
	maxAge: 60 * 60 * 24 * 365,
});

const TypeSchema = z.enum(["message", "success", "error"]);
const ToastSchema = z.object({
	message: z.string(),
	id: z.string().default(() => randomUUID()),
	title: z.string().optional(),
	type: TypeSchema.default("message"),
	closeAfter: z.number().optional(),
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

export const getCookiesForApplication = async (
	token: string,
	tokenValidForDays?: number,
) => {
	const [coreDetails] = await Promise.all([getCoreDetails()]);
	const maxAge =
		(tokenValidForDays || coreDetails.tokenValidForDays) * 24 * 60 * 60;
	const options = { maxAge, path: "/" } satisfies SerializeOptions;
	return combineHeaders({
		"set-cookie": serialize(FRONTEND_AUTH_COOKIE_NAME, token, options),
	});
};

export const getLogoutCookies = () => {
	return combineHeaders({
		"set-cookie": serialize(FRONTEND_AUTH_COOKIE_NAME, "", {
			expires: new Date(0),
		}),
	});
};

export const extendResponseHeaders = (
	responseHeaders: Headers,
	headers: Headers,
) => {
	for (const [key, value] of headers.entries())
		responseHeaders.append(key, value);
};

export const getEnhancedCookieName = async (path: string, request: Request) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	return `SearchParams__${userDetails.id}__${path}`;
};

export const redirectUsingEnhancedCookieSearchParams = async (
	request: Request,
	cookieName: string,
) => {
	const preferences = await getUserPreferences(request);
	const { searchParams } = new URL(request.url);
	if (searchParams.size > 0 || !preferences.general.persistQueries) return;
	const cookies = parse(request.headers.get("cookie") || "");
	const savedSearchParams = cookies[cookieName];
	if (!isEmpty(savedSearchParams)) throw redirect(`?${savedSearchParams}`);
};

export const redirectToFirstPageIfOnInvalidPage = async (
	request: Request,
	totalResults: number,
	currentPage: number,
) => {
	const coreDetails = await getCoreDetails();
	const totalPages = Math.ceil(totalResults / coreDetails.pageSize);
	if (currentPage > totalPages && currentPage !== 1) {
		const { searchParams } = new URL(request.url);
		searchParams.set(pageQueryParam, "1");
		throw redirect(`?${searchParams.toString()}`);
	}
	return totalPages;
};
