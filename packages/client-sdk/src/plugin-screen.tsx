import { ScreenFrame } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
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
						<AppIcon name="chevron-left" size={22} />
					</button>
				) : (
					<button
						type="button"
						className={control}
						onClick={chrome.openDrawer}
						aria-label={menuLabel ?? "Open navigation"}
					>
						<AppIcon name="menu" size={22} />
					</button>
				)
			}
		>
			<main>{children}</main>
		</ScreenFrame>
	);
}
