import clsx from "clsx";
import { useEffect, useEffectEvent, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

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
	readonly onInterceptBack?: () => boolean;
	readonly triggerRef?: RefObject<HTMLElement | null>;
	readonly initialFocusRef?: RefObject<HTMLElement | null>;
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
}: ModalProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const fallbackTriggerRef = useRef<HTMLElement | null>(null);

	useRestoreFocus(triggerRef ?? fallbackTriggerRef);
	useInertBackground(panelRef);
	useScrollLock(true);

	useEffect(() => {
		const initial =
			initialFocusRef?.current ?? focusableElements(panelRef.current)[0] ?? panelRef.current;
		initial?.focus();
	}, [initialFocusRef]);

	const requestClose = useEffectEvent(() => {
		if (!dismissible || onInterceptBack?.() === true) {
			return false;
		}
		onClose();
		return true;
	});

	useFocusTrap(panelRef, { enabled: true });

	return createPortal(
		<OverlayScope
			onBack={requestClose}
			onEscape={requestClose}
			backEnabled={dismissible && backEnabled}
		>
			<div className={clsx("fixed inset-0 z-50 flex", containerClassName)}>
				<button
					type="button"
					aria-label={closeLabel}
					onClick={() => requestClose()}
					className={clsx("absolute inset-0", scrimClassName ?? "bg-overlay")}
				/>
				<div
					role="dialog"
					tabIndex={-1}
					ref={panelRef}
					aria-modal="true"
					aria-label={label}
					aria-labelledby={labelledBy}
					className={clsx("relative", className)}
				>
					{children}
				</div>
			</div>
		</OverlayScope>,
		document.body,
	);
}
