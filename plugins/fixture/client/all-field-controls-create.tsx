import { EntityEditorScreen } from "@ryot-app/plugin-client-sdk/entity-editor";
import { usePluginSearch } from "@ryot-app/plugin-client-sdk/plugin";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

export default function AllFieldControlsCreatePage() {
	const initialName = usePluginSearch().get("name") ?? undefined;
	return (
		<EntityEditorScreen
			packageId={PLUGIN_PACKAGE_ID}
			entitySchemaSlug="all-field-controls"
			mode={{ kind: "create", ...(initialName === undefined ? {} : { initialName }) }}
		/>
	);
}
