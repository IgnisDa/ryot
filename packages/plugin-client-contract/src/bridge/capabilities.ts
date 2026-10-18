import {
	CleanupManagedAssetOutput,
	ManagedAssetLocator,
	ManagedAssetResolutionBatch,
	TemporaryUploadToken,
} from "@ryot-app/contract/modules/assets/schemas";
import { SetCalendarSourceVisibilityBody } from "@ryot-app/contract/modules/calendar-sources/schemas";
import {
	CollectionResponse,
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteMembershipBody,
	MembershipResponse,
	ReorderMembershipBody,
	ReorderMembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import {
	EntityEditorSaveOutput,
	EntityEditorSaveRequest,
} from "@ryot-app/contract/modules/entities/editor";
import {
	RequestEntityEnrichmentBody,
	RequestEntityEnrichmentResult,
} from "@ryot-app/contract/modules/entities/schemas";
import {
	EntityUpdatedMessage,
	MAX_INTEREST_ENTITY_IDS,
} from "@ryot-app/contract/modules/entity-watches/messages";
import { RyotQLDocument, RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { EntityId, PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { HttpUrl, IsoUtcString, strictStruct } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

export const PLUGIN_STORAGE_KEY_MAX_LENGTH = 128;
export const PLUGIN_STORAGE_VALUE_MAX_BYTES = 65536;

export const PluginOperationBridgeErrorReason = Schema.Literals([
	"transport",
	"operation-failed",
	"operation-rejected",
	"malformed-result",
]);

export type PluginOperationBridgeErrorReason = Schema.Schema.Type<
	typeof PluginOperationBridgeErrorReason
>;

export const PluginAssetBridgeErrorReason = Schema.Literals([
	"transport",
	"asset-failed",
	"malformed-result",
]);

export type PluginAssetBridgeErrorReason = Schema.Schema.Type<typeof PluginAssetBridgeErrorReason>;

export const PluginUploadBridgeErrorReason = Schema.Literals([
	"transport",
	"operation-failed",
	"malformed-result",
]);

export type PluginUploadBridgeErrorReason = Schema.Schema.Type<
	typeof PluginUploadBridgeErrorReason
>;

export const RyotClientErrorReason = Schema.Literals([
	"link-open-failed",
	"activation-required",
	"disposed",
	"protocol",
	"transport",
	"asset-failed",
	"collection-failed",
	"collection-stale",
	"entity-save-failed",
	"query-failed",
	"invalid-input",
	"operation-failed",
	"operation-rejected",
	"malformed-result",
	"unsupported-capability",
	"invalid-request",
	"quota",
]);

export type RyotClientErrorReason = Schema.Schema.Type<typeof RyotClientErrorReason>;

export const ExternalLinkRequest = strictStruct({ url: HttpUrl });

export type ExternalLinkRequest = Schema.Schema.Type<typeof ExternalLinkRequest>;

const externalLinkErrorReason = Schema.Literals([
	"invalid-request",
	"link-open-failed",
	"activation-required",
]);

export const ExternalLinkSuccess = strictStruct({ outcome: Schema.Literal("success") });

const externalLinkFailure = strictStruct({
	reason: externalLinkErrorReason,
	outcome: Schema.Literal("failure"),
});

export const ExternalLinkOutcome = Schema.Union([ExternalLinkSuccess, externalLinkFailure]);

export type ExternalLinkOutcome = Schema.Schema.Type<typeof ExternalLinkOutcome>;

export const PluginBridgeExternalLinkRequest = strictStruct({
	...ExternalLinkRequest.fields,
	requestId: Schema.String,
	type: Schema.Literal("external-link-request"),
});

export const PluginBridgeExternalLinkResult = Schema.Union(
	[ExternalLinkSuccess, externalLinkFailure].map((variant) =>
		strictStruct({
			...variant.fields,
			requestId: Schema.String,
			type: Schema.Literal("external-link-result"),
		}),
	),
);

export const PluginCollectionBridgeErrorReason = Schema.Literals([
	"transport",
	"collection-failed",
	"collection-stale",
	"malformed-result",
]);

export type PluginCollectionBridgeErrorReason = Schema.Schema.Type<
	typeof PluginCollectionBridgeErrorReason
>;

const collectionRequestVariants = [
	strictStruct({ input: CreateCollectionBody, action: Schema.Literal("create") }),
	strictStruct({ input: CreateMembershipBody, action: Schema.Literal("upsert-membership") }),
	strictStruct({ input: DeleteMembershipBody, action: Schema.Literal("remove-membership") }),
	strictStruct({ input: ReorderMembershipBody, action: Schema.Literal("reorder-membership") }),
] as const;

export const PluginCollectionRequest = Schema.Union(collectionRequestVariants);

export type PluginCollectionRequest = Schema.Schema.Type<typeof PluginCollectionRequest>;

export const PluginBridgeCollectionRequest = Schema.Union(
	collectionRequestVariants.map((variant) =>
		strictStruct({
			...variant.fields,
			requestId: Schema.String,
			type: Schema.Literal("collection-request"),
		}),
	),
);

export type PluginBridgeCollectionRequest = Schema.Schema.Type<
	typeof PluginBridgeCollectionRequest
>;

const pluginCollectionSuccessFields = {
	outcome: Schema.Literal("success"),
	response: Schema.Union([CollectionResponse, MembershipResponse, ReorderMembershipResponse]),
};

const pluginCollectionFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginCollectionBridgeErrorReason,
};

const pluginBridgeCollectionResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("collection-result"),
};

export const PluginCollectionOutcome = Schema.Union([
	strictStruct(pluginCollectionSuccessFields),
	strictStruct(pluginCollectionFailureFields),
]);

export type PluginCollectionOutcome = Schema.Schema.Type<typeof PluginCollectionOutcome>;

export const PluginBridgeCollectionResult = Schema.Union([
	strictStruct({ ...pluginCollectionSuccessFields, ...pluginBridgeCollectionResultFields }),
	strictStruct({ ...pluginCollectionFailureFields, ...pluginBridgeCollectionResultFields }),
]);

export type PluginBridgeCollectionResult = Schema.Schema.Type<typeof PluginBridgeCollectionResult>;

export const PluginCalendarSourceVisibilityBridgeErrorReason = Schema.Literals([
	"transport",
	"invalid-request",
	"malformed-result",
]);

export type PluginCalendarSourceVisibilityBridgeErrorReason = Schema.Schema.Type<
	typeof PluginCalendarSourceVisibilityBridgeErrorReason
>;

export const PluginCalendarSourceVisibilityRequest = SetCalendarSourceVisibilityBody;

export type PluginCalendarSourceVisibilityRequest = Schema.Schema.Type<
	typeof PluginCalendarSourceVisibilityRequest
>;

export const PluginBridgeCalendarSourceVisibilityRequest = strictStruct({
	...SetCalendarSourceVisibilityBody.fields,
	requestId: Schema.String,
	type: Schema.Literal("calendar-source-visibility-request"),
});

export type PluginBridgeCalendarSourceVisibilityRequest = Schema.Schema.Type<
	typeof PluginBridgeCalendarSourceVisibilityRequest
>;

const pluginCalendarSourceVisibilitySuccessFields = { outcome: Schema.Literal("success") };

const pluginCalendarSourceVisibilityFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginCalendarSourceVisibilityBridgeErrorReason,
};

const pluginBridgeCalendarSourceVisibilityResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("calendar-source-visibility-result"),
};

export const PluginCalendarSourceVisibilityOutcome = Schema.Union([
	strictStruct(pluginCalendarSourceVisibilitySuccessFields),
	strictStruct(pluginCalendarSourceVisibilityFailureFields),
]);

export type PluginCalendarSourceVisibilityOutcome = Schema.Schema.Type<
	typeof PluginCalendarSourceVisibilityOutcome
>;

export const PluginBridgeCalendarSourceVisibilityResult = Schema.Union([
	strictStruct({
		...pluginCalendarSourceVisibilitySuccessFields,
		...pluginBridgeCalendarSourceVisibilityResultFields,
	}),
	strictStruct({
		...pluginCalendarSourceVisibilityFailureFields,
		...pluginBridgeCalendarSourceVisibilityResultFields,
	}),
]);

export type PluginBridgeCalendarSourceVisibilityResult = Schema.Schema.Type<
	typeof PluginBridgeCalendarSourceVisibilityResult
>;

export const PluginManagedAssetResolution = strictStruct({
	url: HttpUrl,
	expiresAt: IsoUtcString,
	asset: ManagedAssetLocator,
});

export type PluginManagedAssetResolution = Schema.Schema.Type<typeof PluginManagedAssetResolution>;

export const PluginAssetRequest = strictStruct({ assets: ManagedAssetResolutionBatch });

export type PluginAssetRequest = Schema.Schema.Type<typeof PluginAssetRequest>;

export const PluginBridgeAssetRequest = strictStruct({
	requestId: Schema.String,
	assets: ManagedAssetResolutionBatch,
	type: Schema.Literal("asset-request"),
});

export type PluginBridgeAssetRequest = Schema.Schema.Type<typeof PluginBridgeAssetRequest>;

export const PluginBridgeAssetCancel = strictStruct({
	requestId: Schema.String,
	type: Schema.Literal("asset-cancel"),
});

export type PluginBridgeAssetCancel = Schema.Schema.Type<typeof PluginBridgeAssetCancel>;

const pluginAssetSuccessFields = {
	outcome: Schema.Literal("success"),
	resolutions: Schema.Array(PluginManagedAssetResolution),
};

const pluginAssetFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginAssetBridgeErrorReason,
};

const pluginBridgeAssetResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("asset-result"),
};

export const PluginAssetOutcome = Schema.Union([
	strictStruct(pluginAssetSuccessFields),
	strictStruct(pluginAssetFailureFields),
]);

export type PluginAssetOutcome = Schema.Schema.Type<typeof PluginAssetOutcome>;

export const PluginBridgeAssetResult = Schema.Union([
	strictStruct({ ...pluginAssetSuccessFields, ...pluginBridgeAssetResultFields }),
	strictStruct({ ...pluginAssetFailureFields, ...pluginBridgeAssetResultFields }),
]);

export type PluginBridgeAssetResult = Schema.Schema.Type<typeof PluginBridgeAssetResult>;

export const PluginOperationRequest = strictStruct({
	input: JsonValue,
	packageId: PluginPackageId,
	operationSlug: Schema.String,
	idempotencyKey: Schema.optional(Schema.NonEmptyString),
});

export type PluginOperationRequest = Schema.Schema.Type<typeof PluginOperationRequest>;

export const PluginBridgeOperationRequest = strictStruct({
	input: JsonValue,
	requestId: Schema.String,
	packageId: PluginPackageId,
	operationSlug: Schema.String,
	type: Schema.Literal("operation-request"),
	idempotencyKey: Schema.optional(Schema.NonEmptyString),
});

export type PluginBridgeOperationRequest = Schema.Schema.Type<typeof PluginBridgeOperationRequest>;

const pluginOperationSuccessFields = { value: JsonValue, outcome: Schema.Literal("success") };

const pluginOperationFailureVariants = [
	{
		outcome: Schema.Literal("failure"),
		reason: Schema.Literals(["transport", "operation-failed", "malformed-result"]),
	},
	{
		message: Schema.String,
		outcome: Schema.Literal("failure"),
		reason: Schema.Literal("operation-rejected"),
	},
] as const;

const pluginBridgeOperationResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("operation-result"),
};

export const PluginOperationOutcome = Schema.Union([
	strictStruct(pluginOperationSuccessFields),
	...pluginOperationFailureVariants.map((fields) => strictStruct(fields)),
]);

export type PluginOperationOutcome = Schema.Schema.Type<typeof PluginOperationOutcome>;

export const PluginBridgeOperationResult = Schema.Union([
	strictStruct({ ...pluginOperationSuccessFields, ...pluginBridgeOperationResultFields }),
	...pluginOperationFailureVariants.map((fields) =>
		strictStruct({ ...fields, ...pluginBridgeOperationResultFields }),
	),
]);

export type PluginBridgeOperationResult = Schema.Schema.Type<typeof PluginBridgeOperationResult>;

export const PluginEntitySaveBridgeErrorReason = Schema.Literals([
	"transport",
	"invalid-request",
	"entity-save-failed",
	"malformed-result",
]);

export type PluginEntitySaveBridgeErrorReason = Schema.Schema.Type<
	typeof PluginEntitySaveBridgeErrorReason
>;

export const PluginBridgeEntitySaveRequest = strictStruct({
	...EntityEditorSaveRequest.fields,
	requestId: Schema.String,
	type: Schema.Literal("entity-editor-save-request"),
});

export type PluginBridgeEntitySaveRequest = Schema.Schema.Type<
	typeof PluginBridgeEntitySaveRequest
>;

const pluginEntitySaveSuccessFields = {
	output: EntityEditorSaveOutput,
	outcome: Schema.Literal("success"),
};

const pluginEntitySaveFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginEntitySaveBridgeErrorReason,
};

const pluginBridgeEntitySaveResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("entity-editor-save-result"),
};

export const PluginEntitySaveOutcome = Schema.Union([
	strictStruct(pluginEntitySaveSuccessFields),
	strictStruct(pluginEntitySaveFailureFields),
]);

export type PluginEntitySaveOutcome = Schema.Schema.Type<typeof PluginEntitySaveOutcome>;

export const PluginBridgeEntitySaveResult = Schema.Union([
	strictStruct({ ...pluginEntitySaveSuccessFields, ...pluginBridgeEntitySaveResultFields }),
	strictStruct({ ...pluginEntitySaveFailureFields, ...pluginBridgeEntitySaveResultFields }),
]);

export type PluginBridgeEntitySaveResult = Schema.Schema.Type<typeof PluginBridgeEntitySaveResult>;

export const PluginEnrichmentBridgeErrorReason = Schema.Literals(["invalid-request", "transport"]);

export type PluginEnrichmentBridgeErrorReason = Schema.Schema.Type<
	typeof PluginEnrichmentBridgeErrorReason
>;

export const PluginEnrichmentRequest = strictStruct({
	...RequestEntityEnrichmentBody.fields,
	entityId: EntityId,
});

export type PluginEnrichmentRequest = Schema.Schema.Type<typeof PluginEnrichmentRequest>;

export const PluginBridgeEnrichmentRequest = strictStruct({
	...PluginEnrichmentRequest.fields,
	requestId: Schema.String,
	type: Schema.Literal("enrichment-request"),
});

export type PluginBridgeEnrichmentRequest = Schema.Schema.Type<
	typeof PluginBridgeEnrichmentRequest
>;

const pluginEnrichmentSuccessFields = {
	...RequestEntityEnrichmentResult.fields,
	outcome: Schema.Literal("success"),
};

const pluginEnrichmentFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginEnrichmentBridgeErrorReason,
};

const pluginBridgeEnrichmentResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("enrichment-result"),
};

export const PluginEnrichmentOutcome = Schema.Union([
	strictStruct(pluginEnrichmentSuccessFields),
	strictStruct(pluginEnrichmentFailureFields),
]);

export type PluginEnrichmentOutcome = Schema.Schema.Type<typeof PluginEnrichmentOutcome>;

export const PluginBridgeEnrichmentResult = Schema.Union([
	strictStruct({ ...pluginEnrichmentSuccessFields, ...pluginBridgeEnrichmentResultFields }),
	strictStruct({ ...pluginEnrichmentFailureFields, ...pluginBridgeEnrichmentResultFields }),
]);

export type PluginBridgeEnrichmentResult = Schema.Schema.Type<typeof PluginBridgeEnrichmentResult>;

export const PluginStorageBridgeErrorReason = Schema.Literals([
	"invalid-request",
	"quota",
	"transport",
]);

export type PluginStorageBridgeErrorReason = Schema.Schema.Type<
	typeof PluginStorageBridgeErrorReason
>;

const pluginStorageRequestFields = {
	pluginId: PluginId,
	key: Schema.String.pipe(
		Schema.check(Schema.isMinLength(1), Schema.isMaxLength(PLUGIN_STORAGE_KEY_MAX_LENGTH)),
	),
};

const storageRequestVariants = [
	strictStruct({ ...pluginStorageRequestFields, action: Schema.Literal("get") }),
	strictStruct({ ...pluginStorageRequestFields, value: JsonValue, action: Schema.Literal("set") }),
	strictStruct({ ...pluginStorageRequestFields, action: Schema.Literal("remove") }),
] as const;

export const PluginStorageRequest = Schema.Union(storageRequestVariants);

export type PluginStorageRequest = Schema.Schema.Type<typeof PluginStorageRequest>;

export const PluginBridgeStorageRequest = Schema.Union(
	storageRequestVariants.map((variant) =>
		strictStruct({
			...variant.fields,
			requestId: Schema.String,
			type: Schema.Literal("storage-request"),
		}),
	),
);

export type PluginBridgeStorageRequest = Schema.Schema.Type<typeof PluginBridgeStorageRequest>;

const pluginStorageSuccessFields = {
	value: Schema.NullOr(JsonValue),
	outcome: Schema.Literal("success"),
};

const pluginStorageFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginStorageBridgeErrorReason,
};

const pluginBridgeStorageResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("storage-result"),
};

export const PluginStorageOutcome = Schema.Union([
	strictStruct(pluginStorageSuccessFields),
	strictStruct(pluginStorageFailureFields),
]);

export type PluginStorageOutcome = Schema.Schema.Type<typeof PluginStorageOutcome>;

export const PluginBridgeStorageResult = Schema.Union([
	strictStruct({ ...pluginStorageSuccessFields, ...pluginBridgeStorageResultFields }),
	strictStruct({ ...pluginStorageFailureFields, ...pluginBridgeStorageResultFields }),
]);

export type PluginBridgeStorageResult = Schema.Schema.Type<typeof PluginBridgeStorageResult>;

export const PluginUserSettingsBridgeErrorReason = Schema.Literals([
	"invalid-request",
	"transport",
]);

export type PluginUserSettingsBridgeErrorReason = Schema.Schema.Type<
	typeof PluginUserSettingsBridgeErrorReason
>;

export const PluginUserSettingsRequest = strictStruct({ pluginId: PluginId });

export type PluginUserSettingsRequest = Schema.Schema.Type<typeof PluginUserSettingsRequest>;

export const PluginBridgeUserSettingsRequest = strictStruct({
	...PluginUserSettingsRequest.fields,
	requestId: Schema.String,
	type: Schema.Literal("user-settings-request"),
});

export type PluginBridgeUserSettingsRequest = Schema.Schema.Type<
	typeof PluginBridgeUserSettingsRequest
>;

const pluginUserSettingsSuccessFields = {
	outcome: Schema.Literal("success"),
	settings: Schema.Record(Schema.String, JsonValue),
};

const pluginUserSettingsFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginUserSettingsBridgeErrorReason,
};

const pluginBridgeUserSettingsResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("user-settings-result"),
};

export const PluginUserSettingsOutcome = Schema.Union([
	strictStruct(pluginUserSettingsSuccessFields),
	strictStruct(pluginUserSettingsFailureFields),
]);

export type PluginUserSettingsOutcome = Schema.Schema.Type<typeof PluginUserSettingsOutcome>;

export const PluginBridgeUserSettingsResult = Schema.Union([
	strictStruct({ ...pluginUserSettingsSuccessFields, ...pluginBridgeUserSettingsResultFields }),
	strictStruct({ ...pluginUserSettingsFailureFields, ...pluginBridgeUserSettingsResultFields }),
]);

export type PluginBridgeUserSettingsResult = Schema.Schema.Type<
	typeof PluginBridgeUserSettingsResult
>;

export const PluginUploadSource = Schema.declare<Blob>((value) => value instanceof Blob).annotate({
	identifier: "PluginUploadSource",
});

const pluginUploadFileFields = {
	fileName: Schema.String,
	contentType: Schema.String,
	source: PluginUploadSource,
};

const pluginUploadRequestVariants = [
	strictStruct({ ...pluginUploadFileFields, action: Schema.Literal("temporary") }),
	strictStruct({ ...pluginUploadFileFields, action: Schema.Literal("permanent") }),
	strictStruct({ asset: ManagedAssetLocator, action: Schema.Literal("cleanup") }),
] as const;

export const PluginUploadRequest = Schema.Union(pluginUploadRequestVariants);

export type PluginUploadRequest = Schema.Schema.Type<typeof PluginUploadRequest>;

export const PluginBridgeUploadRequest = Schema.Union(
	pluginUploadRequestVariants.map((variant) =>
		strictStruct({
			...variant.fields,
			requestId: Schema.String,
			type: Schema.Literal("upload-request"),
		}),
	),
);

export type PluginBridgeUploadRequest = Schema.Schema.Type<typeof PluginBridgeUploadRequest>;

const pluginUploadResultVariants = [
	strictStruct({ token: TemporaryUploadToken, action: Schema.Literal("temporary") }),
	strictStruct({ asset: ManagedAssetLocator, action: Schema.Literal("permanent") }),
	strictStruct({ ...CleanupManagedAssetOutput.fields, action: Schema.Literal("cleanup") }),
] as const;

export const PluginUploadResult = Schema.Union(pluginUploadResultVariants);

export type PluginUploadResult = Schema.Schema.Type<typeof PluginUploadResult>;

const pluginUploadSuccessVariants = pluginUploadResultVariants.map((variant) =>
	strictStruct({ ...variant.fields, outcome: Schema.Literal("success") }),
);

const pluginUploadFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginUploadBridgeErrorReason,
};

const pluginBridgeUploadResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("upload-result"),
};

export const PluginUploadOutcome = Schema.Union([
	...pluginUploadSuccessVariants,
	strictStruct(pluginUploadFailureFields),
]);

export type PluginUploadOutcome = Schema.Schema.Type<typeof PluginUploadOutcome>;

export const PluginBridgeUploadResult = Schema.Union([
	...pluginUploadSuccessVariants.map((variant) =>
		strictStruct({ ...variant.fields, ...pluginBridgeUploadResultFields }),
	),
	strictStruct({ ...pluginUploadFailureFields, ...pluginBridgeUploadResultFields }),
]);

export type PluginBridgeUploadResult = Schema.Schema.Type<typeof PluginBridgeUploadResult>;

export const PluginRyotQLFailureReason = Schema.Literals(["query-failed", "transport"]);

export type PluginRyotQLFailureReason = Schema.Schema.Type<typeof PluginRyotQLFailureReason>;

export const PluginBridgeRyotQLRequest = strictStruct({
	document: RyotQLDocument,
	requestId: Schema.String,
	type: Schema.Literal("ryotql-request"),
});

export type PluginRyotQLRequest = Pick<PluginBridgeRyotQLRequest, "document">;

export type PluginBridgeRyotQLRequest = Schema.Schema.Type<typeof PluginBridgeRyotQLRequest>;

export const PluginBridgeRyotQLCancel = strictStruct({
	requestId: Schema.String,
	type: Schema.Literal("ryotql-cancel"),
});

export type PluginBridgeRyotQLCancel = Schema.Schema.Type<typeof PluginBridgeRyotQLCancel>;

const pluginRyotQLSuccessFields = { response: RyotQLResponse, outcome: Schema.Literal("success") };

const pluginRyotQLFailureFields = {
	reason: PluginRyotQLFailureReason,
	outcome: Schema.Literal("failure"),
};

const pluginBridgeRyotQLResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("ryotql-result"),
};

export const PluginRyotQLOutcome = Schema.Union([
	strictStruct(pluginRyotQLSuccessFields),
	strictStruct(pluginRyotQLFailureFields),
]);

export type PluginRyotQLOutcome = Schema.Schema.Type<typeof PluginRyotQLOutcome>;

export const PluginBridgeRyotQLResult = Schema.Union([
	strictStruct({ ...pluginRyotQLSuccessFields, ...pluginBridgeRyotQLResultFields }),
	strictStruct({ ...pluginRyotQLFailureFields, ...pluginBridgeRyotQLResultFields }),
]);

export type PluginBridgeRyotQLResult = Schema.Schema.Type<typeof PluginBridgeRyotQLResult>;

export const EntityWatch = strictStruct({
	visible: Schema.Array(EntityId),
	foreground: Schema.Array(EntityId),
});

export type EntityWatch = Schema.Codec.Encoded<typeof EntityWatch>;

export const PluginBridgeEntityWatch = strictStruct({
	...EntityWatch.fields,
	type: Schema.Literal("entity-watches"),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			({ visible, foreground }) =>
				foreground.length + visible.length <= MAX_INTEREST_ENTITY_IDS ||
				"Too many entity interests",
		),
	),
);

export type PluginBridgeEntityWatch = Schema.Schema.Type<typeof PluginBridgeEntityWatch>;

export const PluginBridgeEntityUpdated = strictStruct({
	...EntityUpdatedMessage.fields,
	type: Schema.Literal("entity-updated"),
});

export type PluginBridgeEntityUpdated = Schema.Schema.Type<typeof PluginBridgeEntityUpdated>;
