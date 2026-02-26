import { type Config, config } from "../lib/config";
import {
	apiFailure,
	apiSuccess,
	type ConfigValueResult,
	type HttpCallOptions,
	type HttpCallResult,
} from "./types";

const httpCallTimeoutMs = 8_000;

const mapHeadersToObject = (headers: Headers) => {
	const headerObject: Record<string, string> = {};
	for (const [key, value] of headers.entries()) headerObject[key] = value;
	return headerObject;
};

const parseHttpCallOptions = (options: unknown): HttpCallOptions => {
	if (options === undefined || options === null) return {};
	if (typeof options !== "object" || Array.isArray(options))
		throw new Error("httpCall options must be an object");

	const parsed: HttpCallOptions = {};
	const optionRecord = options as Record<string, unknown>;

	if ("body" in optionRecord) {
		if (optionRecord.body === undefined) parsed.body = undefined;
		else if (typeof optionRecord.body === "string")
			parsed.body = optionRecord.body;
		else throw new Error("httpCall options.body must be a string");
	}

	if ("headers" in optionRecord) {
		if (optionRecord.headers === undefined) {
			parsed.headers = undefined;
		} else if (
			typeof optionRecord.headers === "object" &&
			!Array.isArray(optionRecord.headers) &&
			optionRecord.headers !== null
		) {
			const headerRecord = optionRecord.headers as Record<string, unknown>;
			const headers: Record<string, string> = {};
			for (const key of Object.keys(headerRecord)) {
				const value = headerRecord[key];
				if (typeof value !== "string") {
					throw new Error("httpCall headers must be string values");
				}
				headers[key] = value;
			}
			parsed.headers = headers;
		} else {
			throw new Error("httpCall options.headers must be an object");
		}
	}

	return parsed;
};

const isConfigKey = (key: string): key is keyof Config =>
	Object.hasOwn(config, key);

export const getAppConfigValue = (key: unknown): ConfigValueResult => {
	if (typeof key !== "string" || !key.trim())
		return apiFailure("getAppConfigValue expects a non-empty key string");

	const trimmedKey = key.trim();
	if (!isConfigKey(trimmedKey))
		return apiFailure(`Config key "${trimmedKey}" does not exist`);

	return apiSuccess(config[trimmedKey]);
};

export const getUserConfigValue = (key: unknown): ConfigValueResult => {
	if (typeof key !== "string" || !key.trim())
		return apiFailure("getUserConfigValue expects a non-empty key string");

	const trimmedKey = key.trim();
	if (trimmedKey === "pageSize") return apiSuccess(20);

	return apiFailure(`User config key "${trimmedKey}" does not exist`);
};

export const httpCall = async (
	method: unknown,
	url: unknown,
	options?: unknown,
): Promise<HttpCallResult> => {
	if (typeof method !== "string" || !method.trim())
		return apiFailure("httpCall expects a non-empty method string");

	if (typeof url !== "string" || !url.trim())
		return apiFailure("httpCall expects a non-empty URL string");

	let requestUrl: URL;
	try {
		requestUrl = new URL(url);
	} catch {
		return apiFailure("httpCall URL is invalid");
	}

	let parsedOptions: HttpCallOptions;
	try {
		parsedOptions = parseHttpCallOptions(options);
	} catch (error) {
		return apiFailure(
			error instanceof Error ? error.message : "httpCall options are invalid",
		);
	}

	try {
		const response = await fetch(requestUrl.toString(), {
			body: parsedOptions.body,
			headers: parsedOptions.headers,
			method: method.trim().toUpperCase(),
			signal: AbortSignal.timeout(httpCallTimeoutMs),
		});

		const responseBody = await response.text();
		if (!response.ok)
			return {
				...apiFailure(`HTTP ${response.status} ${response.statusText}`),
				data: { status: response.status },
			};

		return apiSuccess({
			body: responseBody,
			status: response.status,
			statusText: response.statusText,
			headers: mapHeadersToObject(response.headers),
		});
	} catch (error) {
		return apiFailure(
			error instanceof Error ? error.message : "httpCall failed",
		);
	}
};
