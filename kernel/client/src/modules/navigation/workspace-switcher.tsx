import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot/ryotql-recipes/plugin-client-catalog";
import clsx from "clsx";
import { useEffect, useId, useRef, useState } from "react";

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
	const container = useRef<HTMLDivElement>(null);
	const items = useRef<Array<HTMLButtonElement | null>>([]);
	const [isOpen, setIsOpen] = useState(false);
	const workspaces = visibleWorkspaces(props.catalog);
	const initialIndex = Math.max(
		0,
		workspaces.findIndex((workspace) => workspace.slug === props.current?.slug),
	);
	const [activeIndex, setActiveIndex] = useState(initialIndex);
	const close = (restoreFocus: boolean) => {
		setIsOpen(false);
		if (restoreFocus) {
			queueMicrotask(() => trigger.current?.focus());
		}
	};
	const open = () => {
		setActiveIndex(initialIndex);
		setIsOpen(true);
	};
	const select = (workspace: PluginClientCatalogEntry) => {
		close(true);
		if (workspace.slug !== props.current?.slug) {
			queueMicrotask(() => void props.onSelect(workspace.slug));
		}
	};

	useEffect(() => {
		if (isOpen) {
			items.current[activeIndex]?.focus();
		}
	}, [activeIndex, isOpen]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const dismiss = (event: PointerEvent) => {
			if (!container.current?.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};
		document.addEventListener("pointerdown", dismiss);
		return () => document.removeEventListener("pointerdown", dismiss);
	}, [isOpen]);

	return (
		<div
			ref={container}
			className="relative"
			onKeyDown={(event) => {
				if (isOpen && event.key === "Escape") {
					event.stopPropagation();
					event.preventDefault();
					close(true);
				}
			}}
		>
			<button
				type="button"
				ref={trigger}
				aria-haspopup="menu"
				aria-controls={menuId}
				aria-expanded={isOpen}
				disabled={workspaces.length === 0}
				onClick={() => (isOpen ? close(true) : open())}
				className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-left shadow-sm"
				aria-label={
					props.current === null
						? "No workspace, Plugin workspace"
						: `${props.current.name} workspace, ${props.current.slug}`
				}
				onPointerDown={(event) => {
					if (isOpen && event.button === 0) {
						event.preventDefault();
					}
				}}
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
					role="menu"
					aria-label="Workspaces"
					className="absolute top-full left-0 z-50 mt-2 flex w-full flex-col gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-card"
					onBlur={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
							close(false);
						}
					}}
					onKeyDown={(event) => {
						let nextIndex: number | null = null;
						if (event.key === "Home") {
							nextIndex = 0;
						}
						if (event.key === "End") {
							nextIndex = workspaces.length - 1;
						}
						if (event.key === "ArrowDown") {
							nextIndex = (activeIndex + 1) % workspaces.length;
						}
						if (event.key === "ArrowUp") {
							nextIndex = (activeIndex - 1 + workspaces.length) % workspaces.length;
						}
						if (nextIndex !== null) {
							event.preventDefault();
							setActiveIndex(nextIndex);
						}
					}}
				>
					{workspaces.map((workspace, index) => {
						const isCurrent = workspace.slug === props.current?.slug;
						return (
							<button
								type="button"
								role="menuitemradio"
								aria-checked={isCurrent}
								key={workspace.installationId}
								tabIndex={index === activeIndex ? 0 : -1}
								onFocus={() => setActiveIndex(index)}
								onClick={() => select(workspace)}
								aria-label={`Switch to ${workspace.name} workspace`}
								ref={(item) => {
									items.current[index] = item;
								}}
								className={clsx(
									"flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left",
									isCurrent ? "bg-accent-soft" : "hover:bg-surface-2",
								)}
							>
								<span
									className={clsx(
										"flex size-8 shrink-0 items-center justify-center rounded-lg",
										isCurrent ? "bg-accent text-accent-ink" : "bg-surface-2 text-text",
									)}
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
									className={clsx(isCurrent ? "text-accent-text" : "text-text-subtle")}
								/>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
