import { useNavigate, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AppIcon } from "#/modules/navigation/app-icon";
import { useIsDesktop } from "#/modules/navigation/breakpoint";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

type SettingsFrameProps = {
	readonly title: string;
	readonly meta?: ReactNode;
	readonly actions?: ReactNode;
	readonly children?: ReactNode;
	readonly backFallbackHref: string;
};

export function SettingsFrame(props: SettingsFrameProps) {
	const router = useRouter();
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();
	usePageTitle(props.title);
	const goBack = () => {
		if (router.history.canGoBack()) {
			router.history.back();
			return;
		}
		void navigate({ to: props.backFallbackHref, replace: true });
	};

	return (
		<main {...mainContentProps} className="flex h-full min-h-0 flex-col">
			{!isDesktop && (
				<header className="flex shrink-0 items-center gap-2 border-b border-border pt-[env(safe-area-inset-top)]">
					<button
						type="button"
						onClick={goBack}
						aria-label="Go back"
						className="flex size-11 shrink-0 items-center justify-center text-text"
					>
						<AppIcon name="chevron-left" size={20} />
					</button>
					<div className="min-w-0 flex-1 px-2 py-4">
						<h1 className="truncate font-display text-lg font-semibold text-text">{props.title}</h1>
						{props.meta}
					</div>
					{props.actions}
				</header>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-8 md:px-8 md:pt-8">
				<div className="mx-auto w-full max-w-2xl">
					{isDesktop && (
						<div className="mb-8 flex items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<h1 className="truncate font-display text-3xl font-semibold text-text">
									{props.title}
								</h1>
								{props.meta}
							</div>
							{props.actions}
						</div>
					)}
					{props.children}
				</div>
			</div>
		</main>
	);
}
