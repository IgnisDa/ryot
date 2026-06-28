import { Schema } from "effect";

export const InstallPluginBody = Schema.Struct({
	manifest: Schema.Unknown,
	files: Schema.Record(Schema.String, Schema.String),
});

export type InstallPluginBody = Schema.Schema.Type<typeof InstallPluginBody>;

export const PluginListItem = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	version: Schema.String,
	sourceHash: Schema.String,
	accentColor: Schema.String,
	description: Schema.String,
});

export type PluginListItem = Schema.Schema.Type<typeof PluginListItem>;

export const PluginList = Schema.Array(PluginListItem);

export const PluginInvokeBody = Schema.Struct({ payload: Schema.Unknown });

export type PluginInvokeBody = Schema.Schema.Type<typeof PluginInvokeBody>;

export const PluginInvokeResult = Schema.Struct({ result: Schema.Unknown });

export type PluginInvokeResult = Schema.Schema.Type<typeof PluginInvokeResult>;
