import { useRyot } from "@ryot-app/plugin-client-sdk/react";
import { Button } from "@ryot-app/plugin-ui-sdk";

import { mediaEntityEditors, mediaEntityEditRoute } from "../../shared/media-entity-editors";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export function MediaEntityEditAction(props: {
	readonly entityId: string;
	readonly entitySchemaSlug: string;
	readonly isCustom: boolean;
}) {
	const client = useRyot();
	if (!props.isCustom || !Object.hasOwn(mediaEntityEditors, props.entitySchemaSlug)) {
		return null;
	}
	return (
		<Button
			variant="secondary"
			onClick={() =>
				client.navigation.push({
					search: {},
					kind: "plugin-route",
					packageId: PLUGIN_PACKAGE_ID,
					path: mediaEntityEditRoute(props.entitySchemaSlug, props.entityId),
				})
			}
		>
			Edit
		</Button>
	);
}
