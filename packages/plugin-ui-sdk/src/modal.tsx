import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Drawer } from "@base-ui/react/drawer";
import type { Text } from "@ryot-app/i18n/text";
import clsx from "clsx";
import type { ReactElement, ReactNode, RefObject } from "react";

import { IconButton } from "./button";
import { revealFocusedField } from "./focused-field";
import { AppIcon } from "./icon";
import { ReportProvider } from "./report";
import { dismissTopOverlay, ShortcutScopeContext, useOverlayScope } from "./shortcut";

type ModalPlacement =
	| {
			readonly kind: "drawer";
			readonly onSwipeOpen?: () => void;
			readonly swipeArea?: ReactElement;
			readonly placement: "left" | "sheet";
	  }
	| {
			readonly swipeArea?: never;
			readonly onSwipeOpen?: never;
			readonly kind?: "alert" | "dialog";
			readonly placement?: "side" | "center";
	  };

type ModalProps = ModalPlacement & {
	readonly id?: string;
	readonly label?: Text;
	readonly open?: boolean;
	readonly className?: string;
	readonly labelledBy?: string;
	readonly children: ReactNode;
	readonly onClose: () => void;
	readonly dismissible?: boolean;
	readonly backEnabled?: boolean;
	readonly containerClassName?: string;
	readonly onClosed?: undefined | (() => void);
	readonly triggerRef?: undefined | RefObject<null | HTMLElement>;
	readonly initialFocusRef?: undefined | RefObject<null | HTMLElement>;
};

const backdropClassName =
	"absolute inset-0 z-50 bg-overlay transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none";
const popupClassName =
	"relative pointer-events-auto outline-none transition-[opacity,transform,translate] duration-150 ease-out motion-reduce:transition-none";
const dialogOffset = {
	side: "data-ending-style:translate-x-6 data-starting-style:translate-x-6",
	center: "data-ending-style:translate-y-1.5 data-starting-style:translate-y-1.5",
};
const drawerOffset = {
	left: "[transform:translateX(var(--drawer-swipe-movement-x,0px))] data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
	sheet:
		"[transform:translateY(var(--drawer-swipe-movement-y,0px))] data-ending-style:translate-y-full data-starting-style:translate-y-full",
};

export function ModalClose(props: {
	readonly label: Text;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly children?: ReactNode;
}) {
	return (
		<Dialog.Close
			disabled={props.disabled ?? false}
			render={
				<IconButton size="sm" label={props.label} className={props.className}>
					{props.children ?? <AppIcon name="x" size={18} />}
				</IconButton>
			}
		/>
	);
}

export function Modal({
	open = true,
	backEnabled = true,
	dismissible = true,
	...props
}: ModalProps) {
	const requestClose = () => {
		if (!dismissible) {
			return false;
		}
		props.onClose();
		return true;
	};
	const overlay = useOverlayScope(open, backEnabled ? requestClose : undefined);
	const onOpenChange = (
		next: boolean,
		details: Dialog.Root.ChangeEventDetails | Drawer.Root.ChangeEventDetails,
	) => {
		if (next) {
			if (details.reason === "swipe") {
				props.onSwipeOpen?.();
			}
			return;
		}
		if (details.reason === "close-watcher" && backEnabled && !overlay.isTop()) {
			details.cancel();
			dismissTopOverlay();
			return;
		}
		if (!overlay.isTop() || !requestClose()) {
			details.cancel();
		}
	};
	const root = {
		open,
		onOpenChange,
		onOpenChangeComplete: (opened: boolean) => {
			if (opened) {
				revealFocusedField();
			} else {
				props.onClosed?.();
			}
		},
	};
	const popup = {
		id: props.id,
		"aria-label": props.label,
		...(props.labelledBy === undefined ? {} : { "aria-labelledby": props.labelledBy }),
		finalFocus: props.triggerRef,
		initialFocus: props.initialFocusRef,
	};
	const viewportClassName = clsx(
		"pointer-events-none fixed inset-0 z-50 flex",
		props.containerClassName,
	);
	const children = (
		<ReportProvider report={null}>
			<ShortcutScopeContext value={overlay.scope}>{props.children}</ShortcutScopeContext>
		</ReportProvider>
	);

	if (props.kind === "drawer") {
		const { placement } = props;
		return (
			<Drawer.Root {...root} swipeDirection={placement === "left" ? "left" : "down"}>
				{props.swipeArea !== undefined && <Drawer.SwipeArea render={props.swipeArea} />}
				<Drawer.Portal>
					<Drawer.Backdrop
						forceRender
						className={clsx(
							backdropClassName,
							"opacity-[calc(1-var(--drawer-swipe-progress,0))] data-swiping:transition-none",
						)}
					/>
					<Drawer.Viewport className={viewportClassName}>
						<Drawer.Popup
							{...popup}
							className={clsx(
								popupClassName,
								drawerOffset[placement],
								"data-swiping:translate-none data-swiping:transition-none",
								props.className,
							)}
						>
							{children}
						</Drawer.Popup>
					</Drawer.Viewport>
				</Drawer.Portal>
			</Drawer.Root>
		);
	}

	const Surface = props.kind === "alert" ? AlertDialog : Dialog;
	return (
		<Surface.Root {...root}>
			<Surface.Portal>
				<Surface.Backdrop forceRender className={backdropClassName} />
				<Surface.Viewport className={viewportClassName}>
					<Surface.Popup
						{...popup}
						className={clsx(
							popupClassName,
							dialogOffset[props.placement ?? "center"],
							"data-ending-style:opacity-0 data-starting-style:opacity-0",
							props.className,
						)}
					>
						{children}
					</Surface.Popup>
				</Surface.Viewport>
			</Surface.Portal>
		</Surface.Root>
	);
}
