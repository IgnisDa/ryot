import type { CoreSandboxHostMethodMap } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";

export type HttpHost = { readonly httpCall: CoreSandboxHostMethodMap["httpCall"] };
type QueryValue = boolean | number | string | undefined;

export const withSourceRequestOptions = (
	host: HttpHost,
	allowInsecureConnections: boolean | undefined,
): HttpHost =>
	allowInsecureConnections === undefined
		? host
		: {
				httpCall: (method, url, options) =>
					host.httpCall(method, url, { ...options, allowInsecureConnections }),
			};

export const normalizeSourceApiUrl = (value: string) => {
	const parsed = new URL(value.trim());
	if (!parsed.protocol || !["http:", "https:"].includes(parsed.protocol)) {
		throw new Error("Import source URL must use http or https");
	}
	parsed.hash = "";
	parsed.search = "";
	parsed.password = "";
	parsed.username = "";
	return parsed.toString().replace(/\/+$/, "");
};

export const sourceApiHost = (value: string) => new URL(normalizeSourceApiUrl(value)).host;

export const sourceApiUrl = (baseUrl: string, path: string, query?: Record<string, QueryValue>) => {
	const url = new URL(path.replace(/^\/+/, ""), `${normalizeSourceApiUrl(baseUrl)}/`);
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value !== undefined) {
			url.searchParams.set(key, String(value));
		}
	}
	return url.toString();
};

export const requestSourceResponse = (
	host: HttpHost,
	input: {
		path: string;
		baseUrl: string;
		body?: string;
		headers?: Record<string, string>;
		method?: "GET" | "HEAD" | "POST";
		query?: Record<string, QueryValue>;
	},
) =>
	host.httpCall(input.method ?? "GET", sourceApiUrl(input.baseUrl, input.path, input.query), {
		...(input.body === undefined ? {} : { body: input.body }),
		...(input.headers === undefined ? {} : { headers: input.headers }),
	});

export const requestSourceJson = (
	host: HttpHost,
	input: Parameters<typeof requestSourceResponse>[1],
) =>
	requestSourceResponse(host, input).pipe(
		Effect.flatMap(({ body }) => Effect.try((): unknown => JSON.parse(body))),
	);
