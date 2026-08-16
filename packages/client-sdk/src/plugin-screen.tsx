import { ScreenBarButton, ScreenFrame } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { Match } from "effect";
import type { ReactNode } from "react";

import { usePluginChrome, usePluginScreenSurface, usePluginTitle } from "./routing";

type PluginScreenFrameProps = {
	readonly title: string;
	readonly meta?: ReactNode;
	readonly hero?: ReactNode;
	readonly backLabel?: string;
	readonly menuLabel?: string;
	readonly children: ReactNode;
	readonly actions?: ReactNode;
	readonly titleIcon?: ReactNode;
	readonly searchRow?: ReactNode;
	readonly barActions?: ReactNode;
	readonly hideTitle?: boolean | undefined;
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
}: PluginScreenFrameProps) {
	const chrome = usePluginChrome();
	const { scrollRootRef } = usePluginScreenSurface();
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
				<AppIcon name="menu" size={22} />
			</ScreenBarButton>
		)),
		Match.when("none", () => null),
		Match.exhaustive,
	);
	usePluginTitle(title);

	return (
		<ScreenFrame
			meta={meta}
			hero={hero}
			title={title}
			leading={leading}
			actions={actions}
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
	);
}
