import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import clsx from "clsx";

import { AddTitleMenu } from "./add-title";

export function FirstRun(props: { readonly compact: boolean }) {
	return (
		<section className="flex min-h-96 flex-col items-center justify-center gap-3 px-6 text-center">
			<h2 className="font-display text-heading font-semibold text-text">
				Start your media library
			</h2>
			<p className="max-w-md text-sm text-text-muted">
				Bring in what you have watched, read, and played, or add your first title.
			</p>
			<div className={clsx("flex gap-3 pt-2", props.compact && "w-full flex-col")}>
				<PluginLink
					to={{ kind: "kernel-page", page: "import-data" }}
					className="flex min-h-11 items-center justify-center rounded-lg border border-accent-deep bg-accent px-4 py-2.5 font-semibold text-accent-ink"
				>
					Import your history
				</PluginLink>
				<AddTitleMenu variant="button" />
			</div>
		</section>
	);
}
