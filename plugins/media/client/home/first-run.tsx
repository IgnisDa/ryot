import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { EntitySchemaSlug, PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { usePluginIdentity, useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button, MenuButton } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";

import {
	builtinMediaEntitySchemaSlugs,
	mediaLibraryMembership,
} from "../../shared/media-schema-slugs";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

const schemaLabel = (slug: string) =>
	`${slug.charAt(0).toUpperCase()}${slug.slice(1)}`.replace("-", " ");

export function FirstRun(props: { readonly compact: boolean }) {
	const identity = usePluginIdentity(PLUGIN_PACKAGE_ID);
	const client = useRyot();
	const schedule = useRyotSchedule();
	return (
		<section className="flex min-h-96 flex-col items-center justify-center gap-3 px-6 text-center">
			<h2 className="font-display font-semibold text-xl text-text">Start your media library</h2>
			<p className="max-w-md font-ui text-sm text-text-muted">
				Bring in what you have watched, read, and played, or add your first title.
			</p>
			<div className={clsx("flex gap-3 pt-2", props.compact && "w-full flex-col")}>
				<PluginLink
					to={{ kind: "kernel-page", page: "import-data" }}
					className="flex min-h-11 items-center justify-center rounded-lg border border-accent-deep bg-accent px-4 py-2.5 font-semibold text-accent-ink"
				>
					Import your history
				</PluginLink>
				<MenuButton
					label="Add a title"
					renderTrigger={(trigger) => (
						<Button variant="secondary" {...trigger}>
							Add a title
						</Button>
					)}
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
			</div>
		</section>
	);
}
