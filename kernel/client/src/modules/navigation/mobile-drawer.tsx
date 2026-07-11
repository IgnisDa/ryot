import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot/ryotql-recipes/plugin-client-catalog";
import clsx from "clsx";
import { type KeyboardEvent, type RefObject, useEffect, useRef } from "react";

import type { AuthSessionStore } from "#/modules/auth/client";
import { AccountSummary } from "#/modules/navigation/account-summary";
import { AppIcon } from "#/modules/navigation/app-icon";
import { activateLink } from "#/modules/navigation/link-activation";
import { WorkspaceSwitcher } from "#/modules/navigation/workspace-switcher";

type MobileDrawerProps = {
	readonly isPro: boolean;
	readonly isOpen: boolean;
	readonly drawerId: string;
	readonly onClose: () => void;
	readonly activeHome: boolean;
	readonly activeSettings: boolean;
	readonly session: AuthSessionStore;
	readonly catalog: PluginClientCatalog;
	readonly current: PluginClientCatalogEntry | null;
	readonly onNavigateHome: () => void | Promise<void>;
	readonly onNavigateSettings: () => void | Promise<void>;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
	readonly onSelectWorkspace: (slug: string) => void | Promise<void>;
};

const focusable =
	'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const showModal = (dialog: HTMLDialogElement) => {
	const operation: unknown = Reflect.get(dialog, "showModal");
	if (typeof operation === "function") {
		Reflect.apply(operation, dialog, []);
	} else {
		dialog.setAttribute("open", "");
	}
};

const dismiss = (dialog: HTMLDialogElement) => {
	const operation: unknown = Reflect.get(dialog, "close");
	if (typeof operation === "function") {
		Reflect.apply(operation, dialog, []);
	} else {
		dialog.removeAttribute("open");
	}
};

const restoreFocus = (trigger: RefObject<HTMLButtonElement | null>) =>
	queueMicrotask(() => trigger.current?.focus());

export function MobileDrawer(props: MobileDrawerProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const previousOverflow = useRef<string | null>(null);
	const close = () => {
		if (dialogRef.current?.open) {
			dismiss(dialogRef.current);
		}
		if (previousOverflow.current !== null) {
			document.body.style.overflow = previousOverflow.current;
			previousOverflow.current = null;
		}
		props.onClose();
		restoreFocus(props.triggerRef);
	};
	const closeThen = (operation: () => void | Promise<void>) => {
		close();
		queueMicrotask(() => void operation());
	};
	const containFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
		if (event.defaultPrevented) {
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			close();
			return;
		}
		if (event.key !== "Tab") {
			return;
		}
		const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusable) ?? []);
		if (items.length === 0) {
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	useEffect(() => {
		const dialog = dialogRef.current;
		if (dialog === null) {
			return undefined;
		}
		if (props.isOpen && !dialog.open) {
			showModal(dialog);
		} else if (!props.isOpen && dialog.open) {
			dismiss(dialog);
			restoreFocus(props.triggerRef);
		}
		return undefined;
	}, [props.isOpen, props.triggerRef]);

	useEffect(() => {
		if (!props.isOpen) {
			return undefined;
		}
		previousOverflow.current = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			if (previousOverflow.current !== null) {
				document.body.style.overflow = previousOverflow.current;
				previousOverflow.current = null;
			}
		};
	}, [props.isOpen]);

	return (
		<dialog
			ref={dialogRef}
			aria-modal="true"
			id={props.drawerId}
			onKeyDown={containFocus}
			data-testid="mobile-drawer"
			aria-labelledby={`${props.drawerId}-title`}
			className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(320px,82vw)] max-w-none overflow-visible border-0 bg-transparent p-0 text-text backdrop:bg-overlay md:hidden"
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
			onClick={(event) => {
				if (event.target === event.currentTarget) {
					close();
				}
			}}
		>
			<div className="flex h-full flex-col border-r border-border bg-surface pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-card">
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
			</div>
		</dialog>
	);
}
