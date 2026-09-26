import { KERNEL_SHORTCUTS } from "@ryot-app/client-plugin-contract";
import {
	OverlayScope,
	useDismissOnOutside,
	useShortcut,
	useValueChange,
} from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import clsx from "clsx";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { workspacePickerSummary } from "#/modules/navigation/sidebar-sections";
import { visibleWorkspaces } from "#/modules/navigation/workspace-state";

type WorkspaceSwitcherProps = {
	readonly open: boolean;
	readonly summary: string;
	readonly navigation: NavigationData;
	readonly catalog: PluginClientCatalog;
	readonly showShortcut?: boolean | undefined;
	readonly onOpenChange: (open: boolean) => void;
	readonly onCustomize?: (() => void) | undefined;
	readonly current: PluginClientCatalogEntry | null;
	readonly onSelect: (slug: string) => void | Promise<void>;
};

const WORKSPACE_SHORTCUT_LABEL = "⌘⇧Space";

function WorkspaceShortcut(props: { readonly enabled: boolean; readonly onOpen: () => void }) {
	useShortcut(KERNEL_SHORTCUTS.workspaceSwitcher, props.onOpen, { enabled: props.enabled });
	return null;
}

export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
	const menuId = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const container = useRef<HTMLDivElement>(null);
	const items = useRef<Array<HTMLButtonElement | null>>([]);
	const workspaces = visibleWorkspaces(props.catalog);
	const menuLength = workspaces.length + (props.onCustomize === undefined ? 0 : 1);
	const currentSlug = props.current?.slug;
	const initialIndex = Math.max(
		0,
		workspaces.findIndex((workspace) => workspace.slug === currentSlug),
	);
	const [activeIndex, setActiveIndex] = useState(initialIndex);
	const close = (restoreFocus: boolean) => {
		props.onOpenChange(false);
		if (restoreFocus) {
			queueMicrotask(() => trigger.current?.focus());
		}
	};
	const open = () => {
		if (workspaces.length === 0) {
			return;
		}
		setActiveIndex(initialIndex);
		items.current[initialIndex]?.focus();
		props.onOpenChange(true);
	};
	useShortcut(KERNEL_SHORTCUTS.workspaceSwitcher, open, { enabled: props.showShortcut === true });
	const select = (workspace: PluginClientCatalogEntry) => {
		close(true);
		if (workspace.slug !== props.current?.slug) {
			queueMicrotask(() => void props.onSelect(workspace.slug));
		}
	};
	const customize = () => {
		close(true);
		queueMicrotask(() => props.onCustomize?.());
	};

	const openTarget = props.open ? JSON.stringify([currentSlug ?? null, initialIndex]) : undefined;
	useValueChange(openTarget, (target) => {
		if (target !== undefined) {
			setActiveIndex(initialIndex);
		}
	});
	const focusInitialItem = useEffectEvent(() => items.current[initialIndex]?.focus());
	useEffect(() => {
		if (openTarget !== undefined) {
			focusInitialItem();
		}
	}, [openTarget]);

	useDismissOnOutside([container], () => props.onOpenChange(false), { enabled: props.open });

	return (
		<OverlayScope enabled={props.open} onEscape={() => close(true)}>
			<WorkspaceShortcut onOpen={open} enabled={props.showShortcut === true} />
			<div ref={container} className="relative">
				<button
					type="button"
					ref={trigger}
					aria-haspopup="menu"
					aria-controls={menuId}
					aria-expanded={props.open}
					disabled={workspaces.length === 0}
					onClick={() => (props.open ? close(true) : open())}
					aria-keyshortcuts={
						props.showShortcut === true ? KERNEL_SHORTCUTS.workspaceSwitcher : undefined
					}
					className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-left shadow-sm"
					onPointerDown={(event) => {
						if (props.open && event.button === 0) {
							event.preventDefault();
						}
					}}
					aria-label={
						props.current === null
							? "No workspace, Plugin workspace"
							: `${props.current.name} workspace, ${props.current.slug}`
					}
				>
					<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
						<AppIcon size={17} name={props.current?.icon ?? "puzzle"} />
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-sm font-medium text-text">
							{props.current?.name ?? "No workspace"}
						</span>
						<span className="block truncate text-xs text-text-muted">{props.summary}</span>
					</span>
					{props.showShortcut === true && (
						<span
							aria-hidden="true"
							className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-subtle"
						>
							{WORKSPACE_SHORTCUT_LABEL}
						</span>
					)}
					<AppIcon size={15} name="chevron-down" className="shrink-0 text-text-subtle" />
				</button>

				{props.open && (
					<div
						id={menuId}
						role="menu"
						aria-label="Workspaces"
						onBlur={(event) => {
							if (!event.currentTarget.contains(event.relatedTarget)) {
								close(false);
							}
						}}
						className="absolute top-full left-0 z-50 mt-2 flex w-full flex-col gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-card"
						onKeyDown={(event) => {
							let nextIndex: number | null = null;
							if (event.key === "Home") {
								nextIndex = 0;
							}
							if (event.key === "End") {
								nextIndex = menuLength - 1;
							}
							if (event.key === "ArrowDown") {
								nextIndex = (activeIndex + 1) % menuLength;
							}
							if (event.key === "ArrowUp") {
								nextIndex = (activeIndex - 1 + menuLength) % menuLength;
							}
							if (nextIndex !== null) {
								event.preventDefault();
								setActiveIndex(nextIndex);
								items.current[nextIndex]?.focus();
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
									onClick={() => select(workspace)}
									onFocus={() => setActiveIndex(index)}
									tabIndex={index === activeIndex ? 0 : -1}
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
										<AppIcon size={17} name={workspace.icon} />
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm text-text">{workspace.name}</span>
										<span className="block truncate text-xs text-text-muted">
											{workspacePickerSummary(props.navigation, workspace.slug)}
										</span>
									</span>
									<AppIcon
										size={15}
										name={isCurrent ? "circle-check" : "chevron-right"}
										className={clsx(isCurrent ? "text-accent-text" : "text-text-subtle")}
									/>
								</button>
							);
						})}
						{props.onCustomize !== undefined && (
							<>
								<div role="none" className="my-1 h-px bg-border" />
								<button
									type="button"
									role="menuitem"
									onClick={customize}
									aria-label="Customize sidebar"
									onFocus={() => setActiveIndex(workspaces.length)}
									tabIndex={activeIndex === workspaces.length ? 0 : -1}
									ref={(item) => {
										items.current[workspaces.length] = item;
									}}
									className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left hover:bg-surface"
								>
									<AppIcon size={16} name="sliders-horizontal" className="text-text-muted" />
									<span className="text-sm font-medium text-text">Customize sidebar…</span>
								</button>
							</>
						)}
					</div>
				)}
			</div>
		</OverlayScope>
	);
}
