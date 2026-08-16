import { Schema } from "effect";

import { PluginConfigRevisionId, PluginId, PluginRevisionId, UserId } from "../../schema/brands";
import { IsoUtcString, strictStruct } from "../../schema/utils";
import { PluginManifest } from "./manifest";

export const PluginRevision = strictStruct({
	pluginId: PluginId,
	id: PluginRevisionId,
	version: Schema.String,
	createdAt: IsoUtcString,
	manifest: PluginManifest,
	sourceHash: Schema.String,
});
export type PluginRevision = typeof PluginRevision.Type;

export const PluginConfigRevisionReference = Schema.Union([
	strictStruct({
		ownerUserId: Schema.Null,
		id: PluginConfigRevisionId,
		pluginRevisionId: PluginRevisionId,
		scope: Schema.Literal("environment"),
	}),
	strictStruct({
		ownerUserId: UserId,
		id: PluginConfigRevisionId,
		pluginRevisionId: PluginRevisionId,
		scope: Schema.Literal("installation"),
	}),
]);
export type PluginConfigRevisionReference = typeof PluginConfigRevisionReference.Type;
