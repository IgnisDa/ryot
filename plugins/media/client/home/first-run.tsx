import { PluginLink } from "@ryot-app/client-sdk/plugin";
import { useRyot } from "@ryot-app/client-sdk/react";
import { Button, Menu } from "@ryot-app/client-ui-sdk";
import clsx from "clsx";
import { useRef, useState } from "react";

import { builtinMediaEntitySchemaSlugs, mediaPluginSlug } from "../../shared/media-schema-slugs";

const schemaLabel = (slug: string) =>
	`${slug.charAt(0).toUpperCase()}${slug.slice(1)}`.replace("-", " ");

export function FirstRun(props: { readonly compact: boolean }) {
	const client = useRyot();
	const trigger = useRef<HTMLButtonElement>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
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
				<Button
					ref={trigger}
					variant="secondary"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					onClick={() => setMenuOpen((open) => !open)}
				>
					Add a title
				</Button>
			</div>
			{menuOpen ? (
				<Menu
					label="Add a title"
					triggerRef={trigger}
					activeIndex={activeIndex}
					onActiveIndexChange={setActiveIndex}
					onClose={(restoreFocus) => {
						setMenuOpen(false);
						if (restoreFocus) {
							trigger.current?.focus();
						}
					}}
					items={builtinMediaEntitySchemaSlugs.map((slug) => ({
						key: slug,
						label: schemaLabel(slug),
						onSelect: () => {
							setMenuOpen(false);
							client.screens.openProviderSearch({
								entitySchemaSlug: slug,
								ownerPluginId: mediaPluginSlug,
							});
						},
					}))}
				/>
			) : null}
		</section>
	);
}
