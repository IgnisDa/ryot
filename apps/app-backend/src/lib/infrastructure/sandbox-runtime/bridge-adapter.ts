import {
	automationSandboxHostContracts,
	coreSandboxHostContracts,
	domainSandboxHostContracts,
} from "@ryot/sandbox-sdk";
import type * as z from "@ryot/sandbox-sdk/zod";

import {
	apiFailure,
	type BoundHostFunction,
	type SandboxHostImplementationMap,
	type SandboxRunInput,
} from "./shared";

const invalidArgumentCount = (fnName: string) =>
	Promise.resolve(apiFailure(`${fnName} received an invalid number of arguments`));

const hasInvalidArgumentCount = (error: z.ZodError) =>
	error.issues.some(
		(issue) => issue.path.length === 0 && (issue.code === "too_big" || issue.code === "too_small"),
	);

const invalidArguments = (fnName: string, error: z.ZodError, message: string) =>
	hasInvalidArgumentCount(error)
		? invalidArgumentCount(fnName)
		: Promise.resolve(apiFailure(message));

const invalidHttpCallArguments = (error: z.ZodError) => {
	if (hasInvalidArgumentCount(error)) {
		return invalidArgumentCount("httpCall");
	}

	const issue = error.issues[0];
	const [position, field] = issue?.path ?? [];
	if (position === 0) {
		return Promise.resolve(apiFailure("httpCall expects a non-empty method string"));
	}
	if (position === 1) {
		return Promise.resolve(apiFailure("httpCall expects a non-empty URL string"));
	}
	if (position === 2 && issue?.code === "unrecognized_keys") {
		return Promise.resolve(
			apiFailure(`httpCall options.${issue.keys[0] ?? "value"} is not supported`),
		);
	}
	if (position === 2 && field === "body") {
		return Promise.resolve(apiFailure("httpCall options.body must be a string"));
	}
	if (position === 2 && field === "headers") {
		return Promise.resolve(
			apiFailure(
				(issue?.path.length ?? 0) > 2
					? "httpCall headers must be string values"
					: "httpCall options.headers must be an object",
			),
		);
	}

	return Promise.resolve(apiFailure("httpCall options must be an object"));
};

const normalizeOptionalNull = (args: ReadonlyArray<unknown>, index: number) => {
	if (args[index] !== null) {
		return args;
	}

	const normalized = [...args];
	normalized[index] = undefined;
	return normalized;
};

export const bindSandboxHostFunctions = (
	implementations: SandboxHostImplementationMap,
	input: SandboxRunInput,
): Record<keyof SandboxHostImplementationMap, BoundHostFunction> => ({
	emitSignal: (args) => {
		const parsed = automationSandboxHostContracts.emitSignal.args.safeParse(args);
		return parsed.success
			? implementations.emitSignal(input, ...parsed.data)
			: invalidArguments("emitSignal", parsed.error, "emitSignal expects a valid signal request");
	},
	getEntity: (args) => {
		const parsed = domainSandboxHostContracts.getEntity.args.safeParse(args);
		return parsed.success
			? implementations.getEntity(input, ...parsed.data)
			: invalidArguments(
					"getEntity",
					parsed.error,
					"getEntity expects a non-empty entityId string",
				);
	},
	getEntitySchema: (args) => {
		const parsed = domainSandboxHostContracts.getEntitySchema.args.safeParse(args);
		return parsed.success
			? implementations.getEntitySchema(input, ...parsed.data)
			: invalidArguments(
					"getEntitySchema",
					parsed.error,
					"getEntitySchema expects a non-empty entitySchemaId string",
				);
	},
	getIntegration: (args) => {
		const parsed = domainSandboxHostContracts.getIntegration.args.safeParse(args);
		return parsed.success
			? implementations.getIntegration(input, ...parsed.data)
			: invalidArguments(
					"getIntegration",
					parsed.error,
					"getIntegration expects a non-empty integrationId string",
				);
	},
	listEventSchemas: (args) => {
		const parsed = domainSandboxHostContracts.listEventSchemas.args.safeParse(args);
		return parsed.success
			? implementations.listEventSchemas(input, ...parsed.data)
			: invalidArguments(
					"listEventSchemas",
					parsed.error,
					"listEventSchemas expects a non-empty entitySchemaId string",
				);
	},
	listEvents: (args) => {
		const parsed = domainSandboxHostContracts.listEvents.args.safeParse(
			normalizeOptionalNull(args, 0),
		);
		return parsed.success
			? implementations.listEvents(input, ...parsed.data)
			: invalidArguments("listEvents", parsed.error, "listEvents received invalid query options");
	},
	listIntegrations: (args) => {
		const parsed = domainSandboxHostContracts.listIntegrations.args.safeParse(
			normalizeOptionalNull(args, 0),
		);
		return parsed.success
			? implementations.listIntegrations(input, ...parsed.data)
			: invalidArguments(
					"listIntegrations",
					parsed.error,
					"listIntegrations received invalid options",
				);
	},
	createEvents: (args) => {
		const parsed = domainSandboxHostContracts.createEvents.args.safeParse(args);
		return parsed.success
			? implementations.createEvents(input, ...parsed.data)
			: invalidArguments(
					"createEvents",
					parsed.error,
					"createEvents expects an array of event items",
				);
	},
	executeQueryEngine: (args) => {
		const parsed = domainSandboxHostContracts.executeQueryEngine.args.safeParse(args);
		return parsed.success
			? implementations.executeQueryEngine(input, ...parsed.data)
			: invalidArguments(
					"executeQueryEngine",
					parsed.error,
					"executeQueryEngine expects a JSON query document",
				);
	},
	getCachedValue: (args) => {
		const parsed = coreSandboxHostContracts.getCachedValue.args.safeParse(args);
		return parsed.success
			? implementations.getCachedValue(input, ...parsed.data)
			: invalidArguments(
					"getCachedValue",
					parsed.error,
					"getCachedValue expects a non-empty key string",
				);
	},
	httpCall: (args) => {
		const parsed = coreSandboxHostContracts.httpCall.args.safeParse(normalizeOptionalNull(args, 2));
		return parsed.success
			? implementations.httpCall(input, ...parsed.data)
			: invalidHttpCallArguments(parsed.error);
	},
	setCachedValue: (args) => {
		const parsed = coreSandboxHostContracts.setCachedValue.args.safeParse(args);
		if (parsed.success) {
			return implementations.setCachedValue(input, ...parsed.data);
		}

		const position = parsed.error.issues[0]?.path[0];
		let message = "setCachedValue expects a positive integer expiry in seconds";
		if (position === 0) {
			message = "setCachedValue expects a non-empty key string";
		} else if (position === 1) {
			message = "setCachedValue value must be JSON-serializable";
		}
		return invalidArguments("setCachedValue", parsed.error, message);
	},
	claimCachedValue: (args) => {
		const parsed = coreSandboxHostContracts.claimCachedValue.args.safeParse(args);
		if (parsed.success) {
			return implementations.claimCachedValue(input, ...parsed.data);
		}

		const position = parsed.error.issues[0]?.path[0];
		let message = "claimCachedValue expects a positive integer ttlSeconds";
		if (position === 0) {
			message = "claimCachedValue expects a non-empty key string";
		} else if (position === 1) {
			message = "claimCachedValue value must be JSON-serializable";
		}
		return invalidArguments("claimCachedValue", parsed.error, message);
	},
	getAppConfigValue: (args) => {
		const parsed = coreSandboxHostContracts.getAppConfigValue.args.safeParse(args);
		return parsed.success
			? implementations.getAppConfigValue(input, ...parsed.data)
			: invalidArguments(
					"getAppConfigValue",
					parsed.error,
					"getAppConfigValue expects a non-empty key string",
				);
	},
	getUserPreferences: (args) => {
		const parsed = coreSandboxHostContracts.getUserPreferences.args.safeParse(args);
		return parsed.success
			? implementations.getUserPreferences(input, ...parsed.data)
			: invalidArguments(
					"getUserPreferences",
					parsed.error,
					"getUserPreferences received invalid arguments",
				);
	},
	sendNotification: (args) => {
		const parsed = automationSandboxHostContracts.sendNotification.args.safeParse(args);
		return parsed.success
			? implementations.sendNotification(input, ...parsed.data)
			: invalidArguments(
					"sendNotification",
					parsed.error,
					"sendNotification expects a non-empty message string",
				);
	},
});
