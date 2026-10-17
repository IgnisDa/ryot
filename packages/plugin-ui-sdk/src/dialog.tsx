import clsx from "clsx";
import { useId, type ReactNode, type RefObject } from "react";

import { IconButton } from "./button";
import { Modal } from "./modal";

const sizeClasses = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" } as const;

const containerClasses = {
	sheet: "items-end",
	side: "justify-end",
	center: "items-center justify-center p-4",
} as const;

const panelClasses = {
	side: "h-full max-w-md animate-sheet-in motion-reduce:animate-none",
	sheet: "max-h-[92%] rounded-t-xl animate-sheet-up motion-reduce:animate-none",
	center: "max-h-[min(90%,48rem)] animate-dialog-in rounded-xl motion-reduce:animate-none",
} as const;

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
	readonly placement?: "center" | "sheet" | "side";
	readonly size?: keyof typeof sizeClasses;
	readonly onInterceptBack?: () => boolean;
	readonly triggerRef?: RefObject<HTMLElement | null>;
	readonly initialFocusRef?: RefObject<HTMLElement | null>;
}) {
	const titleId = useId();
	const placement = props.placement ?? "center";
	return (
		<Modal
			labelledBy={titleId}
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
					className="mx-auto mt-2 h-1.25 w-9 shrink-0 rounded-pill bg-border-emphasis"
				/>
			)}
			<header
				className={clsx(
					"flex items-start gap-3 px-5 pt-5",
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
				{props.closeIcon !== undefined && (
					<IconButton
						size="sm"
						onClick={props.onClose}
						className="-mt-1 -mr-2"
						label={props.closeLabel}
					>
						{props.closeIcon}
					</IconButton>
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
