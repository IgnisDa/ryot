import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { KERNEL_SHORTCUTS } from "@ryot-app/plugin-client-contract";
import { Menu, type MenuItem, ShortcutHint } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import clsx from "clsx";

import { visibleWorkspaces, type WorkspaceTarget } from "#/modules/navigation/workspace-state";

type WorkspaceSwitcherProps = {
	readonly open: boolean;
	readonly summary: Message;
	readonly navigation: NavigationData;
	readonly catalog: PluginClientCatalog;
	readonly showShortcut?: boolean | undefined;
	readonly onOpenChange: (open: boolean) => void;
	readonly onCustomize?: undefined | (() => void);
	readonly current: null | PluginClientCatalogEntry;
	readonly onSelect: (workspace: WorkspaceTarget) => void | Promise<void>;
};

export function workspacePickerSummary(
	formatters: Formatters,
	data: NavigationData,
	installationId: string,
	t: (message: Message) => Text,
) {
	const views = data.savedViews
		.filter((item) => item.pluginInstallationId === installationId && !item.isHidden)
		.sort((a, b) => a.sortOrder - b.sortOrder);
	if (views.length === 0) {
		return t(kernelMessage("client.navigation.workspace-switcher.empty"));
	}

	const names = views.slice(0, 3).map((item) => formatDisplayText(t, item.name));
	const remaining = views.length - names.length;
	const list = formatters.list({ type: "unit", style: "short" }).format(names);
	return remaining > 0
		? t(kernelMessage("client.navigation.workspace-switcher.more", { remaining, names: list }))
		: list;
}

export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
	const t = useT();
	const formatters = useFormatters();
	const workspaces = visibleWorkspaces(props.catalog);

	const items: MenuItem[] = workspaces.map((workspace) => {
		const current = workspace.pluginId === props.current?.pluginId;
		const label = t(workspace.name);
		return {
			label,
			checked: current,
			key: workspace.installationId,
			title: `${workspace.packageId} · ${workspace.pluginId}`,
			onSelect: () => {
				if (!current) {
					void props.onSelect(workspace);
				}
			},
			accessibleLabel: t(
				kernelMessage("client.navigation.workspace-switcher.switch", { name: label }),
			),
			content: (
				<>
					<span
						className={clsx(
							"flex size-8 shrink-0 items-center justify-center rounded-lg",
							current ? "bg-accent text-accent-ink" : "bg-surface-2 text-text",
						)}
					>
						<AppIcon size={17} name={workspace.icon} />
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-sm text-text">{label}</span>
						<span className="block truncate text-xs text-text-muted">
							{workspacePickerSummary(formatters, props.navigation, workspace.installationId, t)}
						</span>
					</span>
					<AppIcon
						size={15}
						name={current ? "circle-check" : "chevron-right"}
						className={current ? "text-accent-text" : "text-text-subtle"}
					/>
				</>
			),
		};
	});
	if (props.onCustomize !== undefined) {
		items.push({
			key: "customize",
			icon: "sliders-horizontal",
			onSelect: props.onCustomize,
			accessibleLabel: t(kernelMessage("client.shell.customize.title")),
			label: t(kernelMessage("client.navigation.workspace-switcher.customize")),
		});
	}

	return (
		<Menu
			items={items}
			align="start"
			focusSelected
			onSelectAfterClose
			{...(props.showShortcut === true &&
				workspaces.length > 0 && { shortcut: KERNEL_SHORTCUTS.workspaceSwitcher })}
			open={props.open}
			matchTriggerWidth
			onOpenChange={props.onOpenChange}
			label={t(kernelMessage("client.shell.section.workspaces"))}
			trigger={
				<button
					type="button"
					disabled={workspaces.length === 0}
					aria-keyshortcuts={
						props.showShortcut === true ? KERNEL_SHORTCUTS.workspaceSwitcher : undefined
					}
					className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-left shadow-sm"
					title={
						props.current === null
							? undefined
							: `${props.current.packageId} · ${props.current.pluginId}`
					}
					aria-label={
						props.current === null
							? t(kernelMessage("client.navigation.workspace-switcher.none-label"))
							: t(
									kernelMessage("client.navigation.workspace-switcher.current", {
										scope: props.current.scope,
										name: t(props.current.name),
										packageId: props.current.packageId,
									}),
								)
					}
				>
					<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
						<AppIcon size={17} name={props.current?.icon ?? "puzzle"} />
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-sm font-medium text-text">
							{props.current === null
								? t(kernelMessage("client.navigation.workspace-switcher.none"))
								: t(props.current.name)}
						</span>
						<span className="block truncate text-xs text-text-muted">{t(props.summary)}</span>
					</span>
					{props.showShortcut === true && (
						<ShortcutHint shortcut={KERNEL_SHORTCUTS.workspaceSwitcher} />
					)}
					<AppIcon size={15} name="chevron-down" className="shrink-0 text-text-subtle" />
				</button>
			}
		/>
	);
}
