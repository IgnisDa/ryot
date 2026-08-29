import type { SchemaFormIcons } from "@ryot-app/client-ui-sdk/schema-form";

import { AppIcon } from "#/modules/navigation/app-icon";

export const schemaFormIcons: SchemaFormIcons = {
	close: <AppIcon name="x" size={14} />,
	check: <AppIcon name="check" size={14} />,
	upload: <AppIcon name="upload" size={15} />,
	search: <AppIcon name="search" size={15} />,
	remove: <AppIcon name="trash-2" size={14} />,
	file: <AppIcon name="file-text" size={15} />,
	chevron: <AppIcon name="chevron-down" size={15} />,
};
