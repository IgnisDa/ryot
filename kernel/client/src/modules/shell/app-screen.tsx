import { ActiveScreenContext } from "@ryot-app/plugin-client-sdk/react";
import { ScreenBarButton, ScreenFrame, useFollowEnd } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useNavigate, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type ComponentProps, type ReactNode, useRef } from "react";

import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { useEdge, useShellChrome } from "#/modules/shell/authenticated-shell-context";

type AppScreenProps = {
	readonly title: string;
	readonly meta?: ReactNode;
	readonly dock?: ReactNode;
	readonly followEnd?: string;
	readonly children: ReactNode;
	readonly actions?: ReactNode;
	readonly searchRow?: ReactNode;
	readonly titleIcon?: ReactNode;
	readonly barActions?: ReactNode;
	readonly backFallbackHref?: string;
	readonly hero?: ComponentProps<typeof ScreenFrame>["hero"];
	readonly width?: ComponentProps<typeof ScreenFrame>["width"];
};

export function useScreenLeadingControl(backFallbackHref?: string) {
	const edge = useEdge();
	const router = useRouter();
	const navigate = useNavigate();
	const { onBack, drawerId, triggerRef, isDrawerOpen, onOpenDrawer } = useShellChrome();

	const goBack = () => {
		if (router.history.canGoBack()) {
			onBack();
			return;
		}
		if (backFallbackHref !== undefined) {
			void navigate({ replace: true, to: backFallbackHref });
		}
	};

	if (edge.intent === "drawer") {
		return (
			<ScreenBarButton
				onClick={onOpenDrawer}
				label="Open navigation"
				aria-controls={drawerId}
				aria-expanded={isDrawerOpen}
				ref={(node) => {
					triggerRef.current = node;
				}}
			>
				<AppIcon size={22} name="menu" />
			</ScreenBarButton>
		);
	}
	if (edge.intent === "back" || backFallbackHref !== undefined) {
		return (
			<ScreenBarButton label="Go back" onClick={goBack}>
				<AppIcon size={22} name="chevron-left" />
			</ScreenBarButton>
		);
	}
	return undefined;
}

export function AppScreen(props: AppScreenProps) {
	const edge = useEdge();
	const chrome = useShellChrome();
	const scrollRootRef = useRef<HTMLElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	useFollowEnd(scrollRootRef, contentRef, props.followEnd);
	const leading = useScreenLeadingControl(props.backFallbackHref);
	usePageTitle(props.title);

	const screen = (
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
	);
	const frame = props.followEnd === undefined ? screen : <div ref={contentRef}>{screen}</div>;

	return (
		<ActiveScreenContext.Provider value={true}>
			{props.dock === undefined ? (
				<main
					{...mainContentProps}
					ref={scrollRootRef}
					className="h-full overflow-y-auto bg-bg pb-[max(32px,env(safe-area-inset-bottom))]"
				>
					{frame}
				</main>
			) : (
				<div className="flex h-full min-h-0 flex-col bg-bg">
					<main
						{...mainContentProps}
						ref={scrollRootRef}
						className="min-h-0 flex-1 overflow-y-auto pb-4"
					>
						{frame}
					</main>
					<div
						data-scroll-obstruction="bottom"
						className={clsx(
							"shrink-0 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]",
							edge.compact ? "px-4" : "px-8",
						)}
					>
						{props.dock}
					</div>
				</div>
			)}
		</ActiveScreenContext.Provider>
	);
}
