import { UploadFailureReason } from "@ryot-app/contract/modules/assets/schemas";
import { SandboxBoundaryReason } from "@ryot-app/contract/modules/scripts/boundary-reason";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	coreSandboxHostContracts,
	domainSandboxHostContracts,
	type SandboxHostImplementationMap,
} from "@ryot-app/plugin-backend-sdk/core";
import { hostFailure, hostSuccess, type SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { Effect, Result, Schema, SchemaIssue } from "effect";

import type { BoundHostFunction, SandboxRunInput } from "./invocation";

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
	readonly result: Schema.ConstraintCodec<Result, unknown>;
	readonly args: Schema.ConstraintCodec<Readonly<Args>, unknown>;
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

const preserveFailure = <Reason>(schema: Schema.Codec<Reason, JsonValue>) => {
	const decode = Schema.decodeUnknownResult(schema);
	const encode = Schema.encodeResult(schema);
	return (error: SandboxHostError) =>
		hostFailure(error.message, Result.getOrUndefined(Result.flatMap(decode(error.data), encode)));
};

const preserveSandboxBoundaryFailure = preserveFailure(SandboxBoundaryReason);

const preserveHttpFailureDetails = (error: SandboxHostError) =>
	hostFailure(error.message, error.data);

const preserveAssetFailure = preserveFailure(
	Schema.Union([SandboxBoundaryReason, UploadFailureReason]),
);

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
	implementations: Pick<SandboxHostImplementationMap<SandboxRunInput>, "log" | "span">,
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
	implementations: Omit<SandboxHostImplementationMap<Input>, "log" | "span">,
	input: Input,
): Record<
	Exclude<keyof SandboxHostImplementationMap<Input>, "log" | "span">,
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
		getEntitlements: bind(
			"getEntitlements",
			coreSandboxHostContracts.getEntitlements,
			implementations.getEntitlements,
		),
		invokeCapability: bind(
			"invokeCapability",
			domainSandboxHostContracts.invokeCapability,
			implementations.invokeCapability,
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
		getCurrentIntegration: bind(
			"getCurrentIntegration",
			domainSandboxHostContracts.getCurrentIntegration,
			implementations.getCurrentIntegration,
		),
		executeRyotql: bind(
			"executeRyotql",
			domainSandboxHostContracts.executeRyotql,
			implementations.executeRyotql,
			{ failure: preserveHttpFailureDetails },
		),
		invalidateOAuthAccessToken: bind(
			"invalidateOAuthAccessToken",
			domainSandboxHostContracts.invalidateOAuthAccessToken,
			implementations.invalidateOAuthAccessToken,
		),
		verifyManagedAssets: bind(
			"verifyManagedAssets",
			coreSandboxHostContracts.verifyManagedAssets,
			implementations.verifyManagedAssets,
			{ failure: preserveAssetFailure },
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
