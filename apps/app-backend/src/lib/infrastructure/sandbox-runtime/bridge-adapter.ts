import {
	automationSandboxHostContracts,
	coreSandboxHostContracts,
	domainSandboxHostContracts,
} from "@ryot/sandbox-sdk/core";
import type { SandboxHostError } from "@ryot/sandbox-sdk/wire";
import { Effect, Schema, SchemaIssue } from "effect";

import {
	apiFailure,
	apiSuccess,
	type BoundHostFunction,
	type SandboxHostImplementationMap,
	type SandboxRunInput,
} from "./shared";

type HostFailure = ReturnType<typeof apiFailure>;

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();
const formatArgumentCountIssue = SchemaIssue.makeFormatterStandardSchemaV1({
	checkHook: () => "Filter",
	leafHook: (issue) => issue._tag,
});

const parseIssues = (error: Schema.SchemaError) => formatIssue(error.issue).issues;
const parseIssueTags = (error: Schema.SchemaError) => formatArgumentCountIssue(error.issue).issues;

const pathKey = (
	segment: NonNullable<ReturnType<typeof formatIssue>["issues"][number]["path"]>[number],
) => (typeof segment === "object" ? segment.key : segment);

const hasInvalidArgumentCount = (error: Schema.SchemaError) => {
	const issues = parseIssueTags(error);
	return (
		issues.length > 0 &&
		issues.every((issue) => {
			const [segment] = issue.path ?? [];
			return (
				issue.path?.length === 1 &&
				segment !== undefined &&
				typeof pathKey(segment) === "number" &&
				(issue.message === "MissingKey" || issue.message === "UnexpectedKey")
			);
		})
	);
};

const invalidArguments = (fnName: string, error: Schema.SchemaError, message: string) =>
	hasInvalidArgumentCount(error)
		? apiFailure(`${fnName} received an invalid number of arguments`)
		: apiFailure(message);

const invalidHttpCallArguments = (error: Schema.SchemaError) => {
	if (hasInvalidArgumentCount(error)) {
		return apiFailure("httpCall received an invalid number of arguments");
	}

	const issue = parseIssues(error)[0];
	const [position, field] = issue?.path?.map(pathKey) ?? [];
	if (position === 0) {
		return apiFailure("httpCall expects a non-empty method string");
	}
	if (position === 1) {
		return apiFailure("httpCall expects a non-empty URL string");
	}
	if (position === 2 && parseIssueTags(error)[0]?.message === "UnexpectedKey") {
		return apiFailure(`httpCall options.${String(field ?? "value")} is not supported`);
	}
	if (position === 2 && field === "body") {
		return apiFailure("httpCall options.body must be a string");
	}
	if (position === 2 && field === "headers") {
		return apiFailure(
			(issue?.path?.length ?? 0) > 2
				? "httpCall headers must be string values"
				: "httpCall options.headers must be an object",
		);
	}
	if (position === 2 && field === "allowInsecureConnections") {
		return apiFailure("httpCall options.allowInsecureConnections must be a boolean");
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

type HostContract<Args extends ReadonlyArray<unknown>, Result> = {
	readonly args: Schema.ConstraintCodec<Readonly<Args>, unknown>;
	readonly result: Schema.ConstraintCodec<Result, unknown>;
};

const bindHostFunction =
	<Args extends ReadonlyArray<unknown>, Result, Success>(
		contract: HostContract<Args, Result>,
		implementation: (...args: Args) => Effect.Effect<Success, SandboxHostError>,
		invalid: (error: Schema.SchemaError) => HostFailure,
		normalize: (args: ReadonlyArray<unknown>) => ReadonlyArray<unknown> = (args) => args,
		failure: (error: SandboxHostError) => unknown = (error) => apiFailure(error.message),
	): BoundHostFunction =>
	(args) =>
		Schema.decodeUnknownEffect(contract.args)(normalize(args)).pipe(
			Effect.matchEffect({
				onFailure: (error) => Effect.succeed(invalid(error)),
				onSuccess: (parsed) =>
					implementation(...parsed).pipe(
						Effect.match({ onFailure: failure, onSuccess: apiSuccess }),
					),
			}),
			Effect.flatMap(Schema.encodeUnknownEffect(contract.result)),
		);

const defaultFailure = (fnName: string, message: string) => (error: Schema.SchemaError) =>
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
	getEntitySchemas: bindHostFunction(
		domainSandboxHostContracts.getEntitySchemas,
		(...args) => implementations.getEntitySchemas(input, ...args),
		defaultFailure(
			"getEntitySchemas",
			"getEntitySchemas expects an array of non-empty entitySchemaSlug strings",
		),
	),
	getCurrentIntegration: bindHostFunction(
		domainSandboxHostContracts.getCurrentIntegration,
		(...args) => implementations.getCurrentIntegration(input, ...args),
		defaultFailure("getCurrentIntegration", "getCurrentIntegration received invalid arguments"),
	),
	listEventSchemas: bindHostFunction(
		domainSandboxHostContracts.listEventSchemas,
		(...args) => implementations.listEventSchemas(input, ...args),
		defaultFailure(
			"listEventSchemas",
			"listEventSchemas expects an array of non-empty entitySchemaSlug strings",
		),
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
	changeUserRelationships: bindHostFunction(
		domainSandboxHostContracts.changeUserRelationships,
		(...args) => implementations.changeUserRelationships(input, ...args),
		defaultFailure(
			"changeUserRelationships",
			"changeUserRelationships expects an array of valid change batches",
		),
	),
	ensureUserEntities: bindHostFunction(
		domainSandboxHostContracts.ensureUserEntities,
		(...args) => implementations.ensureUserEntities(input, ...args),
		defaultFailure(
			"ensureUserEntities",
			"ensureUserEntities expects an array of valid entity items",
		),
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
			const segment = parseIssues(error)[0]?.path?.[0];
			const position = segment === undefined ? undefined : pathKey(segment);
			let message = "setCachedValue expects a positive integer expiry in seconds";
			if (position === 0) {
				message = "setCachedValue expects a non-empty key string";
			} else if (position === 1) {
				message = "setCachedValue value must be JSON-serializable";
			}
			return invalidArguments("setCachedValue", error, message);
		},
	),
	claimPersistentValue: bindHostFunction(
		coreSandboxHostContracts.claimPersistentValue,
		(...args) => implementations.claimPersistentValue(input, ...args),
		(error) => {
			const segment = parseIssues(error)[0]?.path?.[0];
			const position = segment === undefined ? undefined : pathKey(segment);
			let message = "claimPersistentValue expects a positive integer ttlSeconds";
			if (position === 0) {
				message = "claimPersistentValue expects a non-empty key string";
			} else if (position === 1) {
				message = "claimPersistentValue value must be JSON-serializable";
			}
			return invalidArguments("claimPersistentValue", error, message);
		},
	),
	getPluginConfig: bindHostFunction(
		coreSandboxHostContracts.getPluginConfig,
		(...args) => implementations.getPluginConfig(input, ...args),
		defaultFailure("getPluginConfig", "getPluginConfig expects non-empty key strings"),
	),
	getSystemConfig: bindHostFunction(
		coreSandboxHostContracts.getSystemConfig,
		(...args) => implementations.getSystemConfig(input, ...args),
		defaultFailure("getSystemConfig", "getSystemConfig expects non-empty key strings"),
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
