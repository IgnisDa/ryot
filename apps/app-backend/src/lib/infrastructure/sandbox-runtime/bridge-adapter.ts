import {
	automationSandboxHostContracts,
	coreSandboxHostContracts,
	domainSandboxHostContracts,
	type SandboxHostError,
} from "@ryot/sandbox-sdk/core";
import { Effect, ParseResult, Schema } from "effect";

import {
	apiFailure,
	apiSuccess,
	type BoundHostFunction,
	type SandboxHostImplementationMap,
	type SandboxRunInput,
} from "./shared";

type HostFailure = ReturnType<typeof apiFailure>;

const parseIssues = (error: ParseResult.ParseError) =>
	ParseResult.ArrayFormatter.formatErrorSync(error);

const hasInvalidArgumentCount = (error: ParseResult.ParseError) =>
	parseIssues(error).some(
		(issue) =>
			issue.path.length === 1 &&
			typeof issue.path[0] === "number" &&
			(issue._tag === "Missing" || issue._tag === "Unexpected"),
	);

const invalidArguments = (fnName: string, error: ParseResult.ParseError, message: string) =>
	hasInvalidArgumentCount(error)
		? apiFailure(`${fnName} received an invalid number of arguments`)
		: apiFailure(message);

const invalidHttpCallArguments = (error: ParseResult.ParseError) => {
	if (hasInvalidArgumentCount(error)) {
		return apiFailure("httpCall received an invalid number of arguments");
	}

	const issue = parseIssues(error)[0];
	const [position, field] = issue?.path ?? [];
	if (position === 0) {
		return apiFailure("httpCall expects a non-empty method string");
	}
	if (position === 1) {
		return apiFailure("httpCall expects a non-empty URL string");
	}
	if (position === 2 && issue?._tag === "Unexpected") {
		return apiFailure(`httpCall options.${String(field ?? "value")} is not supported`);
	}
	if (position === 2 && field === "body") {
		return apiFailure("httpCall options.body must be a string");
	}
	if (position === 2 && field === "headers") {
		return apiFailure(
			(issue?.path.length ?? 0) > 2
				? "httpCall headers must be string values"
				: "httpCall options.headers must be an object",
		);
	}

	return apiFailure("httpCall options must be an object");
};

const normalizeOptionalNull = (args: ReadonlyArray<unknown>, index: number) => {
	if (args[index] !== null) {
		return args;
	}
	if (args.length === index + 1) {
		return args.slice(0, index);
	}

	const normalized = [...args];
	normalized[index] = undefined;
	return normalized;
};

type HostContract = {
	readonly args: Schema.Schema.AnyNoContext;
	readonly result: Schema.Schema.AnyNoContext;
};

type ContractArgs<Contract extends HostContract> =
	Schema.Schema.Type<Contract["args"]> extends ReadonlyArray<unknown>
		? Schema.Schema.Type<Contract["args"]>
		: never;

const bindHostFunction =
	<Contract extends HostContract, Success>(
		contract: Contract,
		implementation: (...args: ContractArgs<Contract>) => Effect.Effect<Success, SandboxHostError>,
		invalid: (error: ParseResult.ParseError) => HostFailure,
		normalize: (args: ReadonlyArray<unknown>) => ReadonlyArray<unknown> = (args) => args,
		failure: (error: SandboxHostError) => unknown = (error) => apiFailure(error.message),
	): BoundHostFunction =>
	(args) =>
		Schema.decodeUnknown(contract.args)(normalize(args)).pipe(
			Effect.matchEffect({
				onFailure: (error) => Effect.succeed(invalid(error)),
				onSuccess: (parsed) =>
					implementation(...parsed).pipe(
						Effect.match({ onFailure: failure, onSuccess: apiSuccess }),
					),
			}),
			Effect.flatMap(Schema.encodeUnknown(contract.result)),
		);

const defaultFailure = (fnName: string, message: string) => (error: ParseResult.ParseError) =>
	invalidArguments(fnName, error, message);

const preserveHttpFailureDetails = (error: SandboxHostError) =>
	"data" in error ? { ...apiFailure(error.message), data: error.data } : apiFailure(error.message);

export const bindSandboxHostFunctions = (
	implementations: SandboxHostImplementationMap,
	input: SandboxRunInput,
): Record<keyof SandboxHostImplementationMap, BoundHostFunction> => ({
	emitSignal: bindHostFunction(
		automationSandboxHostContracts.emitSignal,
		(...args) => implementations.emitSignal(input, ...args),
		defaultFailure("emitSignal", "emitSignal expects a valid signal request"),
	),
	getEntity: bindHostFunction(
		domainSandboxHostContracts.getEntity,
		(...args) => implementations.getEntity(input, ...args),
		defaultFailure("getEntity", "getEntity expects a non-empty entityId string"),
	),
	getEntitySchema: bindHostFunction(
		domainSandboxHostContracts.getEntitySchema,
		(...args) => implementations.getEntitySchema(input, ...args),
		defaultFailure(
			"getEntitySchema",
			"getEntitySchema expects a non-empty entitySchemaSlug string",
		),
	),
	getIntegration: bindHostFunction(
		domainSandboxHostContracts.getIntegration,
		(...args) => implementations.getIntegration(input, ...args),
		defaultFailure("getIntegration", "getIntegration expects a non-empty integrationId string"),
	),
	listEventSchemas: bindHostFunction(
		domainSandboxHostContracts.listEventSchemas,
		(...args) => implementations.listEventSchemas(input, ...args),
		defaultFailure(
			"listEventSchemas",
			"listEventSchemas expects a non-empty entitySchemaSlug string",
		),
	),
	listEvents: bindHostFunction(
		domainSandboxHostContracts.listEvents,
		(...args) => implementations.listEvents(input, ...args),
		defaultFailure("listEvents", "listEvents received invalid query options"),
		(args) => normalizeOptionalNull(args, 0),
	),
	listIntegrations: bindHostFunction(
		domainSandboxHostContracts.listIntegrations,
		(...args) => implementations.listIntegrations(input, ...args),
		defaultFailure("listIntegrations", "listIntegrations received invalid options"),
		(args) => normalizeOptionalNull(args, 0),
	),
	createEvents: bindHostFunction(
		domainSandboxHostContracts.createEvents,
		(...args) => implementations.createEvents(input, ...args),
		defaultFailure("createEvents", "createEvents expects an array of event items"),
	),
	upsertGlobalEntities: bindHostFunction(
		domainSandboxHostContracts.upsertGlobalEntities,
		(...args) => implementations.upsertGlobalEntities(input, ...args),
		defaultFailure(
			"upsertGlobalEntities",
			"upsertGlobalEntities expects an array of valid entity items",
		),
	),
	executeQueryEngine: bindHostFunction(
		domainSandboxHostContracts.executeQueryEngine,
		(...args) => implementations.executeQueryEngine(input, ...args),
		defaultFailure("executeQueryEngine", "executeQueryEngine expects a JSON query document"),
	),
	upsertGlobalRelationships: bindHostFunction(
		domainSandboxHostContracts.upsertGlobalRelationships,
		(...args) => implementations.upsertGlobalRelationships(input, ...args),
		defaultFailure(
			"upsertGlobalRelationships",
			"upsertGlobalRelationships expects an array of valid reconciliation groups",
		),
	),
	getCachedValue: bindHostFunction(
		coreSandboxHostContracts.getCachedValue,
		(...args) => implementations.getCachedValue(input, ...args),
		defaultFailure("getCachedValue", "getCachedValue expects a non-empty key string"),
	),
	log: bindHostFunction(
		coreSandboxHostContracts.log,
		(...args) => implementations.log(input, ...args),
		defaultFailure("log", "log expects an array of valid log entries"),
	),
	span: bindHostFunction(
		coreSandboxHostContracts.span,
		(...args) => implementations.span(input, ...args),
		defaultFailure("span", "span expects an array of valid span entries"),
	),
	httpCall: bindHostFunction(
		coreSandboxHostContracts.httpCall,
		(...args) => implementations.httpCall(input, ...args),
		invalidHttpCallArguments,
		(args) => normalizeOptionalNull(args, 2),
		preserveHttpFailureDetails,
	),
	setCachedValue: bindHostFunction(
		coreSandboxHostContracts.setCachedValue,
		(...args) => implementations.setCachedValue(input, ...args),
		(error) => {
			const position = parseIssues(error)[0]?.path[0];
			let message = "setCachedValue expects a positive integer expiry in seconds";
			if (position === 0) {
				message = "setCachedValue expects a non-empty key string";
			} else if (position === 1) {
				message = "setCachedValue value must be JSON-serializable";
			}
			return invalidArguments("setCachedValue", error, message);
		},
	),
	claimCachedValue: bindHostFunction(
		coreSandboxHostContracts.claimCachedValue,
		(...args) => implementations.claimCachedValue(input, ...args),
		(error) => {
			const position = parseIssues(error)[0]?.path[0];
			let message = "claimCachedValue expects a positive integer ttlSeconds";
			if (position === 0) {
				message = "claimCachedValue expects a non-empty key string";
			} else if (position === 1) {
				message = "claimCachedValue value must be JSON-serializable";
			}
			return invalidArguments("claimCachedValue", error, message);
		},
	),
	getAppConfigValue: bindHostFunction(
		coreSandboxHostContracts.getAppConfigValue,
		(...args) => implementations.getAppConfigValue(input, ...args),
		defaultFailure("getAppConfigValue", "getAppConfigValue expects a non-empty key string"),
	),
	getUserPreferences: bindHostFunction(
		coreSandboxHostContracts.getUserPreferences,
		(...args) => implementations.getUserPreferences(input, ...args),
		defaultFailure("getUserPreferences", "getUserPreferences received invalid arguments"),
	),
	sendNotification: bindHostFunction(
		automationSandboxHostContracts.sendNotification,
		(...args) => implementations.sendNotification(input, ...args),
		defaultFailure("sendNotification", "sendNotification expects a non-empty message string"),
	),
});
