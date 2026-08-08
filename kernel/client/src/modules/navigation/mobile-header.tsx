import type { PluginClientCatalogEntry } from "@ryot/ryotql-recipes/plugin-client-catalog";
import type { RefObject } from "react";

import { AppIcon } from "#/modules/navigation/app-icon";

type MobileHeaderProps = {
	readonly isOpen: boolean;
	readonly drawerId: string;
	readonly onOpen: () => void;
	readonly current: PluginClientCatalogEntry | null;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
};

export function MobileHeader(props: MobileHeaderProps) {
	return (
		<header
			data-testid="mobile-header"
			className="shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)] md:hidden"
		>
			<div className="flex h-16 items-center gap-3 px-4">
				<button
					type="button"
					ref={props.triggerRef}
					onClick={props.onOpen}
					aria-expanded={props.isOpen}
					aria-label="Open navigation"
					aria-controls={props.drawerId}
					className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-raised text-text shadow-sm hover:bg-surface-2"
				>
					<AppIcon name="menu" size={19} />
				</button>
				<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
					<AppIcon name={props.current?.icon ?? "puzzle"} size={17} />
				</span>
				<span className="min-w-0">
					<span className="block truncate text-sm font-medium text-text">
						{props.current?.name ?? "No workspace"}
					</span>
					<span className="block truncate text-xs text-text-muted">
						{props.current?.slug ?? "Plugin workspace"}
					</span>
				</span>
			</div>
		</header>
	);
}
