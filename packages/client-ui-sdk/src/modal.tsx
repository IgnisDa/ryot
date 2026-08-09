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
	readonly children: ReactNode;
	readonly closeLabel: string;
	readonly className?: string;
	readonly labelledBy?: string;
	readonly onClose: () => void;
	readonly dismissible?: boolean;
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
	containerClassName,
	dismissible = true,
}: ModalProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const fallbackTriggerRef = useRef<HTMLElement | null>(null);

	useRestoreFocus(triggerRef ?? fallbackTriggerRef);
	useInertBackground(panelRef);
	useScrollLock(true);

	useEffect(() => {
		const initial = initialFocusRef?.current ?? focusableElements(panelRef.current)[0];
		initial?.focus();
	}, [initialFocusRef]);

	const requestClose = useEffectEvent(() => {
		if (!dismissible || onInterceptBack?.() === true) {
			return;
		}
		onClose();
	});

	useFocusTrap(panelRef, { enabled: true });

	return createPortal(
		<OverlayScope onEscape={requestClose}>
			<div className={clsx("fixed inset-0 z-50 flex", containerClassName)}>
				<button
					type="button"
					aria-label={closeLabel}
					onClick={() => requestClose()}
					className={clsx("absolute inset-0", scrimClassName ?? "bg-overlay")}
				/>
				<div
					role="dialog"
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
