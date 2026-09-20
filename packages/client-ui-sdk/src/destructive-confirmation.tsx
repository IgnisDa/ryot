import { useId, useRef, useState, type RefObject } from "react";

import { Modal } from "./modal";
import { TextField } from "./text-field";

export function DestructiveConfirmation(props: {
	readonly title: string;
	readonly detail: string;
	readonly pending: boolean;
	readonly onClose: () => void;
	readonly actionLabel: string;
	readonly onConfirm: () => void;
	readonly pendingLabel: string;
	readonly actionDisabled?: boolean;
	readonly confirmationPhrase?: string;
	readonly errorMessage: string | undefined;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const titleId = useId();
	const confirmationId = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);
	const confirmationRef = useRef<HTMLInputElement>(null);
	const [confirmation, setConfirmation] = useState("");
	const requiresConfirmation = props.confirmationPhrase !== undefined;
	const confirmationMatches = !requiresConfirmation || confirmation === props.confirmationPhrase;

	return (
		<Modal
			closeLabel="Close"
			labelledBy={titleId}
			onClose={props.onClose}
			triggerRef={props.triggerRef}
			onInterceptBack={() => props.pending}
			containerClassName="items-center justify-center p-4"
			initialFocusRef={requiresConfirmation ? confirmationRef : cancelRef}
			className="w-[min(100%,460px)] rounded-xl border border-border bg-surface p-5 shadow-card md:p-6"
		>
			<h2 id={titleId} className="font-display text-xl font-semibold">
				{props.title}
			</h2>
			<p className="mt-3 text-sm text-text-muted">{props.detail}</p>
			{requiresConfirmation ? (
				<label
					htmlFor={confirmationId}
					className="mt-4 grid gap-1.5 text-sm font-semibold text-text-muted"
				>
					{`Type "${props.confirmationPhrase}" to confirm`}
					<TextField
						autoComplete="off"
						id={confirmationId}
						value={confirmation}
						ref={confirmationRef}
						disabled={props.pending}
						className="w-full font-normal"
						onChange={(event) => setConfirmation(event.currentTarget.value)}
					/>
				</label>
			) : null}
			{props.errorMessage === undefined ? null : (
				<p role="alert" className="mt-3 text-sm text-danger">
					{props.errorMessage}
				</p>
			)}
			<div className="mt-6 flex justify-end gap-3">
				<button
					type="button"
					ref={cancelRef}
					onClick={props.onClose}
					disabled={props.pending}
					className="min-h-11 rounded-lg border border-border-strong px-4 py-2.5 font-semibold text-text disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={props.onConfirm}
					disabled={props.pending || props.actionDisabled === true || !confirmationMatches}
					className="min-h-11 rounded-lg bg-danger-solid px-4 py-2.5 font-semibold text-danger-ink disabled:opacity-50"
				>
					{props.pending ? props.pendingLabel : props.actionLabel}
				</button>
			</div>
		</Modal>
	);
}
