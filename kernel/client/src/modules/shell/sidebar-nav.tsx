import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { KERNEL_SHORTCUTS } from "@ryot-app/plugin-client-contract";
import { ShortcutHint } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import clsx from "clsx";
import type { ReactNode } from "react";

import { ASSISTANT_NAME } from "#/modules/assistant/presentation";
import {
	type AssistantMood,
	assistantMoodLabels,
	AssistantSprite,
} from "#/modules/assistant/sprite";
import { activateLink } from "#/modules/navigation/link-activation";
import type { WorkspaceTarget } from "#/modules/navigation/workspace-state";
import { WorkspaceSwitcher } from "#/modules/navigation/workspace-switcher";
import type { CustomizeSection } from "#/modules/shell/customize/customize-state";
import {
	navigationViewHref,
	type SidebarEntry,
	type SidebarItem,
	sidebarItemKey,
	sidebarOverflow,
	type SidebarSectionName,
	type SidebarSections,
	workspaceSummary,
} from "#/modules/shell/sidebar-sections";

export type SidebarAssistant = {
	readonly attention: number;
	readonly onOpen: () => void;
	readonly mood: AssistantMood;
};

type SidebarNavProps = {
	readonly activeHome: boolean;
	readonly activeKey: null | string;
	readonly onOpenSearch: () => void;
	readonly sections: SidebarSections;
	readonly navigation: NavigationData;
	readonly assistant: SidebarAssistant;
	readonly showSearchShortcut: boolean;
	readonly catalog: PluginClientCatalog;
	readonly onCreateCollection: () => void;
	readonly workspaceSwitcherOpen: boolean;
	readonly onCustomize?: undefined | (() => void);
	readonly current: null | PluginClientCatalogEntry;
	readonly onNavigateHome: () => void | Promise<void>;
	readonly showWorkspaceShortcut?: boolean | undefined;
	readonly onWorkspaceSwitcherOpenChange: (open: boolean) => void;
	readonly onNavigateItem: (item: SidebarEntry) => void | Promise<void>;
	readonly onSelectWorkspace: (workspace: WorkspaceTarget) => void | Promise<void>;
	readonly expandedSections?: undefined | Partial<Record<SidebarSectionName, boolean>>;
	readonly onToggleSection?: undefined | ((section: SidebarSectionName, expanded: boolean) => void);
	readonly onEditSection?: undefined | ((section: Exclude<CustomizeSection, "workspaces">) => void);
};

export function SidebarNav(props: SidebarNavProps) {
	const t = useT();
	const formatters = useFormatters();
	const href = (item: SidebarItem) => {
		if (item.kind === "home") {
			return props.current === null ? "/" : pluginPath(props.current.packageId);
		}
		return item.kind === "view" ? navigationViewHref(item) : `/e/${encodeURIComponent(item.slug)}`;
	};
	const navigate = (item: SidebarItem) =>
		item.kind === "home" ? props.onNavigateHome() : props.onNavigateItem(item);
	const isActive = (item: SidebarItem) =>
		item.kind === "home" ? props.activeHome : props.activeKey === sidebarItemKey(item);
	const overflow = (section: SidebarSectionName, items: readonly SidebarItem[]) => {
		const result = sidebarOverflow(items, { isActive, stored: props.expandedSections?.[section] });
		return {
			...result,
			toggle: result.collapsible
				? {
						expanded: result.expanded,
						hiddenCount: result.hiddenCount,
						run: () => props.onToggleSection?.(section, !result.expanded),
					}
				: undefined,
		};
	};
	const views = overflow(
		"views",
		props.sections.views.filter((item) => item.kind !== "home" || props.current !== null),
	);
	const savedViews = overflow("savedViews", props.sections.savedViews);
	const collections = overflow("collections", props.sections.collections);

	return (
		<nav
			className="flex flex-col gap-4 px-3 pt-4 pb-5"
			aria-label={t(kernelMessage("client.shell.sidebar.workspace"))}
		>
			<WorkspaceSwitcher
				current={props.current}
				catalog={props.catalog}
				navigation={props.navigation}
				onCustomize={props.onCustomize}
				open={props.workspaceSwitcherOpen}
				onSelect={props.onSelectWorkspace}
				summary={workspaceSummary(props.sections)}
				showShortcut={props.showWorkspaceShortcut}
				onOpenChange={props.onWorkspaceSwitcherOpenChange}
			/>
			<button
				type="button"
				onClick={props.onOpenSearch}
				aria-label={t(kernelMessage("client.shell.sidebar.open-command-center"))}
				aria-keyshortcuts={props.showSearchShortcut ? KERNEL_SHORTCUTS.commandCenter : undefined}
				className="flex h-8 items-center gap-2.5 rounded-md bg-surface-2 px-2.5 text-left transition-colors duration-100 hover:bg-surface-3 motion-reduce:transition-none"
			>
				<AppIcon size={16} name="search" className="text-text-muted" />
				<span className="min-w-0 flex-1 text-sm text-text-subtle">
					{t(kernelMessage("common.action.search"))}
				</span>
				{props.showSearchShortcut && <ShortcutHint shortcut={KERNEL_SHORTCUTS.commandCenter} />}
			</button>

			<button
				type="button"
				onClick={props.assistant.onOpen}
				aria-keyshortcuts={props.showSearchShortcut ? KERNEL_SHORTCUTS.assistant : undefined}
				className="flex h-10 items-center gap-2 rounded-md bg-accent-soft px-1.5 text-left transition-colors duration-100 hover:bg-surface-3 motion-reduce:transition-none"
			>
				<AssistantSprite className="w-7" mood={props.assistant.mood} />
				<span className="grid min-w-0 flex-1 leading-tight">
					<span className="text-sm font-medium text-text">
						{t(kernelMessage("client.shell.sidebar.ask", { name: ASSISTANT_NAME }))}
					</span>
					{props.assistant.mood === "idle" ? null : (
						<span className="truncate text-micro font-medium text-accent-text">
							{t(assistantMoodLabels[props.assistant.mood])}
							{props.assistant.attention > 1
								? ` · ${formatters.number().format(props.assistant.attention)}`
								: ""}
						</span>
					)}
				</span>
				{props.showSearchShortcut && <ShortcutHint shortcut={KERNEL_SHORTCUTS.assistant} />}
			</button>

			<SidebarSection
				toggle={views.toggle}
				className="max-h-83.5"
				title={kernelMessage("client.shell.section.views")}
				onEdit={
					props.onEditSection === undefined ? undefined : () => props.onEditSection?.("views")
				}
			>
				{views.visible.map((item) => (
					<SidebarRow
						item={item}
						href={href(item)}
						active={isActive(item)}
						key={sidebarItemKey(item)}
						onNavigate={() => navigate(item)}
					/>
				))}
			</SidebarSection>

			<SidebarSection
				className="max-h-52"
				toggle={savedViews.toggle}
				count={props.sections.savedViews.length}
				isEmpty={props.sections.savedViews.length === 0}
				title={kernelMessage("client.shell.section.saved-views")}
				emptyMessage={kernelMessage("client.shell.empty-saved-views")}
				onEdit={
					props.onEditSection === undefined ? undefined : () => props.onEditSection?.("savedViews")
				}
			>
				{savedViews.visible.map((item) => (
					<SidebarRow
						item={item}
						href={href(item)}
						key={sidebarItemKey(item)}
						onNavigate={() => navigate(item)}
						active={props.activeKey === sidebarItemKey(item)}
					/>
				))}
			</SidebarSection>

			<SidebarSection
				className="max-h-52"
				toggle={collections.toggle}
				count={props.sections.collections.length}
				isEmpty={props.sections.collections.length === 0}
				title={kernelMessage("client.shell.sidebar.collections")}
				emptyMessage={kernelMessage("client.shell.sidebar.empty-collections")}
				onCreate={{
					run: props.onCreateCollection,
					label: kernelMessage("renderer.collections.new"),
				}}
			>
				{collections.visible.map((item) => (
					<SidebarRow
						item={item}
						href={href(item)}
						key={sidebarItemKey(item)}
						onNavigate={() => navigate(item)}
						active={props.activeKey === sidebarItemKey(item)}
					/>
				))}
			</SidebarSection>
		</nav>
	);
}

function SidebarRow(props: {
	readonly href: string;
	readonly active: boolean;
	readonly item: SidebarItem;
	readonly onNavigate: () => void | Promise<void>;
}) {
	const t = useT();
	return (
		<a
			href={props.href}
			onClick={activateLink(props.onNavigate)}
			aria-current={props.active ? "page" : undefined}
			className={clsx(
				"group/row flex min-h-8 items-center gap-2.5 rounded-md px-2.5 transition-colors duration-100 motion-reduce:transition-none",
				props.active ? "bg-nav-indicator" : "hover:bg-hover",
			)}
		>
			<AppIcon size={16} name={props.item.icon} className="text-text-muted" />
			<span
				className={clsx(
					"min-w-0 flex-1 truncate text-sm font-medium",
					props.active ? "text-text" : "text-text-muted",
				)}
			>
				{formatDisplayText(t, props.item.name)}
			</span>
			{props.item.kind !== "home" && (
				<AppIcon
					size={14}
					name="chevron-right"
					className="text-text-subtle pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100"
				/>
			)}
		</a>
	);
}

function SidebarSection(props: {
	readonly title: Message;
	readonly count?: number;
	readonly isEmpty?: boolean;
	readonly className: string;
	readonly children: ReactNode;
	readonly emptyMessage?: Message;
	readonly onEdit?: undefined | (() => void);
	readonly onCreate?: undefined | { readonly label: Message; readonly run: () => void };
	readonly toggle?:
		| undefined
		| { readonly run: () => void; readonly expanded: boolean; readonly hiddenCount: number };
}) {
	const t = useT();
	return (
		<section className="group flex flex-col gap-1">
			<header className="flex items-center gap-2 px-1">
				<h2 className="text-[11px] font-semibold tracking-[0.07em] text-text-subtle uppercase">
					{t(props.title)}
				</h2>
				{props.count !== undefined && (
					<span className="text-[11px] text-text-subtle tabular-nums">{props.count}</span>
				)}
				{props.onEdit !== undefined && (
					<button
						type="button"
						onClick={props.onEdit}
						aria-label={t(
							kernelMessage("client.shell.sidebar.edit-section", { title: props.title }),
						)}
						className="ml-auto rounded px-1.5 py-0.5 text-xs font-medium text-text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
					>
						{t(kernelMessage("client.shell.sidebar.edit"))}
					</button>
				)}
				{props.onCreate !== undefined && (
					<button
						type="button"
						onClick={props.onCreate.run}
						aria-label={t(props.onCreate.label)}
						className={clsx(
							"rounded p-0.5 text-text-muted hover:text-text",
							props.onEdit === undefined && "ml-auto",
						)}
					>
						<AppIcon size={14} name="plus" />
					</button>
				)}
			</header>
			<div className={clsx("flex flex-col gap-0.5 overflow-y-auto", props.className)}>
				{props.isEmpty ? (
					<p className="px-2 py-1 text-xs text-text-subtle">
						{props.emptyMessage === undefined ? null : t(props.emptyMessage)}
					</p>
				) : (
					props.children
				)}
				{props.toggle !== undefined && (
					<button
						type="button"
						onClick={props.toggle.run}
						aria-expanded={props.toggle.expanded}
						className="min-h-8 rounded-md px-2.5 text-left text-label font-medium text-text-muted hover:bg-hover"
					>
						{t(
							props.toggle.expanded
								? kernelMessage("client.shell.sidebar.show-less")
								: kernelMessage("client.shell.sidebar.show-more", {
										count: props.toggle.hiddenCount,
									}),
						)}
					</button>
				)}
			</div>
		</section>
	);
}
