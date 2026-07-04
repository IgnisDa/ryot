import { Schema } from "effect";

export const InstallPluginBody = Schema.Struct({
	manifest: Schema.Unknown,
	files: Schema.Record({ key: Schema.String, value: Schema.String }),
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
