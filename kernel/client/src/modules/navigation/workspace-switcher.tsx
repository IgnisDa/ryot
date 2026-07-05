import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot/ryotql-recipes/plugin-client-catalog";
import { useId, useRef, useState } from "react";

import { AppIcon } from "#/modules/navigation/app-icon";
import { visibleWorkspaces } from "#/modules/navigation/workspace-state";

type WorkspaceSwitcherProps = {
	readonly catalog: PluginClientCatalog;
	readonly current: PluginClientCatalogEntry | null;
	readonly onSelect: (slug: string) => void | Promise<void>;
};

export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
	const menuId = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const [isOpen, setIsOpen] = useState(false);
	const workspaces = visibleWorkspaces(props.catalog);
	const close = () => {
		setIsOpen(false);
		queueMicrotask(() => trigger.current?.focus());
	};
	const select = (workspace: PluginClientCatalogEntry) => {
		close();
		if (workspace.slug !== props.current?.slug) {
			queueMicrotask(() => void props.onSelect(workspace.slug));
		}
	};

	return (
		<div
			className="relative"
			onKeyDown={(event) => {
				if (isOpen && event.key === "Escape") {
					event.preventDefault();
					close();
				}
			}}
		>
			<button
				type="button"
				ref={trigger}
				aria-controls={menuId}
				aria-expanded={isOpen}
				aria-haspopup="dialog"
				disabled={workspaces.length === 0}
				onClick={() => (isOpen ? close() : setIsOpen(true))}
				className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-left shadow-sm"
				aria-label={
					props.current === null
						? "No workspace, Plugin workspace"
						: `${props.current.name} workspace, ${props.current.slug}`
				}
			>
				<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
					<AppIcon name={props.current?.icon ?? "puzzle"} size={17} />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-text">
						{props.current?.name ?? "No workspace"}
					</span>
					<span className="block truncate text-xs text-text-muted">
						{props.current?.slug ?? "Plugin workspace"}
					</span>
				</span>
				<AppIcon name="chevron-down" size={15} className="shrink-0 text-text-subtle" />
			</button>

			{isOpen && (
				<div
					id={menuId}
					role="dialog"
					aria-label="Workspaces"
					className="absolute top-full left-0 z-50 mt-2 flex w-[320px] flex-col gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-card"
				>
					{workspaces.map((workspace) => {
						const isCurrent = workspace.slug === props.current?.slug;
						return (
							<button
								type="button"
								aria-pressed={isCurrent}
								key={workspace.installationId}
								onClick={() => select(workspace)}
								aria-label={`Switch to ${workspace.name} workspace`}
								className={[
									"flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left",
									isCurrent ? "bg-accent-soft" : "hover:bg-surface-2",
								].join(" ")}
							>
								<span
									className={[
										"flex size-8 shrink-0 items-center justify-center rounded-lg",
										isCurrent ? "bg-accent text-accent-ink" : "bg-surface-2 text-text",
									].join(" ")}
								>
									<AppIcon name={workspace.icon} size={17} />
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm text-text">{workspace.name}</span>
									<span className="block truncate text-xs text-text-muted">{workspace.slug}</span>
								</span>
								<AppIcon
									size={15}
									name={isCurrent ? "circle-check" : "chevron-right"}
									className={isCurrent ? "text-accent-text" : "text-text-subtle"}
								/>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
