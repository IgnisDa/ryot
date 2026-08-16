import { ScreenFrame } from "@ryot-app/client-ui-sdk";
import { useNavigate, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { useRef, type ReactNode } from "react";

import { AppIcon } from "#/modules/navigation/app-icon";
import { useEdge, useShellChrome } from "#/modules/navigation/authenticated-shell";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

type AppScreenProps = {
	readonly title: string;
	readonly meta?: ReactNode;
	readonly hero?: ReactNode;
	readonly className?: string;
	readonly children: ReactNode;
	readonly actions?: ReactNode;
	readonly searchRow?: ReactNode;
	readonly titleIcon?: ReactNode;
	readonly barActions?: ReactNode;
	readonly headerClassName?: string;
	readonly columnClassName?: string;
	readonly contentClassName?: string;
	readonly backFallbackHref?: string;
};

const control =
	"flex size-11 shrink-0 items-center justify-center rounded-pill text-text hover:bg-surface-2";

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
			<button
				type="button"
				className={control}
				aria-label="Open navigation"
				onClick={chrome.onOpenDrawer}
				aria-controls={chrome.drawerId}
				aria-expanded={chrome.isDrawerOpen}
				ref={(node) => {
					chrome.triggerRef.current = node;
				}}
			>
				<AppIcon name="menu" size={22} />
			</button>
		);
	}
	if (edge.intent === "back" || backFallbackHref !== undefined) {
		return (
			<button type="button" onClick={goBack} aria-label="Go back" className={control}>
				<AppIcon name="chevron-left" size={22} />
			</button>
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
			className={clsx(
				"h-full overflow-y-auto bg-bg pb-[max(32px,env(safe-area-inset-bottom))] md:px-8 md:pt-8",
				props.className,
			)}
		>
			<ScreenFrame
				meta={props.meta}
				hero={props.hero}
				leading={leading}
				title={props.title}
				compact={edge.compact}
				actions={props.actions}
				searchRow={props.searchRow}
				titleIcon={props.titleIcon}
				scrollRootRef={scrollRootRef}
				barActions={props.barActions}
				safeAreaTop={chrome.safeAreaTop}
				headerClassName={props.headerClassName}
				columnClassName={props.columnClassName}
				contentClassName={props.contentClassName ?? "px-4 md:px-0"}
			>
				{props.children}
			</ScreenFrame>
		</main>
	);
}
