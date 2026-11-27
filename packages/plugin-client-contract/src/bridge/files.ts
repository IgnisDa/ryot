import { Schema } from "effect";

export const FILE_EXPORT_MAX_BYTES = 20 * 1024 * 1024;
export const PluginFileSource = Schema.declare<Blob>((value) => value instanceof Blob).annotate({
	identifier: "PluginFileSource",
});
export const PluginExportFile = Schema.Struct({
	fileName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
	source: PluginFileSource.check(
		Schema.makeFilter(
			(source) =>
				(source.size > 0 && source.size <= FILE_EXPORT_MAX_BYTES) || "File exceeds export limits",
		),
	),
});
