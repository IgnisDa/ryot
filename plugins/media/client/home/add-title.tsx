import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { EntitySchemaSlug } from "@ryot-app/plugin-client-sdk/plugin";
import { usePluginIdentity, useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button, MenuButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import {
	builtinMediaEntitySchemaSlugs,
	mediaLibraryMembership,
} from "../../shared/media-schema-slugs";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

const schemaLabel = (slug: string) =>
	`${slug.charAt(0).toUpperCase()}${slug.slice(1)}`.replace("-", " ");

export function AddTitleMenu(props: { readonly variant: "button" | "icon" }) {
	const identity = usePluginIdentity(PLUGIN_PACKAGE_ID);
	const client = useRyot();
	const schedule = useRyotSchedule();
	return (
		<MenuButton
			label="Add a title"
			icon={<AppIcon size={18} name="plus" />}
			{...(props.variant === "icon"
				? {}
				: {
						renderTrigger: (trigger) => (
							<Button variant="secondary" {...trigger}>
								<AppIcon size={15} name="plus" />
								Add a title
							</Button>
						),
					})}
			items={builtinMediaEntitySchemaSlugs.map((slug) => ({
				key: slug,
				label: schemaLabel(slug),
				onSelect: () =>
					schedule.run(
						client.screens
							.pickEntity({
								library: mediaLibraryMembership,
								schema: {
									slug: EntitySchemaSlug.make(slug),
									owner: { kind: "plugin", pluginId: identity.pluginId },
								},
							})
							.pipe(Effect.ignore),
						() => undefined,
					),
			}))}
		/>
	);
}
