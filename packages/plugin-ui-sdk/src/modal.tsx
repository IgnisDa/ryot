import clsx from "clsx";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { motionTransition } from "./motion";
import {
	focusableElements,
	useFocusTrap,
	useInertBackground,
	useRestoreFocus,
	useScrollLock,
} from "./overlay";
import { OverlayScope } from "./shortcut";

type ModalProps = {
	readonly label?: string;
	readonly closeLabel: string;
	readonly className?: string;
	readonly children: ReactNode;
	readonly labelledBy?: string;
	readonly onClose: () => void;
	readonly dismissible?: boolean;
	readonly backEnabled?: boolean;
	readonly scrimClassName?: string;
	readonly containerClassName?: string;
	readonly onInterceptBack?: (() => boolean) | undefined;
	readonly triggerRef?: RefObject<HTMLElement | null> | undefined;
	readonly initialFocusRef?: RefObject<HTMLElement | null> | undefined;
	readonly placement?: "center" | "sheet" | "side";
};

export function Modal({
	label,
	onClose,
	children,
	className,
	closeLabel,
	labelledBy,
	triggerRef,
	scrimClassName,
	initialFocusRef,
	onInterceptBack,
	backEnabled = true,
	containerClassName,
	dismissible = true,
	placement = "center",
}: ModalProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const fallbackTriggerRef = useRef<HTMLElement | null>(null);
	const present = useIsPresent();
	const reduced = useReducedMotion();
	const hidden = {
		opacity: 0,
		x: reduced || placement !== "side" ? 0 : 24,
		y: reduced ? 0 : { side: 0, center: 6, sheet: 40 }[placement],
	};

	useRestoreFocus(triggerRef ?? fallbackTriggerRef, panelRef);
	useInertBackground(panelRef);
	useScrollLock(true);
	useLayoutEffect(() => {
		if (document.activeElement instanceof HTMLElement) {
			fallbackTriggerRef.current = document.activeElement;
		}
	}, []);

	useEffect(() => {
		const initial =
			initialFocusRef?.current ?? focusableElements(panelRef.current)[0] ?? panelRef.current;
		initial?.focus();
	}, [initialFocusRef]);

	const requestClose = () => {
		if (!dismissible || onInterceptBack?.() === true) {
			return false;
		}
		onClose();
		return true;
	};

	useFocusTrap(panelRef, { enabled: present });

	return createPortal(
		<OverlayScope
			enabled={present}
			onBack={requestClose}
			onEscape={requestClose}
			backEnabled={present && dismissible && backEnabled}
		>
			<div
				inert={!present}
				aria-hidden={!present}
				className={clsx("fixed inset-0 z-50 flex", containerClassName)}
			>
				<motion.button
					type="button"
					exit={{ opacity: 0 }}
					aria-label={closeLabel}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					onClick={() => requestClose()}
					transition={reduced ? { duration: 0 } : motionTransition}
					className={clsx(
						"absolute inset-0 motion-reduce:transform-none",
						scrimClassName ?? "bg-overlay",
					)}
				/>
				<motion.div
					role="dialog"
					tabIndex={-1}
					exit={hidden}
					ref={panelRef}
					initial={hidden}
					aria-modal="true"
					aria-label={label}
					aria-labelledby={labelledBy}
					animate={{ x: 0, y: 0, opacity: 1 }}
					transition={reduced ? { duration: 0 } : motionTransition}
					className={clsx("relative motion-reduce:transform-none", className)}
				>
					{children}
				</motion.div>
			</div>
		</OverlayScope>,
		document.body,
	);
}
