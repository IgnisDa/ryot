import { Button, Modal } from "@ryot-app/client-ui-sdk";
import { useId, useRef, type RefObject } from "react";

export function DestructiveConfirmation(props: {
	readonly title: string;
	readonly detail: string;
	readonly pending: boolean;
	readonly onClose: () => void;
	readonly actionLabel: string;
	readonly onConfirm: () => void;
	readonly pendingLabel: string;
	readonly actionDisabled?: boolean;
	readonly errorMessage: string | undefined;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const titleId = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);

	return (
		<Modal
			closeLabel="Close"
			labelledBy={titleId}
			onClose={props.onClose}
			initialFocusRef={cancelRef}
			triggerRef={props.triggerRef}
			onInterceptBack={() => props.pending}
			className="ui-card w-[min(100%,460px)]"
			containerClassName="items-center justify-center p-4"
		>
			<h2 id={titleId} className="font-display text-xl font-semibold">
				{props.title}
			</h2>
			<p className="mt-3 text-sm text-text-muted">{props.detail}</p>
			{props.errorMessage === undefined ? null : (
				<p role="alert" className="mt-3 text-sm text-danger">
					{props.errorMessage}
				</p>
			)}
			<div className="mt-6 flex justify-end gap-3">
				<Button
					type="button"
					ref={cancelRef}
					variant="secondary"
					onClick={props.onClose}
					disabled={props.pending}
				>
					Cancel
				</Button>
				<button
					type="button"
					onClick={props.onConfirm}
					disabled={props.pending || props.actionDisabled === true}
					className="min-h-11 rounded-lg bg-danger-solid px-4 py-2.5 font-semibold text-danger-ink disabled:opacity-50"
				>
					{props.pending ? props.pendingLabel : props.actionLabel}
				</button>
			</div>
		</Modal>
	);
}
