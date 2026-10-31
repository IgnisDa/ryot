import { useRyot } from "@ryot-app/plugin-client-sdk/react";
import { Button } from "@ryot-app/plugin-ui-sdk";

import {
	mediaChildCreateSearch,
	type MediaChildEntitySchemaSlug,
	mediaEntityCreateRoute,
	mediaEntityEditors,
	mediaEntityEditRoute,
} from "../../shared/media-entity-editors";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export function MediaEntityEditAction(props: {
	readonly label?: string;
	readonly entityId: string;
	readonly isCustom: boolean;
	readonly entitySchemaSlug: string;
}) {
	if (!props.isCustom || !Object.hasOwn(mediaEntityEditors, props.entitySchemaSlug)) {
		return null;
	}
	return (
		<MediaEditorRouteButton
			label={props.label ?? "Edit"}
			path={mediaEntityEditRoute(props.entitySchemaSlug, props.entityId)}
		/>
	);
}

export function MediaChildCreateAction(props: {
	readonly label: string;
	readonly parentEntityId: string;
	readonly childSchemaSlug: MediaChildEntitySchemaSlug;
	readonly initialProperties: Readonly<Record<string, number>>;
}) {
	return (
		<MediaEditorRouteButton
			label={props.label}
			path={mediaEntityCreateRoute(props.childSchemaSlug)}
			search={mediaChildCreateSearch(props.parentEntityId, props.initialProperties)}
		/>
	);
}

function MediaEditorRouteButton(props: {
	readonly path: string;
	readonly label: string;
	readonly search?: Readonly<Record<string, string>>;
}) {
	const client = useRyot();
	return (
		<Button
			variant="secondary"
			onClick={() =>
				client.navigation.push({
					path: props.path,
					kind: "plugin-route",
					search: props.search ?? {},
					packageId: PLUGIN_PACKAGE_ID,
				})
			}
		>
			{props.label}
		</Button>
	);
}
