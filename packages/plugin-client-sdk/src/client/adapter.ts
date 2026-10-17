import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { EntityEditorSaveRequest } from "@ryot-app/contract/modules/entities/editor";
import type { EntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import type {
	AddToCollectionRequest,
	EditCollectionRequest,
	EntityWatch,
	ExternalLinkRequest,
	PluginCollectionRequest,
	PluginDeviceRequest,
	PluginIosLiveActivityRequest,
	PluginManagedAssetResolution,
	PluginOperationRequest,
	PluginPageSearchUpdate,
	PluginStorageRequest,
	PluginThemeSnapshot,
	PluginUploadRequest,
	PickEntityRequest,
} from "@ryot-app/plugin-client-contract";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import type { Effect, Schema } from "effect";

import type { RyotClientError } from "./errors";
import type { RyotNavigationTarget } from "./navigation-target";

export type EntityUpdate = Schema.Codec.Encoded<typeof EntityUpdatedMessage>;
export type EntityWatchSubscription = {
	readonly dispose: () => void;
	readonly update: (interest: EntityWatch) => void;
};

export type RyotThemeSnapshot = PluginThemeSnapshot;
export type ManagedAssetResolution = PluginManagedAssetResolution;

type OperationRequest = Schema.Codec.Encoded<typeof PluginOperationRequest>;
export type OperationAdapterRequest = Omit<OperationRequest, "operationSlug"> & {
	readonly slug: OperationRequest["operationSlug"];
};

export type CollectionAdapterRequest = PluginCollectionRequest;

export type StorageAdapterRequest = PluginStorageRequest;

export type RyotPageSearchUpdate = PluginPageSearchUpdate;
export type RyotPickEntityRequest = Schema.Codec.Encoded<typeof PickEntityRequest>;
export type RyotEditCollectionRequest = Schema.Codec.Encoded<typeof EditCollectionRequest>;
export type RyotAddToCollectionRequest = Schema.Codec.Encoded<typeof AddToCollectionRequest>;

export type OperationInvocation<
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
> = Omit<OperationRequest, "operationSlug" | "input"> & {
	readonly slug: string;
	readonly output: Output;
	readonly inputSchema: Input;
	readonly input: Input["Type"];
	readonly refreshOnSuccess?: boolean;
};

export type FileUploadRequest = Omit<
	Extract<PluginUploadRequest, { readonly action: "temporary" }>,
	"action"
>;

export type RyotClientAdapter = {
	readonly registerFlush?: (flush: () => Effect.Effect<void, RyotClientError>) => () => void;
	readonly device?: (request: PluginDeviceRequest) => Effect.Effect<unknown, RyotClientError>;
	readonly iosLiveActivity?: (
		request: PluginIosLiveActivityRequest,
	) => Effect.Effect<unknown, RyotClientError>;
	readonly pluginIdentity?: (
		packageId: PluginPackageId,
	) => Extract<PluginIdentityReference, { readonly kind: "local" }>;
	readonly openExternalLink?: (
		request: ExternalLinkRequest,
	) => Effect.Effect<unknown, RyotClientError>;
	readonly upload: (request: PluginUploadRequest) => Effect.Effect<unknown, RyotClientError>;
	readonly invokeOperation?: (
		request: OperationAdapterRequest,
	) => Effect.Effect<unknown, RyotClientError>;
	readonly pickEntity?: (request: PickEntityRequest) => Effect.Effect<unknown, RyotClientError>;
	readonly editCollection?: (
		request: EditCollectionRequest,
	) => Effect.Effect<unknown, RyotClientError>;
	readonly addToCollection?: (
		request: AddToCollectionRequest,
	) => Effect.Effect<unknown, RyotClientError>;
	readonly saveEntity?: (
		request: EntityEditorSaveRequest,
	) => Effect.Effect<unknown, RyotClientError>;
	readonly mutateCollection?: (
		request: CollectionAdapterRequest,
	) => Effect.Effect<unknown, RyotClientError>;
	readonly accessStorage?: (
		request: StorageAdapterRequest,
	) => Effect.Effect<unknown, RyotClientError>;
	readonly navigate?: (mode: "push" | "replace", target: RyotNavigationTarget) => void;
	readonly navigatePageSearch?: (mode: "push" | "replace", update: RyotPageSearchUpdate) => void;
	readonly overlays?: {
		readonly setCount: (count: number) => void;
		readonly setDismissHandler: (handler: () => boolean) => void;
	};
	readonly watchEntities?: (
		interest: EntityWatch,
		onUpdate: (update: EntityUpdate) => void,
	) => EntityWatchSubscription;
	readonly query: (
		document: PreparedRecipe<unknown>["document"],
	) => Effect.Effect<unknown, RyotClientError>;
	readonly theme?: {
		readonly getSnapshot: () => unknown;
		readonly subscribe: (listener: () => void) => () => void;
	};
	readonly resolveAssets?: (
		assets: readonly ManagedAssetLocator[],
	) => Effect.Effect<unknown, RyotClientError>;
};
