import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { type FileUpload, parseFormData } from "@mjackson/form-data-parser";
import {
	BackendError,
	CoreDetailsDocument,
	PresignedPutS3UrlDocument,
	UserDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { type SerializeOptions, parse, serialize } from "cookie";
import {
	ClientError,
	GraphQLClient,
	type RequestDocument,
	type Variables,
} from "graphql-request";
import type { VariablesAndRequestHeadersArgs } from "node_modules/graphql-request/build/legacy/helpers/types";
import {
	createCookie,
	createCookieSessionStorage,
	data,
	redirect,
} from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withoutHost } from "ufo";
import { v4 as randomUUID } from "uuid";
import { z } from "zod";
import {
	FRONTEND_AUTH_COOKIE_NAME,
	redirectToQueryParam,
	toastKey,
} from "~/lib/shared/constants";
import { queryClient, queryFactory } from "~/lib/shared/react-query";

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
					BackendError.NoUserId,
					BackendError.NoSessionId,
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
					return data({ message });
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

const getAuthorizationCookie = (request: Request) =>
	getCookieValue(request, FRONTEND_AUTH_COOKIE_NAME);

export const redirectIfNotAuthenticatedOrUpdated = async (request: Request) => {
	const getResponseInit = async (toastMessage: string) => ({
		status: 302,
		headers: combineHeaders(
			await createToastHeaders({ type: "error", message: toastMessage }),
			getLogoutCookies(),
		),
	});
	try {
		const userDetails = await getUserDetails(request);
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
		throw redirect(
			$path("/auth"),
			await getResponseInit("You must be logged in to view this page"),
		);
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

export const getCoreDetails = async () => {
	return await queryClient.ensureQueryData({
		queryKey: ["coreDetails"],
		queryFn: () =>
			serverGqlService.request(CoreDetailsDocument).then((d) => d.coreDetails),
	});
};

const getUserDetails = async (request: Request) => {
	return await queryClient.ensureQueryData({
		queryKey: queryFactory.miscellaneous.userDetails().queryKey,
		queryFn: () =>
			serverGqlService
				.authenticatedRequest(request, UserDetailsDocument)
				.then((d) => d.userDetails),
	});
};

export const getUserPreferences = async (request: Request) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	return userDetails.preferences;
};

const uploadFileAndGetKey = async (
	fileName: string,
	prefix: string,
	contentType: string,
	body: BodyInit,
) => {
	const { presignedPutS3Url } = await serverGqlService.request(
		PresignedPutS3UrlDocument,
		{ input: { fileName, prefix } },
	);
	await fetch(presignedPutS3Url.uploadUrl, {
		body,
		method: "PUT",
		headers: { "Content-Type": contentType },
	});
	return presignedPutS3Url.key;
};

const temporaryFileUploadHandler = async (fileUpload: FileUpload) => {
	const formData = new FormData();
	formData.append("files[]", fileUpload, fileUpload.name);
	const resp = await fetch(`${API_URL}/upload`, {
		method: "POST",
		body: formData,
	});
	const data = await resp.json();
	return data[0];
};

const createS3FileUploader = (prefix: string) => {
	return async (fileUpload: FileUpload) => {
		if (!fileUpload.name) return null;
		const key = await uploadFileAndGetKey(
			fileUpload.name,
			prefix,
			fileUpload.type,
			await fileUpload.arrayBuffer(),
		);
		return key;
	};
};

const toastSessionStorage = createCookieSessionStorage({
	cookie: {
		path: "/",
		name: toastKey,
		sameSite: "lax",
		secrets: (process.env.SESSION_SECRET || "secret").split(","),
	},
});

export const twoFactorSessionStorage = createCookieSessionStorage({
	cookie: {
		path: "/",
		sameSite: "lax",
		httpOnly: true,
		maxAge: 60 * 10,
		name: "TwoFactor",
		secure: process.env.NODE_ENV === "production",
		secrets: (process.env.SESSION_SECRET || "secret").split(","),
	},
});

export const colorSchemeCookie = createCookie("ColorScheme", {
	maxAge: 60 * 60 * 24 * 365,
});

const TypeSchema = z.enum(["message", "success", "error"]);
const ToastSchema = z.object({
	message: z.string(),
	title: z.string().optional(),
	closeAfter: z.number().optional(),
	type: TypeSchema.default("message"),
	id: z.string().default(() => randomUUID()),
});

export type Toast = z.infer<typeof ToastSchema>;
type OptionalToast = Omit<Toast, "id" | "type"> & {
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

const parseFormDataWithFileSize = async (
	request: Request,
	uploader: (file: FileUpload) => Promise<string | null>,
) => {
	const coreDetails = await getCoreDetails();
	return parseFormData(
		request,
		{ maxFileSize: coreDetails.maxFileSizeMb * 1024 * 1024 },
		uploader,
	);
};

export const parseFormDataWithTemporaryUpload = async (request: Request) => {
	return parseFormDataWithFileSize(request, temporaryFileUploadHandler);
};

export const parseFormDataWithS3Upload = async (
	request: Request,
	prefix: string,
) => {
	const uploader = createS3FileUploader(prefix);
	return parseFormDataWithFileSize(request, uploader);
};
