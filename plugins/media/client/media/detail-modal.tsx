import { Button, Modal } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { type ComponentProps, type ReactNode, type RefObject, useRef, useState } from "react";

export function MediaDetailModalButton({
	triggerLabel,
	...props
}: { readonly triggerLabel: string } & Omit<
	ComponentProps<typeof MediaDetailModal>,
	"label" | "onClose" | "triggerRef"
>) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			<Button variant="link" ref={triggerRef} onClick={() => setOpen(true)}>
				{triggerLabel}
			</Button>
			{open ? (
				<MediaDetailModal
					{...props}
					label={props.title}
					triggerRef={triggerRef}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	);
}

export function MediaDetailModal({
	title,
	label,
	compact,
	onClose,
	toolbar,
	overlay,
	children,
	closeLabel,
	triggerRef,
	contentRef,
	safeAreaTop,
	headerAside,
}: {
	readonly title: string;
	readonly label: string;
	readonly compact: boolean;
	readonly closeLabel: string;
	readonly safeAreaTop: number;
	readonly onClose: () => void;
	readonly toolbar?: ReactNode;
	readonly children: ReactNode;
	readonly overlay?: ReactNode;
	readonly headerAside?: ReactNode;
	readonly triggerRef: RefObject<null | HTMLElement>;
	readonly contentRef?: RefObject<null | HTMLDivElement>;
}) {
	return (
		<Modal
			label={label}
			onClose={onClose}
			closeLabel={closeLabel}
			triggerRef={triggerRef}
			containerClassName={
				compact ? "items-stretch justify-stretch" : "items-center justify-center p-6"
			}
			className={clsx(
				"flex flex-col overflow-hidden bg-surface",
				compact
					? "h-full w-full"
					: "h-full max-h-184 w-full max-w-5xl rounded-xl border border-border",
			)}
		>
			<div
				style={{ paddingTop: compact ? safeAreaTop + 16 : undefined }}
				className="flex items-center justify-between gap-4 px-4 pt-4 pb-3"
			>
				<div className="flex min-w-0 items-baseline gap-3">
					<h2 className="font-display font-semibold text-lg text-text">{title}</h2>
					{headerAside}
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label={closeLabel}
					className="rounded-full text-text-muted focus-visible:outline-2 focus-visible:outline-accent"
				>
					<AppIcon size={22} name="circle-x" />
				</button>
			</div>
			{toolbar}
			<div
				ref={contentRef}
				className="min-h-0 flex-1 overflow-y-auto border-border border-t px-4 py-4"
			>
				{children}
			</div>
			{overlay}
		</Modal>
	);
}
