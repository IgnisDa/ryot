import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

export const BACKGROUND_SUBMISSION_LIMITS = {
	entries: 20,
	inFlightPerService: 8,
	inFlightPerSession: 4,
} as const;

export const BACKGROUND_SUBMISSION_LABEL_MAX_LENGTH = 120;
export const BACKGROUND_SUBMISSION_KEY_MAX_LENGTH = 128;

const isControlCodePoint = (codePoint: number) =>
	codePoint <= 0x1f ||
	(codePoint >= 0x7f && codePoint <= 0x9f) ||
	(codePoint >= 0x202a && codePoint <= 0x202e) ||
	(codePoint >= 0x2066 && codePoint <= 0x2069);

export const isBackgroundSubmissionLabelCharacterAllowed = (character: string) =>
	!isControlCodePoint(character.codePointAt(0) ?? 0);

export const BackgroundSubmissionLabel = Schema.NonEmptyString.pipe(
	Schema.check(
		Schema.isMaxLength(BACKGROUND_SUBMISSION_LABEL_MAX_LENGTH),
		Schema.makeFilter(
			(label: string) =>
				Array.from(label).every(isBackgroundSubmissionLabelCharacterAllowed) ||
				"Label contains control characters",
		),
	),
);

export const BackgroundSubmissionIdempotencyKey = Schema.NonEmptyString.pipe(
	Schema.check(Schema.isMaxLength(BACKGROUND_SUBMISSION_KEY_MAX_LENGTH)),
);

export const PluginBackgroundOperationRequest = strictStruct({
	input: JsonValue,
	packageId: PluginPackageId,
	operationSlug: Schema.String,
	label: BackgroundSubmissionLabel,
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

export const PluginBackgroundOperationBridgeErrorReason = Schema.Literals([
	"transport",
	"operation-failed",
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
		reason: Schema.Literals(["transport", "operation-failed", "malformed-result", "app-updated"]),
	}),
	strictStruct({
		message: Schema.String,
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
