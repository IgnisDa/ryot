import { ScreenFrame } from "@ryot-app/client-ui-sdk";
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
	readonly contentClassName?: string;
};

const control =
	"flex size-11 shrink-0 items-center justify-center rounded-pill text-text hover:bg-surface-2";

export function PluginScreenFrame({
	meta,
	hero,
	title,
	actions,
	children,
	backLabel,
	menuLabel,
	searchRow,
	titleIcon,
	barActions,
	contentClassName,
}: PluginScreenFrameProps) {
	const chrome = usePluginChrome();
	const { scrollRootRef } = usePluginScreenSurface();
	usePluginTitle(title);

	return (
		<ScreenFrame
			meta={meta}
			hero={hero}
			title={title}
			actions={actions}
			searchRow={searchRow}
			titleIcon={titleIcon}
			barActions={barActions}
			compact={chrome.compact}
			scrollRootRef={scrollRootRef}
			safeAreaTop={chrome.safeAreaTop}
			contentClassName={contentClassName}
			leading={
				chrome.edgeBack ? (
					<button
						type="button"
						className={control}
						onClick={chrome.back}
						aria-label={backLabel ?? "Go back"}
					>
						<BackIcon />
					</button>
				) : (
					<button
						type="button"
						className={control}
						onClick={chrome.openDrawer}
						aria-label={menuLabel ?? "Open navigation"}
					>
						<MenuIcon />
					</button>
				)
			}
		>
			<main>{children}</main>
		</ScreenFrame>
	);
}

const iconProps = {
	width: 22,
	height: 22,
	fill: "none",
	strokeWidth: 2,
	"aria-hidden": true,
	viewBox: "0 0 24 24",
	stroke: "currentColor",
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const;

const BackIcon = () => (
	<svg {...iconProps}>
		<path d="m15 18-6-6 6-6" />
	</svg>
);

const MenuIcon = () => (
	<svg {...iconProps}>
		<path d="M4 6h16M4 12h16M4 18h16" />
	</svg>
);
