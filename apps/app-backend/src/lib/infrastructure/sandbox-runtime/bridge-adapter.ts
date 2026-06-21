import {
	type CoreSandboxHostMethodMap,
	createEventItemSchema,
	listEventsQuerySchema,
	listIntegrationsOptionsSchema,
} from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";
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
	getEntity: (args) => {
		const entityId = args[0];
		return typeof entityId === "string"
			? implementations.getEntity(input, entityId)
			: Promise.resolve(apiFailure("getEntity expects a non-empty entityId string"));
	},
	getEntitySchema: (args) => {
		const entitySchemaId = args[0];
		return typeof entitySchemaId === "string"
			? implementations.getEntitySchema(input, entitySchemaId)
			: Promise.resolve(apiFailure("getEntitySchema expects a non-empty entitySchemaId string"));
	},
	getIntegration: (args) => {
		const integrationId = args[0];
		return typeof integrationId === "string"
			? implementations.getIntegration(input, integrationId)
			: Promise.resolve(apiFailure("getIntegration expects a non-empty integrationId string"));
	},
	listEventSchemas: (args) => {
		const entitySchemaId = args[0];
		return typeof entitySchemaId === "string"
			? implementations.listEventSchemas(input, entitySchemaId)
			: Promise.resolve(apiFailure("listEventSchemas expects a non-empty entitySchemaId string"));
	},
	listEvents: (args) => {
		const query = listEventsQuerySchema.optional().safeParse(args[0]);
		return query.success
			? implementations.listEvents(input, query.data)
			: Promise.resolve(apiFailure("listEvents received invalid query options"));
	},
	listIntegrations: (args) => {
		const options = listIntegrationsOptionsSchema.optional().safeParse(args[0]);
		return options.success
			? implementations.listIntegrations(input, options.data)
			: Promise.resolve(apiFailure("listIntegrations received invalid options"));
	},
	createEvents: (args) => {
		const items = z.array(createEventItemSchema).safeParse(args[0]);
		return items.success
			? implementations.createEvents(input, items.data)
			: Promise.resolve(apiFailure("createEvents expects an array of event items"));
	},
	executeQueryEngine: (args) => {
		const query = args[0];
		return isJsonValue(query)
			? implementations.executeQueryEngine(input, query)
			: Promise.resolve(apiFailure("executeQueryEngine expects a JSON query document"));
	},
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
