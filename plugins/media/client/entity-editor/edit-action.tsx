import type { Text } from "@ryot-app/plugin-client-sdk/react";
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
import { useMediaMessages } from "../messages";

export function MediaChildCreateAction(props: {
	readonly label: Text;
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

export function MediaEntityEditAction(props: {
	readonly label?: Text;
	readonly entityId: string;
	readonly isCustom: boolean;
	readonly entitySchemaSlug: string;
}) {
	const text = useMediaMessages();
	if (!props.isCustom || !Object.hasOwn(mediaEntityEditors, props.entitySchemaSlug)) {
		return null;
	}
	return (
		<MediaEditorRouteButton
			label={props.label ?? text("record.edit")}
			path={mediaEntityEditRoute(props.entitySchemaSlug, props.entityId)}
		/>
	);
}

function MediaEditorRouteButton(props: {
	readonly label: Text;
	readonly path: string;
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
