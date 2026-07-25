import { ScreenBarButton, ScreenFrame } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useRef, type ComponentProps, type ReactNode } from "react";

import { useEdge, useShellChrome } from "#/modules/navigation/authenticated-shell";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

type AppScreenProps = {
	readonly title: string;
	readonly meta?: ReactNode;
	readonly hero?: ReactNode;
	readonly children: ReactNode;
	readonly actions?: ReactNode;
	readonly searchRow?: ReactNode;
	readonly titleIcon?: ReactNode;
	readonly barActions?: ReactNode;
	readonly backFallbackHref?: string;
	readonly width?: ComponentProps<typeof ScreenFrame>["width"];
};

export function useScreenLeadingControl(backFallbackHref?: string) {
	const edge = useEdge();
	const router = useRouter();
	const navigate = useNavigate();
	const chrome = useShellChrome();

	const goBack = () => {
		if (router.history.canGoBack()) {
			chrome.onBack();
			return;
		}
		if (backFallbackHref !== undefined) {
			void navigate({ replace: true, to: backFallbackHref });
		}
	};

	if (edge.intent === "drawer") {
		return (
			<ScreenBarButton
				label="Open navigation"
				onClick={chrome.onOpenDrawer}
				aria-controls={chrome.drawerId}
				aria-expanded={chrome.isDrawerOpen}
				className="text-text hover:bg-surface-2"
				ref={(node) => {
					chrome.triggerRef.current = node;
				}}
			>
				<AppIcon name="menu" size={22} />
			</ScreenBarButton>
		);
	}
	if (edge.intent === "back" || backFallbackHref !== undefined) {
		return (
			<ScreenBarButton label="Go back" onClick={goBack} className="text-text hover:bg-surface-2">
				<AppIcon name="chevron-left" size={22} />
			</ScreenBarButton>
		);
	}
	return undefined;
}

export function AppScreen(props: AppScreenProps) {
	const edge = useEdge();
	const chrome = useShellChrome();
	const scrollRootRef = useRef<HTMLElement>(null);
	const leading = useScreenLeadingControl(props.backFallbackHref);
	usePageTitle(props.title);

	return (
		<main
			{...mainContentProps}
			ref={scrollRootRef}
			className="h-full overflow-y-auto bg-bg pb-[max(32px,env(safe-area-inset-bottom))]"
		>
			<ScreenFrame
				meta={props.meta}
				hero={props.hero}
				leading={leading}
				width={props.width}
				title={props.title}
				compact={edge.compact}
				actions={props.actions}
				searchRow={props.searchRow}
				titleIcon={props.titleIcon}
				scrollRootRef={scrollRootRef}
				barActions={props.barActions}
				safeAreaTop={chrome.safeAreaTop}
			>
				{props.children}
			</ScreenFrame>
		</main>
	);
}
