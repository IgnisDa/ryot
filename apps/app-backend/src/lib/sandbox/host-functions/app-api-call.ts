import { executeInternalAppRequest } from "~/app/internal-request";
import {
	type AppApiCallOptions,
	type AppApiCallResult,
	apiFailure,
	apiSuccess,
	type HostFunction,
} from "~/lib/sandbox/types";

type AppApiCallContext = {
	userId: string;
};

const forbiddenHeaders = new Set(["authorization", "cookie", "x-api-key"]);

const validMethods = new Set([
	"GET",
	"PUT",
	"POST",
	"HEAD",
	"PATCH",
	"DELETE",
	"OPTIONS",
]);

const parseAppApiCallOptions = (options: unknown) => {
	if (options === undefined || options === null) {
		return {};
	}

	if (typeof options !== "object" || Array.isArray(options)) {
		throw new Error("appApiCall options must be an object");
	}

	const parsed: AppApiCallOptions = {};
	const optionRecord = options as Record<string, unknown>;

	if ("body" in optionRecord) {
		parsed.body = optionRecord.body;
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
					throw new Error("appApiCall headers must be string values");
				}

				if (forbiddenHeaders.has(key.trim().toLowerCase())) {
					throw new Error(`appApiCall does not allow the '${key}' header`);
				}

				headers[key] = value;
			}

			parsed.headers = headers;
		} else {
			throw new Error("appApiCall options.headers must be an object");
		}
	}

	return parsed;
};

const mapHeadersToObject = (headers: Headers) => {
	const headerObject: Record<string, string> = {};
	for (const [key, value] of headers.entries()) {
		headerObject[key] = value;
	}

	return headerObject;
};

const parseResponseBody = async (response: Response) => {
	const responseBody = await response.text();
	if (!responseBody) {
		return null;
	}

	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		try {
			return JSON.parse(responseBody) as unknown;
		} catch {
			return responseBody;
		}
	}

	return responseBody;
};

export const createAppApiCallHostFunction = (
	executeRequest: typeof executeInternalAppRequest = executeInternalAppRequest,
): HostFunction<AppApiCallContext> => {
	return async (
		context,
		method: unknown,
		path: unknown,
		options?: unknown,
	): Promise<AppApiCallResult> => {
		if (typeof context.userId !== "string" || !context.userId.trim()) {
			return apiFailure("appApiCall requires a non-empty userId in context");
		}

		if (typeof method !== "string" || !method.trim()) {
			return apiFailure("appApiCall expects a non-empty method string");
		}

		if (typeof path !== "string" || !path.trim()) {
			return apiFailure("appApiCall expects a non-empty path string");
		}

		const normalizedMethod = method.trim().toUpperCase();
		if (!validMethods.has(normalizedMethod)) {
			return apiFailure(`appApiCall method '${method}' is not supported`);
		}

		let parsedOptions: AppApiCallOptions;
		try {
			parsedOptions = parseAppApiCallOptions(options);
		} catch (error) {
			return apiFailure(
				error instanceof Error
					? error.message
					: "appApiCall options are invalid",
			);
		}

		try {
			const response = await executeRequest({
				path,
				userId: context.userId,
				body: parsedOptions.body,
				method: normalizedMethod,
				headers: parsedOptions.headers,
			});
			const body = await parseResponseBody(response);
			const headers = mapHeadersToObject(response.headers);

			if (!response.ok) {
				return {
					...apiFailure(`HTTP ${response.status} ${response.statusText}`),
					data: { body, headers, status: response.status },
				};
			}

			return apiSuccess({
				body,
				headers,
				status: response.status,
				statusText: response.statusText,
			});
		} catch (error) {
			return apiFailure(
				error instanceof Error ? error.message : "appApiCall failed",
			);
		}
	};
};

export const appApiCall = createAppApiCallHostFunction();
