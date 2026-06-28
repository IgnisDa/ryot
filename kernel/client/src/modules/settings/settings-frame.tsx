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
			width="readable"
			meta={props.meta}
			title={props.title}
			actions={props.actions}
			barActions={props.actions}
			backFallbackHref={props.backFallbackHref}
		>
			{props.children}
		</AppScreen>
	);
}
