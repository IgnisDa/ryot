import { useFocusTrap, useScrollLock } from "@ryot-app/client-ui-sdk";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import clsx from "clsx";
import {
	type MotionValue,
	animate,
	motion,
	useMotionValueEvent,
	useReducedMotion,
	useTransform,
} from "motion/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { AuthSessionStore } from "#/modules/auth/service";
import { AccountSummary } from "#/modules/navigation/account-summary";
import { AppIcon } from "#/modules/navigation/app-icon";
import { gestureSpring } from "#/modules/navigation/drawer-metrics";
import { activateLink } from "#/modules/navigation/link-activation";
import { WorkspaceSwitcher } from "#/modules/navigation/workspace-switcher";

type MobileDrawerProps = {
	readonly isPro: boolean;
	readonly isOpen: boolean;
	readonly drawerId: string;
	readonly hasDrawer: boolean;
	readonly onClose: () => void;
	readonly activeHome: boolean;
	readonly activeSettings: boolean;
	readonly session: AuthSessionStore;
	readonly catalog: PluginClientCatalog;
	readonly progress: MotionValue<number>;
	readonly current: PluginClientCatalogEntry | null;
	readonly onNavigateHome: () => void | Promise<void>;
	readonly onNavigateSettings: () => void | Promise<void>;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
	readonly onSelectWorkspace: (slug: string) => void | Promise<void>;
};

const restoreFocus = (trigger: RefObject<HTMLButtonElement | null>) =>
	queueMicrotask(() => trigger.current?.focus());

export function MobileDrawer(props: MobileDrawerProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [isSettling, setIsSettling] = useState(false);
	const reduceMotion = useReducedMotion() === true;
	const x = useTransform(props.progress, [0, 1], ["-100%", "0%"]);
	const presented = props.isOpen || isSettling;
	const { unlock } = useScrollLock(props.isOpen);
	const close = () => {
		unlock();
		props.onClose();
		restoreFocus(props.triggerRef);
	};
	const closeThen = (operation: () => void | Promise<void>) => {
		flushSync(close);
		queueMicrotask(() => void operation());
	};

	useMotionValueEvent(props.progress, "change", (value) => setIsSettling(value > 0));

	useEffect(() => {
		if (reduceMotion) {
			props.progress.set(props.isOpen ? 1 : 0);
			return undefined;
		}
		const controls = animate(props.progress, props.isOpen ? 1 : 0, gestureSpring());
		return () => controls.stop();
	}, [props.isOpen, props.progress, reduceMotion]);

	useFocusTrap(rootRef, { enabled: props.isOpen, onEscape: close });

	if (!props.hasDrawer && !presented) {
		return null;
	}

	return (
		<div
			ref={rootRef}
			id={props.drawerId}
			hidden={!presented}
			data-testid="mobile-drawer"
			role={props.isOpen ? "dialog" : undefined}
			aria-labelledby={`${props.drawerId}-title`}
			aria-modal={props.isOpen ? true : undefined}
			aria-hidden={props.isOpen ? undefined : true}
			className={clsx("ui-chrome fixed inset-0 z-40 md:hidden", presented ? "block" : "hidden")}
		>
			<motion.div
				onClick={close}
				aria-hidden="true"
				data-testid="drawer-scrim"
				style={{ opacity: props.progress }}
				className="absolute inset-0 bg-overlay"
			/>
			<motion.div
				style={{ x }}
				className="absolute inset-y-0 left-0 flex w-[min(320px,82vw)] flex-col border-r border-border bg-surface pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),0.75rem)] text-text shadow-card"
			>
				<div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
					<h2
						id={`${props.drawerId}-title`}
						className="font-display text-lg font-semibold text-text"
					>
						Navigation
					</h2>
					<button
						type="button"
						onClick={close}
						aria-label="Close navigation"
						className="flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text"
					>
						<AppIcon name="x" size={18} />
					</button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-3">
					<WorkspaceSwitcher
						current={props.current}
						catalog={props.catalog}
						key={props.isOpen ? "open" : "closed"}
						onSelect={(slug) => closeThen(() => props.onSelectWorkspace(slug))}
					/>
					{props.current !== null && (
						<nav aria-label="Workspace" className="mt-3">
							<a
								onClick={activateLink(() => closeThen(props.onNavigateHome))}
								href={`/${props.current.slug}`}
								aria-current={props.activeHome ? "page" : undefined}
								className={clsx(
									"flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-text",
									props.activeHome ? "bg-nav-indicator" : "hover:bg-surface-2",
								)}
							>
								<AppIcon name="house" size={16} className="text-text-muted" />
								<span>Home</span>
							</a>
						</nav>
					)}
				</div>

				<footer className="shrink-0 border-t border-border px-3 pt-3">
					<AccountSummary
						isPro={props.isPro}
						session={props.session}
						active={props.activeSettings}
						onNavigate={() => closeThen(props.onNavigateSettings)}
					/>
				</footer>
			</motion.div>
		</div>
	);
}
