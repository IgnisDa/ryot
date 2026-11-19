import { EntityEditorScreen } from "@ryot-app/plugin-client-sdk/entity-editor";
import {
	usePluginLocation,
	usePluginParams,
	usePluginSearch,
} from "@ryot-app/plugin-client-sdk/plugin";

import {
	mediaChildCreateInput,
	mediaEntityCreateRoute,
	mediaEntityEditorRoutes,
	mediaEntityEditRoute,
} from "../../shared/media-entity-editors";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export default function MediaEntityEditorPage() {
	const location = usePluginLocation();
	const params = usePluginParams();
	const search = usePluginSearch();
	const initialName = search.get("name") ?? undefined;
	const entityId = params.entityId;
	const matchingRoute =
		location.kind === "route"
			? Object.values(mediaEntityEditorRoutes).find((route) => {
					if (route.kind === "create") {
						return location.path === mediaEntityCreateRoute(route.entitySchemaSlug);
					}
					return (
						entityId !== undefined &&
						location.path === mediaEntityEditRoute(route.entitySchemaSlug, entityId)
					);
				})
			: undefined;
	if (matchingRoute === undefined) {
		return null;
	}
	if (matchingRoute.kind === "edit") {
		if (entityId === undefined || entityId === "") {
			return null;
		}
		return (
			<EntityEditorScreen
				packageId={PLUGIN_PACKAGE_ID}
				mode={{ entityId, kind: "edit" }}
				entitySchemaSlug={matchingRoute.entitySchemaSlug}
			/>
		);
	}
	return (
		<EntityEditorScreen
			packageId={PLUGIN_PACKAGE_ID}
			entitySchemaSlug={matchingRoute.entitySchemaSlug}
			mode={{
				kind: "create",
				...mediaChildCreateInput(matchingRoute.entitySchemaSlug, search),
				...(initialName === undefined ? {} : { initialName }),
			}}
		/>
	);
}
