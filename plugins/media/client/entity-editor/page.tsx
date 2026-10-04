import { EntityEditorScreen } from "@ryot-app/plugin-client-sdk/entity-editor";
import { usePluginLocation, usePluginSearch } from "@ryot-app/plugin-client-sdk/plugin";

import { mediaEntityEditorRoutes } from "../../shared/media-entity-editors";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export default function MediaEntityEditorPage() {
	const location = usePluginLocation();
	const search = usePluginSearch();
	const initialName = search.get("name") ?? undefined;
	const entitySchemaSlug =
		location.kind === "route" && Object.hasOwn(mediaEntityEditorRoutes, location.path)
			? mediaEntityEditorRoutes[location.path]
			: undefined;
	if (entitySchemaSlug === undefined) {
		return null;
	}
	return (
		<EntityEditorScreen
			packageId={PLUGIN_PACKAGE_ID}
			entitySchemaSlug={entitySchemaSlug}
			mode={{ kind: "create", ...(initialName === undefined ? {} : { initialName }) }}
		/>
	);
}
