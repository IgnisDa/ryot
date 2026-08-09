import type { ReactNode } from "react";

import { AppScreen } from "#/modules/navigation/app-screen";

type SettingsFrameProps = {
	readonly title: string;
	readonly meta?: ReactNode;
	readonly actions?: ReactNode;
	readonly children?: ReactNode;
	readonly backFallbackHref: string;
};

export function SettingsFrame(props: SettingsFrameProps) {
	return (
		<AppScreen
			meta={props.meta}
			title={props.title}
			actions={props.actions}
			barActions={props.actions}
			backFallbackHref={props.backFallbackHref}
			columnClassName="mx-auto w-full max-w-2xl"
			contentClassName="px-4 pt-4 md:px-0 md:pt-8"
		>
			{props.children}
		</AppScreen>
	);
}
