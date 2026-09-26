import { SandboxBoundaryReason } from "@ryot-app/contract/modules/scripts/boundary-reason";
import {
	automationSandboxHostContracts,
	coreSandboxHostContracts,
	domainSandboxHostContracts,
	type SandboxHostImplementationMap as SdkSandboxHostImplementationMap,
} from "@ryot-app/plugin-backend-sdk/core";
import { hostFailure, hostSuccess, type SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { Effect, Schema, SchemaIssue } from "effect";

import type {
	BoundHostFunction,
	SandboxHostImplementationMap,
	SandboxRunInput,
} from "./invocation";

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

const invalidArgumentsMessage = (fnName: string, error: Schema.SchemaError) =>
	hasInvalidArgumentCount(error)
		? `${fnName} received an invalid number of arguments`
		: formatSchemaError(error);

export const normalizeOptionalNull = (args: ReadonlyArray<unknown>, index: number) => {
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

export const decodeSandboxHostArguments =
	<Args extends ReadonlyArray<unknown>, Result>(
		fnName: string,
		contract: HostContract<Args, Result>,
	) =>
	(args: ReadonlyArray<unknown>) =>
		Schema.decodeEffect(contract.args)(args).pipe(
			Effect.mapError((error) => ({ message: invalidArgumentsMessage(fnName, error) })),
		);

type BindOptions = {
	readonly failure?: (error: SandboxHostError) => unknown;
	readonly normalize?: (args: ReadonlyArray<unknown>) => ReadonlyArray<unknown>;
};

const preserveSandboxBoundaryFailure = (error: SandboxHostError) =>
	hostFailure(error.message, Schema.is(SandboxBoundaryReason)(error.data) ? error.data : undefined);

const preserveHttpFailureDetails = (error: SandboxHostError) =>
	hostFailure(error.message, error.data);

const bindHostFunction =
	<Args extends ReadonlyArray<unknown>, Result, Success>(
		fnName: string,
		contract: HostContract<Args, Result>,
		implementation: (...args: Args) => Effect.Effect<Success, SandboxHostError>,
		{ normalize = (args) => args, failure = preserveSandboxBoundaryFailure }: BindOptions = {},
	): BoundHostFunction =>
	(args) =>
		Schema.decodeEffect(contract.args)(normalize(args)).pipe(
			Effect.matchEffect({
				onFailure: (error) => Effect.succeed(hostFailure(invalidArgumentsMessage(fnName, error))),
				onSuccess: (parsed) =>
					implementation(...parsed).pipe(
						Effect.match({ onFailure: failure, onSuccess: hostSuccess }),
					),
			}),
			Effect.flatMap(Schema.encodeUnknownEffect(contract.result)),
		);

export const bindObservabilityHostFunctions = (
	implementations: Pick<SandboxHostImplementationMap, "log" | "span">,
	input: SandboxRunInput,
) => ({
	log: bindHostFunction("log", coreSandboxHostContracts.log, (...args) =>
		implementations.log(input, ...args),
	),
	span: bindHostFunction("span", coreSandboxHostContracts.span, (...args) =>
		implementations.span(input, ...args),
	),
});

export const bindSandboxHostFunctions = <Input>(
	implementations: Omit<SdkSandboxHostImplementationMap<Input>, "log" | "span">,
	input: Input,
): Record<
	Exclude<keyof SdkSandboxHostImplementationMap<Input>, "log" | "span">,
	BoundHostFunction
> => {
	const bind = <Args extends ReadonlyArray<unknown>, Result, Success>(
		fnName: string,
		contract: HostContract<Args, Result>,
		implementation: (context: Input, ...args: Args) => Effect.Effect<Success, SandboxHostError>,
		options?: BindOptions,
	) =>
		bindHostFunction(fnName, contract, (...args: Args) => implementation(input, ...args), options);
	return {
		emitSignal: bind(
			"emitSignal",
			automationSandboxHostContracts.emitSignal,
			implementations.emitSignal,
		),
		createEvents: bind(
			"createEvents",
			domainSandboxHostContracts.createEvents,
			implementations.createEvents,
		),
		updateEvents: bind(
			"updateEvents",
			domainSandboxHostContracts.updateEvents,
			implementations.updateEvents,
		),
		deleteEvents: bind(
			"deleteEvents",
			domainSandboxHostContracts.deleteEvents,
			implementations.deleteEvents,
		),
		getCachedValue: bind(
			"getCachedValue",
			coreSandboxHostContracts.getCachedValue,
			implementations.getCachedValue,
		),
		setCachedValue: bind(
			"setCachedValue",
			coreSandboxHostContracts.setCachedValue,
			implementations.setCachedValue,
		),
		getPluginConfig: bind(
			"getPluginConfig",
			coreSandboxHostContracts.getPluginConfig,
			implementations.getPluginConfig,
		),
		getUserSettings: bind(
			"getUserSettings",
			coreSandboxHostContracts.getUserSettings,
			implementations.getUserSettings,
		),
		getEntitySchemas: bind(
			"getEntitySchemas",
			domainSandboxHostContracts.getEntitySchemas,
			implementations.getEntitySchemas,
		),
		listEventSchemas: bind(
			"listEventSchemas",
			domainSandboxHostContracts.listEventSchemas,
			implementations.listEventSchemas,
		),
		createUserEntity: bind(
			"createUserEntity",
			domainSandboxHostContracts.createUserEntity,
			implementations.createUserEntity,
		),
		sendNotification: bind(
			"sendNotification",
			automationSandboxHostContracts.sendNotification,
			implementations.sendNotification,
		),
		getUserPreferences: bind(
			"getUserPreferences",
			coreSandboxHostContracts.getUserPreferences,
			implementations.getUserPreferences,
		),
		getPersistentValue: bind(
			"getPersistentValue",
			coreSandboxHostContracts.getPersistentValue,
			implementations.getPersistentValue,
		),
		ensureUserEntities: bind(
			"ensureUserEntities",
			domainSandboxHostContracts.ensureUserEntities,
			implementations.ensureUserEntities,
		),
		getOAuthAccessToken: bind(
			"getOAuthAccessToken",
			domainSandboxHostContracts.getOAuthAccessToken,
			implementations.getOAuthAccessToken,
		),
		claimPersistentValue: bind(
			"claimPersistentValue",
			coreSandboxHostContracts.claimPersistentValue,
			implementations.claimPersistentValue,
		),
		upsertGlobalEntities: bind(
			"upsertGlobalEntities",
			domainSandboxHostContracts.upsertGlobalEntities,
			implementations.upsertGlobalEntities,
		),
		getCurrentIntegration: bind(
			"getCurrentIntegration",
			domainSandboxHostContracts.getCurrentIntegration,
			implementations.getCurrentIntegration,
		),
		requestEventStreamWork: bind(
			"requestEventStreamWork",
			domainSandboxHostContracts.requestEventStreamWork,
			implementations.requestEventStreamWork,
		),
		changeUserRelationships: bind(
			"changeUserRelationships",
			domainSandboxHostContracts.changeUserRelationships,
			implementations.changeUserRelationships,
		),
		executeRyotql: bind(
			"executeRyotql",
			domainSandboxHostContracts.executeRyotql,
			implementations.executeRyotql,
			{ failure: preserveHttpFailureDetails },
		),
		upsertGlobalRelationships: bind(
			"upsertGlobalRelationships",
			domainSandboxHostContracts.upsertGlobalRelationships,
			implementations.upsertGlobalRelationships,
		),
		invalidateOAuthAccessToken: bind(
			"invalidateOAuthAccessToken",
			domainSandboxHostContracts.invalidateOAuthAccessToken,
			implementations.invalidateOAuthAccessToken,
		),
		httpCall: bind("httpCall", coreSandboxHostContracts.httpCall, implementations.httpCall, {
			failure: preserveHttpFailureDetails,
			normalize: (args) => normalizeOptionalNull(args, 2),
		}),
		listIntegrations: bind(
			"listIntegrations",
			domainSandboxHostContracts.listIntegrations,
			implementations.listIntegrations,
			{ normalize: (args) => normalizeOptionalNull(args, 0) },
		),
	};
};
