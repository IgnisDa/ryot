import { ScreenFrame } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type ReactNode, useRef } from "react";

import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { useHasPublishedClientPageDocument } from "#/modules/pages/documents/state";
import { useScreenLeadingControl } from "#/modules/shell/app-screen";
import { useEdge, useShellChrome } from "#/modules/shell/authenticated-shell-context";

export function ClientPageLoading(props: {
	readonly title: string;
	readonly icon?: string;
	readonly compact: boolean;
	readonly leading: ReactNode;
	readonly safeAreaTop: number;
}) {
	const scrollRootRef = useRef<HTMLDivElement>(null);
	return (
		<div
			ref={scrollRootRef}
			className="flex h-full flex-col overflow-y-auto bg-bg pb-[max(32px,env(safe-area-inset-bottom))]"
		>
			<ScreenFrame
				hideTitle
				title={props.title}
				compact={props.compact}
				leading={props.leading}
				scrollRootRef={scrollRootRef}
				safeAreaTop={props.safeAreaTop}
			>
				{null}
			</ScreenFrame>
			<div className="grid min-h-64 flex-1 place-items-center px-6">
				<section
					role="status"
					aria-atomic="true"
					className="flex max-w-full flex-col items-center text-center"
				>
					<div
						aria-hidden="true"
						className="relative mb-5 flex size-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent"
					>
						<AppIcon size={26} name={props.icon ?? "puzzle"} />
						<span className="absolute -right-1 bottom-2 size-2 animate-pulse rounded-full border-2 border-bg bg-accent motion-reduce:animate-none" />
					</div>
					<h1 className="max-w-full text-base font-medium wrap-break-word text-text">
						{props.title}
					</h1>
					<p className="mt-2 text-sm text-text-muted">Getting your view ready</p>
					<div aria-hidden="true" className="mt-6 flex gap-1.5 text-accent/60">
						{[0, 1, 2].map((index) => (
							<span
								key={index}
								style={{ animationDelay: `${index * 160}ms` }}
								className="size-1 animate-pulse rounded-full bg-current motion-reduce:animate-none"
							/>
						))}
					</div>
				</section>
			</div>
		</div>
	);
}

export function ClientPagePending() {
	return useHasPublishedClientPageDocument() ? null : <ClientPageLoadingScreen />;
}

function ClientPageLoadingScreen() {
	const { compact } = useEdge();
	const { safeAreaTop } = useShellChrome();
	const leading = useScreenLeadingControl();
	const title = "Opening your page";
	usePageTitle(title);
	return (
		<main {...mainContentProps} className="h-full">
			<ClientPageLoading
				title={title}
				compact={compact}
				leading={leading}
				safeAreaTop={safeAreaTop}
			/>
		</main>
	);
}
