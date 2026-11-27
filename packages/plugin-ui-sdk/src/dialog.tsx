import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Drawer } from "@base-ui/react/drawer";
import type { Text } from "@ryot-app/i18n/text";
import clsx from "clsx";
import type { ReactNode, RefObject } from "react";

import { Modal, ModalClose } from "./modal";

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

type DialogPlacement =
	| { readonly kind: "alert"; readonly placement?: "side" | "center" }
	| { readonly kind?: "dialog"; readonly placement?: "side" | "sheet" | "center" };

export function Dialog(
	props: DialogPlacement & {
		readonly title: Text;
		readonly open?: boolean;
		readonly closeLabel: Text;
		readonly footer?: ReactNode;
		readonly onClose: () => void;
		readonly children?: ReactNode;
		readonly closeIcon?: ReactNode;
		readonly dismissible?: boolean;
		readonly description?: ReactNode;
		readonly safeAreaBottom?: number;
		readonly size?: keyof typeof sizeClasses;
		readonly onClosed?: undefined | (() => void);
		readonly triggerRef?: RefObject<null | HTMLElement>;
		readonly initialFocusRef?: RefObject<null | HTMLElement>;
	},
) {
	const placement = props.placement ?? "center";
	const Content = placement === "sheet" ? Drawer.Content : "div";
	return (
		<Modal
			{...(placement === "sheet"
				? { placement, kind: "drawer" }
				: { placement, kind: props.kind ?? "dialog" })}
			onClose={props.onClose}
			onClosed={props.onClosed}
			open={props.open ?? true}
			triggerRef={props.triggerRef}
			dismissible={props.dismissible ?? true}
			initialFocusRef={props.initialFocusRef}
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
					className="flex h-7 shrink-0 touch-none items-center justify-center"
				>
					<div className="h-1.25 w-9 rounded-pill bg-border-emphasis" />
				</div>
			)}
			<header
				className={clsx(
					"flex items-start gap-3 px-5 pt-5",
					placement === "sheet" && "touch-none select-none pt-2",
					props.children === undefined ? "pb-5" : "pb-1",
				)}
			>
				<div className="min-w-0 flex-1">
					<BaseDialog.Title className="text-heading font-semibold text-text">
						{props.title}
					</BaseDialog.Title>
					{props.description !== undefined && (
						<BaseDialog.Description render={<div />} className="mt-1 text-sm text-text-muted">
							{props.description}
						</BaseDialog.Description>
					)}
				</div>
				{props.closeIcon !== null && (
					<ModalClose
						className="-mt-1 -mr-2"
						label={props.closeLabel}
						disabled={props.dismissible === false}
					>
						{props.closeIcon}
					</ModalClose>
				)}
			</header>
			{props.children !== undefined && (
				<Content className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-3 pb-5 text-sm">
					{props.children}
				</Content>
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
