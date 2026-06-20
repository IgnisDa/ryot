import { Button, Modal } from "@ryot-app/client-ui-sdk";
import { useRef, type RefObject } from "react";

export function ImportRunDeleteConfirmation(props: {
	readonly detail: string;
	readonly pending: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
	readonly errorMessage: string | undefined;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const cancelRef = useRef<HTMLButtonElement>(null);

	return (
		<Modal
			closeLabel="Close"
			onClose={props.onClose}
			initialFocusRef={cancelRef}
			triggerRef={props.triggerRef}
			labelledBy="import-run-delete-title"
			onInterceptBack={() => props.pending}
			className="ui-card w-[min(100%,460px)]"
			containerClassName="items-center justify-center p-4"
		>
			<h2 id="import-run-delete-title" className="font-display text-xl font-semibold">
				Delete this import record?
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
					disabled={props.pending}
					onClick={props.onConfirm}
					className="min-h-11 rounded-lg bg-danger-solid px-4 py-2.5 font-semibold text-danger-ink disabled:opacity-50"
				>
					{props.pending ? "Deleting..." : "Delete record"}
				</button>
			</div>
		</Modal>
	);
}
