import type { EntityBrowserLayout } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	Button,
	MenuButton,
	type MenuItem,
	ScreenBarButton,
	ScreenFrame,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Match } from "effect";
import { type ComponentProps, type ReactNode, type Ref, useRef } from "react";
import { createPortal } from "react-dom";

import { activeFiltersPhrase, filtersLabel, ViewFiltersSheet } from "./filters";
import {
	usePageShortcut,
	usePluginChrome,
	usePluginScreenSurface,
	usePluginTitle,
} from "./navigation/routing";

type ViewOptions = {
	readonly open: boolean;
	readonly content: ReactNode;
	readonly activeCount: number;
	readonly compactTitle: string;
	readonly onOpenChange: (open: boolean) => void;
};

type PluginScreenFrameProps = {
	readonly meta?: ReactNode;
	readonly backLabel?: string;
	readonly menuLabel?: string;
	readonly children: ReactNode;
	readonly actions?: ReactNode;
	readonly title: null | string;
	readonly titleIcon?: ReactNode;
	readonly searchRow?: ReactNode;
	readonly barActions?: ReactNode;
	readonly primaryAction?: ReactNode;
	readonly viewOptions?: ViewOptions;
	readonly floatingAction?: ReactNode;
	readonly hideTitle?: boolean | undefined;
	readonly menuActions?: ReadonlyArray<MenuItem>;
	readonly hero?: ComponentProps<typeof ScreenFrame>["hero"];
};

export function PluginScreenFrame({
	meta,
	hero,
	title,
	actions,
	children,
	backLabel,
	menuLabel,
	hideTitle,
	searchRow,
	titleIcon,
	barActions,
	menuActions,
	viewOptions,
	primaryAction,
	floatingAction,
}: PluginScreenFrameProps) {
	const chrome = usePluginChrome();
	const optionsTrigger = useRef<HTMLButtonElement>(null);
	const { floatingRoot, scrollRootRef } = usePluginScreenSurface();
	const leading = Match.value(chrome.leading).pipe(
		Match.when("back", () => (
			<ScreenBarButton onClick={chrome.back} label={backLabel ?? "Go back"}>
				<AppIcon size={22} name="chevron-left" />
			</ScreenBarButton>
		)),
		Match.when("drawer", () => (
			<ScreenBarButton onClick={chrome.openDrawer} label={menuLabel ?? "Open navigation"}>
				<AppIcon size={22} name="menu" />
			</ScreenBarButton>
		)),
		Match.when("none", () => null),
		Match.exhaustive,
	);
	usePluginTitle(title);
	const openOptions = () => viewOptions?.onOpenChange(true);
	const moreActions =
		menuActions === undefined || menuActions.length === 0
			? undefined
			: (trigger: "bar" | "toolbar") => (
					<MenuButton trigger={trigger} items={menuActions} label="More actions" />
				);
	const toolbar =
		actions === undefined &&
		viewOptions === undefined &&
		moreActions === undefined &&
		primaryAction === undefined ? undefined : (
			<div className="flex flex-wrap items-center justify-end gap-2">
				{actions}
				{viewOptions && (
					<ViewFiltersButton
						ref={optionsTrigger}
						onClick={openOptions}
						activeCount={viewOptions.activeCount}
					/>
				)}
				{moreActions?.("toolbar")}
				{primaryAction}
			</div>
		);

	return (
		<>
			<ScreenFrame
				meta={meta}
				hero={hero}
				leading={leading}
				actions={toolbar}
				title={title ?? ""}
				hideTitle={hideTitle}
				searchRow={searchRow}
				titleIcon={titleIcon}
				compact={chrome.compact}
				scrollRootRef={scrollRootRef}
				safeAreaTop={chrome.safeAreaTop}
				barActions={
					<>
						{barActions}
						{viewOptions && (
							<ScreenBarButton
								ref={optionsTrigger}
								onClick={openOptions}
								label={`${viewOptions.compactTitle}, ${activeFiltersPhrase(viewOptions.activeCount)}`}
							>
								<AppIcon size={22} name="sliders-horizontal" />
							</ScreenBarButton>
						)}
						{moreActions?.("bar")}
					</>
				}
			>
				<main>{children}</main>
			</ScreenFrame>
			{viewOptions?.open && (
				<ViewFiltersSheet
					compact={chrome.compact}
					triggerRef={optionsTrigger}
					onClose={() => viewOptions.onOpenChange(false)}
					title={chrome.compact ? viewOptions.compactTitle : "Filters"}
				>
					{viewOptions.content}
				</ViewFiltersSheet>
			)}
			{floatingAction !== undefined &&
				floatingRoot !== null &&
				createPortal(floatingAction, floatingRoot)}
		</>
	);
}

export const viewLayoutOptions = [
	{ value: "grid", label: "Grid view", content: <AppIcon size={15} name="grid" /> },
	{ value: "list", label: "List view", content: <AppIcon size={15} name="list" /> },
	{ value: "table", label: "Table view", content: <AppIcon size={15} name="table" /> },
] as const satisfies readonly {
	readonly label: string;
	readonly content: ReactNode;
	readonly value: EntityBrowserLayout;
}[];

export const normalizeViewSearch = (search: string) =>
	search
		.trim()
		.split(/[\s_-]+/)
		.filter(Boolean)
		.join(" ");

export const viewResultLabel = (input: {
	readonly loaded: number;
	readonly hasMore: boolean;
	readonly total: number | undefined;
	readonly noun?: undefined | { readonly one: string; readonly other: string };
}) => {
	const { one, other } = input.noun ?? { one: "result", other: "results" };
	if (input.hasMore && input.total !== undefined) {
		return `${input.loaded.toLocaleString()} of ${input.total.toLocaleString()} ${other}`;
	}
	return `${input.loaded.toLocaleString()}${input.hasMore ? "+" : ""} ${input.loaded === 1 && !input.hasMore ? one : other}`;
};

function ViewFiltersButton({
	ref,
	onClick,
	activeCount,
}: {
	readonly onClick: () => void;
	readonly activeCount: number;
	readonly ref: Ref<HTMLButtonElement>;
}) {
	usePageShortcut("F", onClick);

	return (
		<Button
			ref={ref}
			shortcut="F"
			onClick={onClick}
			variant="secondary"
			aria-label={filtersLabel(activeCount)}
		>
			<AppIcon size={15} name="sliders-horizontal" className="text-text-muted" />
			Filters
		</Button>
	);
}
