import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { SchemaFileUpload, SchemaFormIcons } from "@ryot-app/plugin-ui-sdk/schema-form";

export const schemaFormIcons: SchemaFormIcons = {
	close: <AppIcon name="x" size={14} />,
	check: <AppIcon size={14} name="check" />,
	upload: <AppIcon size={15} name="upload" />,
	search: <AppIcon size={15} name="search" />,
	remove: <AppIcon size={14} name="trash-2" />,
	file: <AppIcon size={15} name="file-text" />,
	chevron: <AppIcon size={15} name="chevron-down" />,
};

export const unsupportedFileUpload: SchemaFileUpload = () =>
	Promise.resolve({ kind: "failed", message: "File uploads are not supported here." });
