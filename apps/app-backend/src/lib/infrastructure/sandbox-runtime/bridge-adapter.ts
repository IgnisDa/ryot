import {
	automationSandboxHostContracts,
	coreSandboxHostContracts,
	domainSandboxHostContracts,
} from "@ryot/sandbox-sdk/core";
import { hostFailure, hostSuccess, type SandboxHostError } from "@ryot/sandbox-sdk/wire";
import { Effect, Schema, SchemaIssue } from "effect";

import {
	type BoundHostFunction,
	type SandboxHostImplementationMap,
	type SandboxRunInput,
} from "./shared";

type HostFailure = ReturnType<typeof hostFailure>;

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

const formatSchemaError = (error: Schema.SchemaError) =>
	parseIssues(error)
		.map((issue) => {
			const path = (issue.path ?? []).map(pathKey).join(".");
			return path ? `${path}: ${issue.message}` : issue.message;
		})
		.join("; ") || "Invalid arguments";

const invalidArguments = (fnName: string, error: Schema.SchemaError) =>
	hostFailure(
		hasInvalidArgumentCount(error)
			? `${fnName} received an invalid number of arguments`
			: formatSchemaError(error),
	);

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
		failure: (error: SandboxHostError) => unknown = (error) => hostFailure(error.message),
	): BoundHostFunction =>
	(args) =>
		Schema.decodeUnknownEffect(contract.args)(normalize(args)).pipe(
			Effect.matchEffect({
				onFailure: (error) => Effect.succeed(invalid(error)),
				onSuccess: (parsed) =>
					implementation(...parsed).pipe(
						Effect.match({ onFailure: failure, onSuccess: hostSuccess }),
					),
			}),
			Effect.flatMap(Schema.encodeUnknownEffect(contract.result)),
		);

const defaultFailure = (fnName: string) => (error: Schema.SchemaError) =>
	invalidArguments(fnName, error);

const preserveHttpFailureDetails = (error: SandboxHostError) =>
	hostFailure(error.message, error.data);

export const bindSandboxHostFunctions = (
	implementations: SandboxHostImplementationMap,
	input: SandboxRunInput,
): Record<keyof SandboxHostImplementationMap, BoundHostFunction> => ({
	emitSignal: bindHostFunction(
		automationSandboxHostContracts.emitSignal,
		(...args) => implementations.emitSignal(input, ...args),
		defaultFailure("emitSignal"),
	),
	getEntitySchemas: bindHostFunction(
		domainSandboxHostContracts.getEntitySchemas,
		(...args) => implementations.getEntitySchemas(input, ...args),
		defaultFailure("getEntitySchemas"),
	),
	getCurrentIntegration: bindHostFunction(
		domainSandboxHostContracts.getCurrentIntegration,
		(...args) => implementations.getCurrentIntegration(input, ...args),
		defaultFailure("getCurrentIntegration"),
	),
	listEventSchemas: bindHostFunction(
		domainSandboxHostContracts.listEventSchemas,
		(...args) => implementations.listEventSchemas(input, ...args),
		defaultFailure("listEventSchemas"),
	),
	listIntegrations: bindHostFunction(
		domainSandboxHostContracts.listIntegrations,
		(...args) => implementations.listIntegrations(input, ...args),
		defaultFailure("listIntegrations"),
		(args) => normalizeOptionalNull(args, 0),
	),
	createEvents: bindHostFunction(
		domainSandboxHostContracts.createEvents,
		(...args) => implementations.createEvents(input, ...args),
		defaultFailure("createEvents"),
	),
	changeUserRelationships: bindHostFunction(
		domainSandboxHostContracts.changeUserRelationships,
		(...args) => implementations.changeUserRelationships(input, ...args),
		defaultFailure("changeUserRelationships"),
	),
	ensureUserEntities: bindHostFunction(
		domainSandboxHostContracts.ensureUserEntities,
		(...args) => implementations.ensureUserEntities(input, ...args),
		defaultFailure("ensureUserEntities"),
	),
	upsertGlobalEntities: bindHostFunction(
		domainSandboxHostContracts.upsertGlobalEntities,
		(...args) => implementations.upsertGlobalEntities(input, ...args),
		defaultFailure("upsertGlobalEntities"),
	),
	executeQueryEngine: bindHostFunction(
		domainSandboxHostContracts.executeQueryEngine,
		(...args) => implementations.executeQueryEngine(input, ...args),
		defaultFailure("executeQueryEngine"),
	),
	upsertGlobalRelationships: bindHostFunction(
		domainSandboxHostContracts.upsertGlobalRelationships,
		(...args) => implementations.upsertGlobalRelationships(input, ...args),
		defaultFailure("upsertGlobalRelationships"),
	),
	getCachedValue: bindHostFunction(
		coreSandboxHostContracts.getCachedValue,
		(...args) => implementations.getCachedValue(input, ...args),
		defaultFailure("getCachedValue"),
	),
	log: bindHostFunction(
		coreSandboxHostContracts.log,
		(...args) => implementations.log(input, ...args),
		defaultFailure("log"),
	),
	span: bindHostFunction(
		coreSandboxHostContracts.span,
		(...args) => implementations.span(input, ...args),
		defaultFailure("span"),
	),
	httpCall: bindHostFunction(
		coreSandboxHostContracts.httpCall,
		(...args) => implementations.httpCall(input, ...args),
		defaultFailure("httpCall"),
		(args) => normalizeOptionalNull(args, 2),
		preserveHttpFailureDetails,
	),
	setCachedValue: bindHostFunction(
		coreSandboxHostContracts.setCachedValue,
		(...args) => implementations.setCachedValue(input, ...args),
		defaultFailure("setCachedValue"),
	),
	claimPersistentValue: bindHostFunction(
		coreSandboxHostContracts.claimPersistentValue,
		(...args) => implementations.claimPersistentValue(input, ...args),
		defaultFailure("claimPersistentValue"),
	),
	getPluginConfig: bindHostFunction(
		coreSandboxHostContracts.getPluginConfig,
		(...args) => implementations.getPluginConfig(input, ...args),
		defaultFailure("getPluginConfig"),
	),
	getSystemConfig: bindHostFunction(
		coreSandboxHostContracts.getSystemConfig,
		(...args) => implementations.getSystemConfig(input, ...args),
		defaultFailure("getSystemConfig"),
	),
	getUserPreferences: bindHostFunction(
		coreSandboxHostContracts.getUserPreferences,
		(...args) => implementations.getUserPreferences(input, ...args),
		defaultFailure("getUserPreferences"),
	),
	sendNotification: bindHostFunction(
		automationSandboxHostContracts.sendNotification,
		(...args) => implementations.sendNotification(input, ...args),
		defaultFailure("sendNotification"),
	),
});
