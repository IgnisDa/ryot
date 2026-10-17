import { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { KernelPage } from "@ryot-app/plugin-client-contract";
import { Schema } from "effect";

export const RyotNavigationTarget = Schema.Union([
	strictStruct({ entityId: EntityId, kind: Schema.Literal("entity") }),
	strictStruct({ reference: SavedViewReference, kind: Schema.Literal("saved-view") }),
	strictStruct({ page: KernelPage, kind: Schema.Literal("kernel-page") }),
	strictStruct({
		path: Schema.String,
		packageId: PluginPackageId,
		kind: Schema.Literal("plugin-route"),
		search: Schema.optional(Schema.Record(Schema.String, Schema.String)),
	}),
]);

export type RyotNavigationTarget = Schema.Codec.Encoded<typeof RyotNavigationTarget>;
