import type { CoreSandboxHostMethodMap } from "@ryot/sandbox-sdk";
import { isObjectRecord } from "@ryot/ts-utils/predicates";

import {
	apiFailure,
	type BoundHostFunction,
	isJsonValue,
	type SandboxHostImplementationMap,
	type SandboxRunInput,
} from "./shared";

type HttpCallOptions = Parameters<CoreSandboxHostMethodMap["httpCall"]>[2];

type ParsedHttpCallOptions =
	| { readonly error: string; readonly success: false }
	| { readonly value: HttpCallOptions; readonly success: true };

const parseHttpCallOptions = (value: unknown): ParsedHttpCallOptions => {
	if (value === undefined || value === null) {
		return { value: undefined, success: true };
	}
	if (!isObjectRecord(value)) {
		return { error: "httpCall options must be an object", success: false };
	}
	for (const key of Object.keys(value)) {
		if (key !== "body" && key !== "headers") {
			return { error: `httpCall options.${key} is not supported`, success: false };
		}
	}

	const body = value["body"];
	const headersValue = value["headers"];
	if (body !== undefined && typeof body !== "string") {
		return { error: "httpCall options.body must be a string", success: false };
	}
	if (headersValue !== undefined && !isObjectRecord(headersValue)) {
		return { error: "httpCall options.headers must be an object", success: false };
	}

	const headers: Record<string, string> = {};
	for (const [key, headerValue] of Object.entries(headersValue ?? {})) {
		if (typeof headerValue !== "string") {
			return { error: "httpCall headers must be string values", success: false };
		}
		headers[key] = headerValue;
	}

	return {
		success: true,
		value: {
			...(body === undefined ? {} : { body }),
			...(headersValue === undefined ? {} : { headers }),
		},
	};
};

const invalidJsonValue = (fnName: "claimCachedValue" | "setCachedValue") =>
	Promise.resolve(apiFailure(`${fnName} value must be JSON-serializable`));

const invalidArgumentCount = (fnName: string) =>
	Promise.resolve(apiFailure(`${fnName} received an invalid number of arguments`));

export const bindSandboxHostFunctions = (
	implementations: SandboxHostImplementationMap,
	input: SandboxRunInput,
): Record<keyof SandboxHostImplementationMap, BoundHostFunction> => ({
	listEvents: (args) => implementations.listEvents(input, args[0]),
	getEntity: (args) => implementations.getEntity(input, args[0]),
	createEvents: (args) => implementations.createEvents(input, args[0]),
	listIntegrations: (args) => implementations.listIntegrations(input, args[0]),
	getIntegration: (args) => implementations.getIntegration(input, args[0]),
	executeQueryEngine: (args) => implementations.executeQueryEngine(input, args[0]),
	getEntitySchema: (args) => implementations.getEntitySchema(input, args[0]),
	listEventSchemas: (args) => implementations.listEventSchemas(input, args[0]),
	getCachedValue: (args) => {
		if (args.length !== 1) {
			return invalidArgumentCount("getCachedValue");
		}
		const key = args[0];
		return typeof key === "string"
			? implementations.getCachedValue(input, key)
			: Promise.resolve(apiFailure("getCachedValue expects a non-empty key string"));
	},
	httpCall: (args) => {
		if (args.length < 2 || args.length > 3) {
			return invalidArgumentCount("httpCall");
		}
		const method = args[0];
		const url = args[1];
		if (typeof method !== "string" || !method.trim()) {
			return Promise.resolve(apiFailure("httpCall expects a non-empty method string"));
		}
		if (typeof url !== "string" || !url.trim()) {
			return Promise.resolve(apiFailure("httpCall expects a non-empty URL string"));
		}

		const options = parseHttpCallOptions(args[2]);
		return options.success
			? implementations.httpCall(input, method, url, options.value)
			: Promise.resolve(apiFailure(options.error));
	},
	setCachedValue: (args) => {
		if (args.length !== 3) {
			return invalidArgumentCount("setCachedValue");
		}
		const key = args[0];
		const value = args[1];
		const expiry = args[2];
		if (typeof key !== "string") {
			return Promise.resolve(apiFailure("setCachedValue expects a non-empty key string"));
		}
		if (!isJsonValue(value)) {
			return invalidJsonValue("setCachedValue");
		}
		if (typeof expiry !== "number") {
			return Promise.resolve(
				apiFailure("setCachedValue expects a positive integer expiry in seconds"),
			);
		}

		return implementations.setCachedValue(input, key, value, expiry);
	},
	claimCachedValue: (args) => {
		if (args.length !== 3) {
			return invalidArgumentCount("claimCachedValue");
		}
		const key = args[0];
		const value = args[1];
		const ttlSeconds = args[2];
		if (typeof key !== "string") {
			return Promise.resolve(apiFailure("claimCachedValue expects a non-empty key string"));
		}
		if (!isJsonValue(value)) {
			return invalidJsonValue("claimCachedValue");
		}
		if (typeof ttlSeconds !== "number") {
			return Promise.resolve(apiFailure("claimCachedValue expects a positive integer ttlSeconds"));
		}

		return implementations.claimCachedValue(input, key, value, ttlSeconds);
	},
	getAppConfigValue: (args) => {
		if (args.length !== 1) {
			return invalidArgumentCount("getAppConfigValue");
		}
		const key = args[0];
		return typeof key === "string"
			? implementations.getAppConfigValue(input, key)
			: Promise.resolve(apiFailure("getAppConfigValue expects a non-empty key string"));
	},
	getUserPreferences: (args) =>
		args.length === 0
			? implementations.getUserPreferences(input)
			: invalidArgumentCount("getUserPreferences"),
});
