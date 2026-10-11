import type { EntityBrowserLayout } from "@ryot-app/contract/modules/saved-views/schemas";
import { Badge, ScreenBarButton, ScreenFrame } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Match } from "effect";
import type { ComponentProps, ReactNode, Ref } from "react";
import { createPortal } from "react-dom";

import { usePluginChrome, usePluginScreenSurface, usePluginTitle } from "./navigation/routing";

type PluginScreenFrameProps = {
	readonly meta?: ReactNode;
	readonly backLabel?: string;
	readonly menuLabel?: string;
	readonly children: ReactNode;
	readonly actions?: ReactNode;
	readonly title: string | null;
	readonly titleIcon?: ReactNode;
	readonly searchRow?: ReactNode;
	readonly barActions?: ReactNode;
	readonly floatingAction?: ReactNode;
	readonly hideTitle?: boolean | undefined;
	readonly hero?: ComponentProps<typeof ScreenFrame>["hero"];
};

const control = "text-text hover:bg-surface-2";

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
	floatingAction,
}: PluginScreenFrameProps) {
	const chrome = usePluginChrome();
	const { floatingRoot, scrollRootRef } = usePluginScreenSurface();
	const leading = Match.value(chrome.leading).pipe(
		Match.when("back", () => (
			<ScreenBarButton className={control} onClick={chrome.back} label={backLabel ?? "Go back"}>
				<AppIcon size={22} name="chevron-left" />
			</ScreenBarButton>
		)),
		Match.when("drawer", () => (
			<ScreenBarButton
				className={control}
				onClick={chrome.openDrawer}
				label={menuLabel ?? "Open navigation"}
			>
				<AppIcon size={22} name="menu" />
			</ScreenBarButton>
		)),
		Match.when("none", () => null),
		Match.exhaustive,
	);
	usePluginTitle(title);

	return (
		<>
			<ScreenFrame
				meta={meta}
				hero={hero}
				leading={leading}
				actions={actions}
				title={title ?? ""}
				hideTitle={hideTitle}
				searchRow={searchRow}
				titleIcon={titleIcon}
				barActions={barActions}
				compact={chrome.compact}
				scrollRootRef={scrollRootRef}
				safeAreaTop={chrome.safeAreaTop}
			>
				<main>{children}</main>
			</ScreenFrame>
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
	readonly noun?: { readonly one: string; readonly other: string } | undefined;
}) => {
	const { one, other } = input.noun ?? { one: "result", other: "results" };
	if (input.hasMore && input.total !== undefined) {
		return `${input.loaded.toLocaleString()} of ${input.total.toLocaleString()} ${other}`;
	}
	return `${input.loaded.toLocaleString()}${input.hasMore ? "+" : ""} ${input.loaded === 1 && !input.hasMore ? one : other}`;
};

export function ViewFiltersButton({
	ref,
	onClick,
}: {
	readonly onClick: () => void;
	readonly ref?: Ref<HTMLButtonElement> | undefined;
}) {
	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			aria-label="Filters, 0 active filters"
			className="flex h-8.5 items-center gap-2 rounded-md border border-border-strong bg-bg px-3"
		>
			<AppIcon size={15} name="sliders-horizontal" className="text-text-muted" />
			<span className="text-[13px] text-text">Filters</span>
			<Badge aria-hidden="true">0</Badge>
		</button>
	);
}
