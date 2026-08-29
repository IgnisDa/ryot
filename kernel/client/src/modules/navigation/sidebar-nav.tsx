import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import clsx from "clsx";
import type { ReactNode } from "react";

import { AppIcon } from "#/modules/navigation/app-icon";
import type { CustomizeSection } from "#/modules/navigation/customize/customize-state";
import { activateLink } from "#/modules/navigation/link-activation";
import {
	sidebarItemKey,
	type SidebarItem,
	type SidebarSections,
	workspaceSummary,
} from "#/modules/navigation/sidebar-sections";
import { WorkspaceSwitcher } from "#/modules/navigation/workspace-switcher";

type SidebarNavProps = {
	readonly activeHome: boolean;
	readonly activeKey: string | null;
	readonly onOpenSearch: () => void;
	readonly sections: SidebarSections;
	readonly showSearchShortcut: boolean;
	readonly catalog: PluginClientCatalog;
	readonly onCustomize?: (() => void) | undefined;
	readonly current: PluginClientCatalogEntry | null;
	readonly onNavigateHome: () => void | Promise<void>;
	readonly showWorkspaceShortcut?: boolean | undefined;
	readonly onSelectWorkspace: (slug: string) => void | Promise<void>;
	readonly onNavigateItem: (item: SidebarItem) => void | Promise<void>;
	readonly onEditSection?: ((section: CustomizeSection) => void) | undefined;
};

function SidebarRow(props: {
	readonly href: string;
	readonly active: boolean;
	readonly item: SidebarItem;
	readonly onNavigate: () => void | Promise<void>;
}) {
	return (
		<a
			href={props.href}
			onClick={activateLink(props.onNavigate)}
			aria-current={props.active ? "page" : undefined}
			className={clsx(
				"flex min-h-8 items-center gap-2.5 rounded-lg px-2.5",
				props.active ? "bg-nav-indicator" : "hover:bg-surface-2",
			)}
		>
			<AppIcon name={props.item.icon} size={16} className="text-text-muted" />
			<span
				className={clsx(
					"min-w-0 flex-1 truncate text-base",
					props.active ? "font-medium text-text" : "text-text-muted",
				)}
			>
				{props.item.name}
			</span>
			{props.item.kind !== "home" && (
				<AppIcon name="chevron-right" size={15} className="text-text-subtle" />
			)}
		</a>
	);
}

function SidebarSection(props: {
	readonly title: string;
	readonly count?: number;
	readonly isEmpty?: boolean;
	readonly className: string;
	readonly children: ReactNode;
	readonly emptyMessage?: string;
	readonly onEdit?: (() => void) | undefined;
}) {
	return (
		<section className="group flex flex-col gap-1.5">
			<header className="flex items-center gap-2 px-1">
				<h2 className="text-xs font-semibold uppercase tracking-[1.6px] text-text-subtle">
					{props.title}
				</h2>
				{props.count !== undefined && (
					<span className="font-mono text-xs text-text-subtle">{props.count}</span>
				)}
				{props.onEdit !== undefined && (
					<button
						type="button"
						onClick={props.onEdit}
						aria-label={`Edit ${props.title} section`}
						className="ml-auto rounded px-1.5 py-0.5 text-xs font-medium text-text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
					>
						Edit
					</button>
				)}
			</header>
			<div className={clsx("flex flex-col gap-0.5 overflow-y-auto", props.className)}>
				{props.isEmpty ? (
					<p className="px-2 py-1 text-xs text-text-subtle">{props.emptyMessage}</p>
				) : (
					props.children
				)}
			</div>
		</section>
	);
}

export function SidebarNav(props: SidebarNavProps) {
	const href = (item: SidebarItem) => {
		if (item.kind === "home") {
			return props.current === null ? "/" : `/${props.current.slug}`;
		}
		return item.kind === "view" ? `/v/${item.slug}` : `/e/${item.slug}`;
	};
	const navigate = (item: SidebarItem) =>
		item.kind === "home" ? props.onNavigateHome() : props.onNavigateItem(item);

	return (
		<nav aria-label="Workspace" className="flex flex-col gap-2.5 px-3 pt-4.5 pb-5">
			<WorkspaceSwitcher
				current={props.current}
				catalog={props.catalog}
				onCustomize={props.onCustomize}
				onSelect={props.onSelectWorkspace}
				summary={workspaceSummary(props.sections)}
				showShortcut={props.showWorkspaceShortcut}
			/>
			<button
				type="button"
				onClick={props.onOpenSearch}
				aria-label="Open command center"
				className="flex h-10 items-center gap-2.5 rounded-lg border border-border bg-bg px-2.5 text-left"
			>
				<AppIcon name="search" size={16} className="text-text-muted" />
				<span className="min-w-0 flex-1 text-sm text-text-subtle">Search</span>
				{props.showSearchShortcut && (
					<span className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-text-subtle">
						⌘K
					</span>
				)}
			</button>

			<SidebarSection
				title="Views"
				className="max-h-83.5"
				onEdit={
					props.onEditSection === undefined ? undefined : () => props.onEditSection?.("views")
				}
			>
				{props.sections.views
					.filter((item) => item.kind !== "home" || props.current !== null)
					.map((item) => (
						<SidebarRow
							item={item}
							href={href(item)}
							key={sidebarItemKey(item)}
							onNavigate={() => navigate(item)}
							active={
								item.kind === "home" ? props.activeHome : props.activeKey === sidebarItemKey(item)
							}
						/>
					))}
			</SidebarSection>

			<div className="my-2 h-px bg-border" />
			<SidebarSection
				title="Saved Views"
				className="max-h-52"
				emptyMessage="No saved views yet."
				count={props.sections.savedViews.length}
				isEmpty={props.sections.savedViews.length === 0}
				onEdit={
					props.onEditSection === undefined ? undefined : () => props.onEditSection?.("savedViews")
				}
			>
				{props.sections.savedViews.map((item) => (
					<SidebarRow
						item={item}
						href={href(item)}
						key={sidebarItemKey(item)}
						onNavigate={() => navigate(item)}
						active={props.activeKey === sidebarItemKey(item)}
					/>
				))}
			</SidebarSection>

			<div className="my-2 h-px bg-border" />
			<SidebarSection
				title="Collections"
				className="max-h-52"
				emptyMessage="No collections yet."
				count={props.sections.collections.length}
				isEmpty={props.sections.collections.length === 0}
			>
				{props.sections.collections.map((item) => (
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
