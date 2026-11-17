import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { LocalMessage, Message } from "@ryot-app/i18n/message";
import { Schema } from "effect";

export const BACKGROUND_SUBMISSION_LIMITS = {
	entries: 20,
	inFlightPerService: 8,
	inFlightPerSession: 4,
} as const;

export const BACKGROUND_SUBMISSION_KEY_MAX_LENGTH = 128;

const BackgroundSubmissionIdempotencyKey = Schema.NonEmptyString.pipe(
	Schema.check(Schema.isMaxLength(BACKGROUND_SUBMISSION_KEY_MAX_LENGTH)),
);

export const PluginBackgroundOperationRequest = strictStruct({
	input: JsonValue,
	label: LocalMessage,
	packageId: PluginPackageId,
	submittedAt: Schema.String,
	operationSlug: Schema.String,
	idempotencyKey: BackgroundSubmissionIdempotencyKey,
});

export type PluginBackgroundOperationRequest = Schema.Schema.Type<
	typeof PluginBackgroundOperationRequest
>;

export const PluginBridgeBackgroundOperationRequest = strictStruct({
	...PluginBackgroundOperationRequest.fields,
	requestId: Schema.String,
	type: Schema.Literal("background-operation-request"),
});

export type PluginBridgeBackgroundOperationRequest = Schema.Schema.Type<
	typeof PluginBridgeBackgroundOperationRequest
>;

const PluginBackgroundOperationBridgeErrorReason = Schema.Literals([
	"transport",
	"operation-failed",
	"entitlement-required",
	"page-write-access-required",
	"malformed-result",
]);

const backgroundAcceptedSuccessFields = {
	submissionId: Schema.String,
	outcome: Schema.Literal("success"),
};

const backgroundAcceptedFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginBackgroundOperationBridgeErrorReason,
};

const pluginBridgeBackgroundAcceptedFields = {
	requestId: Schema.String,
	type: Schema.Literal("background-operation-accepted"),
};

export const PluginBackgroundOperationAcceptance = Schema.Union([
	strictStruct(backgroundAcceptedSuccessFields),
	strictStruct(backgroundAcceptedFailureFields),
]);

export type PluginBackgroundOperationAcceptance = Schema.Schema.Type<
	typeof PluginBackgroundOperationAcceptance
>;

export const PluginBridgeBackgroundOperationAccepted = Schema.Union([
	strictStruct({ ...backgroundAcceptedSuccessFields, ...pluginBridgeBackgroundAcceptedFields }),
	strictStruct({ ...backgroundAcceptedFailureFields, ...pluginBridgeBackgroundAcceptedFields }),
]);

export type PluginBridgeBackgroundOperationAccepted = Schema.Schema.Type<
	typeof PluginBridgeBackgroundOperationAccepted
>;

export const BackgroundSubmissionFailureClass = Schema.Literals([
	"transport",
	"operation-failed",
	"entitlement-required",
	"page-write-access-required",
	"operation-rejected",
	"malformed-result",
	"app-updated",
]);

export type BackgroundSubmissionFailureClass = Schema.Schema.Type<
	typeof BackgroundSubmissionFailureClass
>;

export const BackgroundSubmissionOutcome = Schema.Union([
	strictStruct({ status: Schema.Literal("succeeded") }),
	strictStruct({ status: Schema.Literal("incomplete") }),
	strictStruct({
		status: Schema.Literal("failed"),
		reason: Schema.Literals([
			"transport",
			"operation-failed",
			"entitlement-required",
			"page-write-access-required",
			"malformed-result",
			"app-updated",
		]),
	}),
	strictStruct({
		message: Message,
		status: Schema.Literal("failed"),
		reason: Schema.Literal("operation-rejected"),
	}),
]);

export type BackgroundSubmissionOutcome = Schema.Schema.Type<typeof BackgroundSubmissionOutcome>;

export const PluginBridgeBackgroundOperationSettled = strictStruct({
	submissionId: Schema.String,
	outcome: BackgroundSubmissionOutcome,
	type: Schema.Literal("background-operation-settled"),
});

export type PluginBridgeBackgroundOperationSettled = Schema.Schema.Type<
	typeof PluginBridgeBackgroundOperationSettled
>;
