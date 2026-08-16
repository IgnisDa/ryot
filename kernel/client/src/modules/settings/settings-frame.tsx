import { useNavigate, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AppIcon } from "#/modules/navigation/app-icon";

type SettingsFrameProps = {
	readonly title: string;
	readonly children?: ReactNode;
	readonly backFallbackHref: string;
};

export function SettingsFrame(props: SettingsFrameProps) {
	const router = useRouter();
	const navigate = useNavigate();
	const goBack = () => {
		if (router.history.canGoBack()) {
			router.history.back();
			return;
		}
		void navigate({ to: props.backFallbackHref, replace: true });
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex shrink-0 items-center gap-2 border-b border-border pt-[env(safe-area-inset-top)]">
				<button
					type="button"
					onClick={goBack}
					aria-label="Go back"
					className="flex size-11 shrink-0 items-center justify-center text-text md:hidden"
				>
					<AppIcon name="chevron-left" size={20} />
				</button>
				<h1 className="px-2 py-4 font-display text-lg font-semibold text-text md:px-4 md:py-6 md:text-2xl">
					{props.title}
				</h1>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">{props.children}</div>
		</div>
	);
}
