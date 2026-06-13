import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { isHttpMethod } from "@effect/platform/HttpMethod";
import { Data, Effect } from "effect";

import type { ImportRunFailureStage } from "../types";

type SourceQueryValue = boolean | number | string | undefined;
type SourceRequestHeaders = Record<string, string>;
type BunRequestInit = RequestInit & { tls: { rejectUnauthorized: boolean } };

const insecureRequestInit: BunRequestInit = { tls: { rejectUnauthorized: false } };

export class ImportSourceRequestError extends Data.TaggedError("ImportSourceRequestError")<{
	message: string;
	context: Record<string, unknown>;
}> {}

export type ImportSourceAdapterFailure = {
	message: string;
	itemIndex: number;
	sourceLabel?: string;
	sourceIdentifier?: string;
	stage: ImportRunFailureStage;
	context?: Record<string, unknown>;
};

export type SourceRequestInput = {
	path: string;
	baseUrl: string;
	sourceName: string;
	body?: string | null;
	headers?: SourceRequestHeaders;
	method?: "GET" | "HEAD" | "POST";
	allowInsecureConnections?: boolean;
	query?: Record<string, SourceQueryValue>;
};

export type SourceJsonRequestInput = Omit<SourceRequestInput, "method"> & {
	method?: "GET" | "POST";
};

const getSourceErrorMessage = (input: { host: string; status?: number; sourceName: string }) => {
	if (input.status === 401 || input.status === 403) {
		return `Authentication failed for ${input.sourceName} at ${input.host}`;
	}
	if (input.status !== undefined) {
		return `${input.sourceName} request to ${input.host} failed with status ${input.status}`;
	}
	return `Failed to reach ${input.sourceName} at ${input.host}`;
};

export const normalizeSourceApiUrl = (value: string): string => {
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

export const getSourceApiHost = (value: string): string =>
	new URL(normalizeSourceApiUrl(value)).host;

const buildSourceApiUrl = (input: {
	path: string;
	baseUrl: string;
	query?: Record<string, SourceQueryValue>;
}): URL => {
	const url = new URL(input.path.replace(/^\/+/, ""), `${normalizeSourceApiUrl(input.baseUrl)}/`);
	for (const [key, value] of Object.entries(input.query ?? {})) {
		if (value === undefined) {
			continue;
		}
		url.searchParams.set(key, String(value));
	}
	return url;
};

const getImportSourceFailureContext = (
	error: unknown,
	fallback: Record<string, unknown> = {},
): Record<string, unknown> =>
	error instanceof ImportSourceRequestError ? error.context : fallback;

export const createImportSourceFailure = (input: {
	host: string;
	error: unknown;
	message: string;
	itemIndex: number;
	sourceLabel?: string;
	sourceIdentifier?: string;
	stage: ImportRunFailureStage;
}): ImportSourceAdapterFailure => ({
	stage: input.stage,
	message: input.message,
	itemIndex: input.itemIndex,
	sourceLabel: input.sourceLabel,
	sourceIdentifier: input.sourceIdentifier,
	context: getImportSourceFailureContext(input.error, { host: input.host }),
});

export const requestSourceResponse = Effect.fn("imports.requestSourceResponse")(function* (
	input: SourceRequestInput,
) {
	const httpClient = yield* HttpClient.HttpClient;
	const host = getSourceApiHost(input.baseUrl);
	const url = buildSourceApiUrl({ path: input.path, query: input.query, baseUrl: input.baseUrl });

	const method = input.method ?? "GET";
	if (!isHttpMethod(method)) {
		return yield* new ImportSourceRequestError({
			context: { host },
			message: getSourceErrorMessage({ host, sourceName: input.sourceName }),
		});
	}

	let request = HttpClientRequest.make(method)(url.toString());
	if (input.headers) {
		request = HttpClientRequest.setHeaders(input.headers)(request);
	}
	if (input.body !== undefined && input.body !== null) {
		request = HttpClientRequest.bodyText(input.body)(request);
	}

	const response = yield* httpClient.execute(request).pipe(
		input.allowInsecureConnections
			? Effect.provideService(FetchHttpClient.RequestInit, insecureRequestInit)
			: (effect) => effect,
		Effect.mapError(
			() =>
				new ImportSourceRequestError({
					context: { host },
					message: getSourceErrorMessage({ host, sourceName: input.sourceName }),
				}),
		),
	);

	if (response.status < 200 || response.status >= 300) {
		return yield* new ImportSourceRequestError({
			context: { host, status: response.status },
			message: getSourceErrorMessage({
				host,
				status: response.status,
				sourceName: input.sourceName,
			}),
		});
	}

	return response;
});

export const requestSourceJson = Effect.fn("imports.requestSourceJson")(function* (
	input: SourceJsonRequestInput,
) {
	const host = getSourceApiHost(input.baseUrl);
	const response = yield* requestSourceResponse(input);

	return yield* response.json.pipe(
		Effect.mapError(
			() =>
				new ImportSourceRequestError({
					context: { host },
					message: getSourceErrorMessage({ host, sourceName: input.sourceName }),
				}),
		),
	);
});
