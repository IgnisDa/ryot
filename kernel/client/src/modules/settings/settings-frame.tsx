import type { Text } from "@ryot-app/i18n/text";
import type { ReactNode } from "react";

import { AppScreen } from "#/modules/shell/app-screen";

type SettingsFrameProps = {
	readonly title: Text;
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
