import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { EntitySchemaSlug } from "@ryot-app/plugin-client-sdk/plugin";
import { usePluginIdentity, useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button, MenuButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import {
	builtinMediaEntitySchemaSlugs,
	mediaBacklogLibraryMembership,
} from "../../shared/media-schema-slugs";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { type MediaText, useMediaMessages } from "../messages";

const schemaLabel = (text: MediaText, slug: (typeof builtinMediaEntitySchemaSlugs)[number]) => {
	const names = {
		book: text("entity-schema.book.name"),
		show: text("entity-schema.show.name"),
		anime: text("entity-schema.anime.name"),
		movie: text("entity-schema.movie.name"),
		manga: text("entity-schema.manga.name"),
		music: text("entity-schema.music.name"),
		podcast: text("entity-schema.podcast.name"),
		audiobook: text("entity-schema.audiobook.name"),
		"comic-book": text("entity-schema.comic-book.name"),
		"video-game": text("entity-schema.video-game.name"),
		"visual-novel": text("entity-schema.visual-novel.name"),
	};
	return names[slug];
};

export function AddTitleMenu(props: { readonly variant: "icon" | "button" }) {
	const identity = usePluginIdentity(PLUGIN_PACKAGE_ID);
	const client = useRyot();
	const schedule = useRyotSchedule();
	const text = useMediaMessages();
	return (
		<MenuButton
			label={text("home.add-title")}
			icon={<AppIcon size={18} name="plus" />}
			{...(props.variant === "icon"
				? {}
				: {
						renderTrigger: (trigger) => (
							<Button variant="secondary" {...trigger}>
								<AppIcon size={15} name="plus" />
								{text("home.add-title")}
							</Button>
						),
					})}
			items={builtinMediaEntitySchemaSlugs.map((slug) => ({
				key: slug,
				label: schemaLabel(text, slug),
				onSelect: () =>
					schedule.run(
						client.screens
							.pickEntity({
								library: mediaBacklogLibraryMembership,
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
