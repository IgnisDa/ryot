import clsx from "clsx";
import { type ReactNode, type RefObject, useId } from "react";

import { IconButton } from "./button";
import { AppIcon } from "./icon";
import { Modal, useModalClose } from "./modal";

const sizeClasses = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" } as const;

const containerClasses = {
	sheet: "items-end",
	side: "justify-end",
	center: "items-center justify-center p-4",
} as const;

const panelClasses = {
	side: "h-full max-w-md",
	sheet: "max-h-[92%] rounded-t-xl",
	center: "max-h-[min(90%,48rem)] rounded-xl",
} as const;

const defaultCloseIcon = <AppIcon name="x" size={18} />;

export function Dialog(props: {
	readonly title: string;
	readonly closeLabel: string;
	readonly footer?: ReactNode;
	readonly onClose: () => void;
	readonly children?: ReactNode;
	readonly closeIcon?: ReactNode;
	readonly dismissible?: boolean;
	readonly description?: ReactNode;
	readonly safeAreaBottom?: number;
	readonly size?: keyof typeof sizeClasses;
	readonly onInterceptBack?: () => boolean;
	readonly placement?: "side" | "sheet" | "center";
	readonly triggerRef?: RefObject<null | HTMLElement>;
	readonly initialFocusRef?: RefObject<null | HTMLElement>;
}) {
	const titleId = useId();
	const placement = props.placement ?? "center";
	const closeIcon = props.closeIcon === undefined ? defaultCloseIcon : props.closeIcon;
	return (
		<Modal
			labelledBy={titleId}
			placement={placement}
			onClose={props.onClose}
			closeLabel={props.closeLabel}
			triggerRef={props.triggerRef}
			dismissible={props.dismissible ?? true}
			initialFocusRef={props.initialFocusRef}
			onInterceptBack={props.onInterceptBack}
			containerClassName={containerClasses[placement]}
			className={clsx(
				"flex w-full flex-col bg-raised text-text shadow-modal outline-none",
				placement === "center"
					? clsx(panelClasses.center, sizeClasses[props.size ?? "md"])
					: panelClasses[placement],
			)}
		>
			{placement === "sheet" && (
				<div
					aria-hidden="true"
					data-sheet-drag-region
					className="flex h-7 shrink-0 touch-none items-center justify-center"
				>
					<div className="h-1.25 w-9 rounded-pill bg-border-emphasis" />
				</div>
			)}
			<header
				data-sheet-drag-region={placement === "sheet" ? "" : undefined}
				className={clsx(
					"flex items-start gap-3 px-5 pt-5",
					placement === "sheet" && "touch-none select-none pt-2",
					props.children === undefined ? "pb-5" : "pb-1",
				)}
			>
				<div className="min-w-0 flex-1">
					<h2 id={titleId} className="text-heading font-semibold text-text">
						{props.title}
					</h2>
					{props.description !== undefined && (
						<div className="mt-1 text-sm text-text-muted">{props.description}</div>
					)}
				</div>
				{closeIcon !== null && (
					<CloseButton label={props.closeLabel} disabled={props.dismissible === false}>
						{closeIcon}
					</CloseButton>
				)}
			</header>
			{props.children !== undefined && (
				<div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5 text-sm">
					{props.children}
				</div>
			)}
			{props.footer !== undefined && (
				<footer
					style={
						placement === "sheet"
							? { paddingBottom: Math.max(14, (props.safeAreaBottom ?? 0) + 12) }
							: undefined
					}
					className={clsx(
						"flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3.5",
						placement === "sheet" && "*:flex-1",
					)}
				>
					{props.footer}
				</footer>
			)}
		</Modal>
	);
}

function CloseButton(props: {
	readonly label: string;
	readonly disabled: boolean;
	readonly children: ReactNode;
}) {
	const close = useModalClose();
	return (
		<IconButton
			size="sm"
			label={props.label}
			className="-mt-1 -mr-2"
			onClick={() => close()}
			disabled={props.disabled}
		>
			{props.children}
		</IconButton>
	);
}
