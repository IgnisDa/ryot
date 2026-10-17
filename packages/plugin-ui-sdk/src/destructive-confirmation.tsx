import { useId, useRef, useState, type RefObject } from "react";

import { Button } from "./button";
import { Dialog } from "./dialog";
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
	const confirmationId = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);
	const confirmationRef = useRef<HTMLInputElement>(null);
	const [confirmation, setConfirmation] = useState("");
	const requiresConfirmation = props.confirmationPhrase !== undefined;
	const confirmationMatches = !requiresConfirmation || confirmation === props.confirmationPhrase;

	return (
		<Dialog
			closeLabel="Close"
			title={props.title}
			onClose={props.onClose}
			description={props.detail}
			triggerRef={props.triggerRef}
			onInterceptBack={() => props.pending}
			initialFocusRef={requiresConfirmation ? confirmationRef : cancelRef}
			footer={
				<>
					<Button ref={cancelRef} variant="ghost" onClick={props.onClose} disabled={props.pending}>
						Cancel
					</Button>
					<Button
						variant="danger"
						onClick={props.onConfirm}
						disabled={props.pending || props.actionDisabled === true || !confirmationMatches}
					>
						{props.pending ? props.pendingLabel : props.actionLabel}
					</Button>
				</>
			}
		>
			{requiresConfirmation || props.errorMessage !== undefined ? (
				<div className="grid gap-3">
					{requiresConfirmation ? (
						<label
							htmlFor={confirmationId}
							className="grid gap-1.5 text-[13px] font-medium text-text"
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
						<p role="alert" className="text-sm text-danger">
							{props.errorMessage}
						</p>
					)}
				</div>
			) : undefined}
		</Dialog>
	);
}
