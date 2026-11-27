import type { EntityBrowserLayout } from "@ryot-app/contract/modules/saved-views/schemas";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { DisplayText, Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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

import { activeFiltersMessage, ViewFiltersSheet } from "./filters";
import { useDisplayText } from "./i18n/messages";
import {
	usePageShortcut,
	usePluginChrome,
	usePluginScreenSurface,
	usePluginTitle,
} from "./navigation/routing";

type ViewOptions = {
	readonly open: boolean;
	readonly content: ReactNode;
	readonly compactTitle: Text;
	readonly activeCount: number;
	readonly onOpenChange: (open: boolean) => void;
};

type PluginScreenFrameProps = {
	readonly meta?: ReactNode;
	readonly backLabel?: Text;
	readonly menuLabel?: Text;
	readonly children: ReactNode;
	readonly actions?: ReactNode;
	readonly titleIcon?: ReactNode;
	readonly searchRow?: ReactNode;
	readonly barActions?: ReactNode;
	/** A message from the document's own catalogs or user-authored text; the host shows it too. */
	readonly title: null | DisplayText;
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
	const t = useT();
	const displayText = useDisplayText();
	const chrome = usePluginChrome();
	const optionsTrigger = useRef<HTMLButtonElement>(null);
	const { floatingRoot, scrollRootRef } = usePluginScreenSurface();
	const leading = Match.value(chrome.leading).pipe(
		Match.when("back", () => (
			<ScreenBarButton
				onClick={chrome.back}
				label={backLabel ?? t(kernelMessage("sdk.screen.go-back"))}
			>
				<AppIcon size={22} name="chevron-left" />
			</ScreenBarButton>
		)),
		Match.when("drawer", () => (
			<ScreenBarButton
				onClick={chrome.openDrawer}
				label={menuLabel ?? t(kernelMessage("sdk.screen.open-navigation"))}
			>
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
					<MenuButton
						trigger={trigger}
						items={menuActions}
						label={t(kernelMessage("sdk.screen.more-actions"))}
					/>
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
				hideTitle={hideTitle}
				searchRow={searchRow}
				titleIcon={titleIcon}
				compact={chrome.compact}
				scrollRootRef={scrollRootRef}
				safeAreaTop={chrome.safeAreaTop}
				title={title === null ? null : displayText(title)}
				barActions={
					<>
						{barActions}
						{viewOptions && (
							<ScreenBarButton
								ref={optionsTrigger}
								onClick={openOptions}
								label={t(
									kernelMessage("sdk.screen.options-button", {
										title: viewOptions.compactTitle,
										active: t(activeFiltersMessage(viewOptions.activeCount)),
									}),
								)}
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
					title={chrome.compact ? viewOptions.compactTitle : t(kernelMessage("sdk.filters.title"))}
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
	{
		value: "grid",
		content: <AppIcon size={15} name="grid" />,
		label: kernelMessage("sdk.screen.layout", { layout: "grid" }),
	},
	{
		value: "list",
		content: <AppIcon size={15} name="list" />,
		label: kernelMessage("sdk.screen.layout", { layout: "list" }),
	},
	{
		value: "table",
		content: <AppIcon size={15} name="table" />,
		label: kernelMessage("sdk.screen.layout", { layout: "table" }),
	},
] as const satisfies readonly {
	readonly label: Message;
	readonly content: ReactNode;
	readonly value: EntityBrowserLayout;
}[];

export const normalizeViewSearch = (search: string) =>
	search
		.trim()
		.split(/[\s_-]+/)
		.filter(Boolean)
		.join(" ");

/** `noun` names the results for a count, such as a plural-aware catalog message. */
export const viewResultLabel = (
	t: (message: Message) => Text,
	formatters: Formatters,
	input: {
		readonly loaded: number;
		readonly hasMore: boolean;
		readonly total: number | undefined;
		readonly noun?: undefined | ((count: number) => string);
	},
) => {
	const noun =
		input.noun ?? ((count: number) => t(kernelMessage("sdk.browser.result-noun", { count })));
	const number = formatters.number();
	const loaded = number.format(input.loaded);
	if (input.hasMore && input.total !== undefined) {
		return t(
			kernelMessage("sdk.browser.result-count", {
				loaded,
				state: "partial",
				noun: noun(input.total),
				total: number.format(input.total),
			}),
		);
	}
	return t(
		kernelMessage("sdk.browser.result-count", {
			loaded,
			total: loaded,
			state: input.hasMore ? "more" : "complete",
			noun: noun(input.loaded + (input.hasMore ? 1 : 0)),
		}),
	);
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
	const t = useT();
	usePageShortcut("F", onClick);

	return (
		<Button
			ref={ref}
			shortcut="F"
			onClick={onClick}
			variant="secondary"
			aria-label={t(
				kernelMessage("sdk.screen.options-button", {
					title: t(kernelMessage("sdk.filters.title")),
					active: t(activeFiltersMessage(activeCount)),
				}),
			)}
		>
			<AppIcon size={15} name="sliders-horizontal" className="text-text-muted" />
			{t(kernelMessage("sdk.filters.title"))}
		</Button>
	);
}
