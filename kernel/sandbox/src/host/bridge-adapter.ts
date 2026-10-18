import { UploadFailureReason } from "@ryot-app/contract/modules/assets/schemas";
import {
	EntityBadRequest,
	EntityNotFound,
	EntityStale,
} from "@ryot-app/contract/modules/entities/schemas";
import {
	EntityUserDataBadRequest,
	EntityUserDataNotFound,
} from "@ryot-app/contract/modules/entity-user-data/schemas";
import {
	EventBadRequest,
	EventNotFound,
	EventStale,
} from "@ryot-app/contract/modules/events/schemas";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { SandboxBoundaryReason } from "@ryot-app/contract/modules/scripts/boundary-reason";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	automationSandboxHostContracts,
	coreSandboxHostContracts,
	domainSandboxHostContracts,
	type SandboxHostImplementationMap,
} from "@ryot-app/plugin-backend-sdk/core";
import { hostFailure, hostSuccess, type SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { Effect, Schema, SchemaIssue } from "effect";

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
	const encode = Schema.encodeSync(schema);
	return (error: SandboxHostError) => {
		const decoded = decode(error.data);
		return hostFailure(
			error.message,
			decoded._tag === "Success" ? encode(decoded.success) : undefined,
		);
	};
};

const preserveSandboxBoundaryFailure = preserveFailure(SandboxBoundaryReason);

const preserveHttpFailureDetails = (error: SandboxHostError) =>
	hostFailure(error.message, error.data);

const preserveWriteFailure = preserveFailure(
	Schema.Union([
		SandboxBoundaryReason,
		EventBadRequest.fields.reason,
		EventNotFound.fields.reason,
		EventStale.fields.reason,
		EntityStale.fields.reason,
		EntityBadRequest.fields.reason,
		EntityNotFound.fields.reason,
		EntityUserDataBadRequest.fields.reason,
		EntityUserDataNotFound.fields.reason,
		RelationshipBadRequest.fields.reason,
		RelationshipNotFound.fields.reason,
	]),
);

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
		sendNotification: bind(
			"sendNotification",
			automationSandboxHostContracts.sendNotification,
			implementations.sendNotification,
		),
		updateUserSettings: bind(
			"updateUserSettings",
			coreSandboxHostContracts.updateUserSettings,
			implementations.updateUserSettings,
		),
		getUserPreferences: bind(
			"getUserPreferences",
			coreSandboxHostContracts.getUserPreferences,
			implementations.getUserPreferences,
		),
		getProAvailability: bind(
			"getProAvailability",
			coreSandboxHostContracts.getProAvailability,
			implementations.getProAvailability,
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
		updateEvents: bind(
			"updateEvents",
			domainSandboxHostContracts.updateEvents,
			implementations.updateEvents,
			{ failure: preserveWriteFailure },
		),
		deleteEvents: bind(
			"deleteEvents",
			domainSandboxHostContracts.deleteEvents,
			implementations.deleteEvents,
			{ failure: preserveWriteFailure },
		),
		requestEventStreamWork: bind(
			"requestEventStreamWork",
			domainSandboxHostContracts.requestEventStreamWork,
			implementations.requestEventStreamWork,
		),
		executeRyotql: bind(
			"executeRyotql",
			domainSandboxHostContracts.executeRyotql,
			implementations.executeRyotql,
			{ failure: preserveHttpFailureDetails },
		),
		requestUserWork: bind(
			"requestUserWork",
			domainSandboxHostContracts.requestUserWork,
			implementations.requestUserWork,
			{ failure: preserveWriteFailure },
		),
		upsertGlobalRelationships: bind(
			"upsertGlobalRelationships",
			domainSandboxHostContracts.upsertGlobalRelationships,
			implementations.upsertGlobalRelationships,
		),
		createUserEntity: bind(
			"createUserEntity",
			domainSandboxHostContracts.createUserEntity,
			implementations.createUserEntity,
			{ failure: preserveWriteFailure },
		),
		deleteUserEntity: bind(
			"deleteUserEntity",
			domainSandboxHostContracts.deleteUserEntity,
			implementations.deleteUserEntity,
			{ failure: preserveWriteFailure },
		),
		updateUserEntity: bind(
			"updateUserEntity",
			domainSandboxHostContracts.updateUserEntity,
			implementations.updateUserEntity,
			{ failure: preserveWriteFailure },
		),
		invalidateOAuthAccessToken: bind(
			"invalidateOAuthAccessToken",
			domainSandboxHostContracts.invalidateOAuthAccessToken,
			implementations.invalidateOAuthAccessToken,
		),
		commitUserChanges: bind(
			"commitUserChanges",
			domainSandboxHostContracts.commitUserChanges,
			implementations.commitUserChanges,
			{ failure: preserveWriteFailure },
		),
		verifyManagedAssets: bind(
			"verifyManagedAssets",
			coreSandboxHostContracts.verifyManagedAssets,
			implementations.verifyManagedAssets,
			{ failure: preserveAssetFailure },
		),
		mergeUserEntityData: bind(
			"mergeUserEntityData",
			domainSandboxHostContracts.mergeUserEntityData,
			implementations.mergeUserEntityData,
			{ failure: preserveWriteFailure },
		),
		clearUserEntityData: bind(
			"clearUserEntityData",
			domainSandboxHostContracts.clearUserEntityData,
			implementations.clearUserEntityData,
			{ failure: preserveWriteFailure },
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
		changeUserRelationships: bind(
			"changeUserRelationships",
			domainSandboxHostContracts.changeUserRelationships,
			implementations.changeUserRelationships,
			{ failure: preserveWriteFailure },
		),
	};
};
