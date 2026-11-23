import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { type RefObject, useId, useRef, useState } from "react";

import { Button } from "./button";
import { Dialog } from "./dialog";
import { TextField } from "./text-field";

export function DestructiveConfirmation(props: {
	readonly title: Text;
	readonly detail: Text;
	readonly pending: boolean;
	readonly actionLabel: Text;
	readonly pendingLabel: Text;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
	readonly actionDisabled?: boolean;
	readonly confirmationPhrase?: string;
	readonly errorMessage: Text | undefined;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const t = useT();
	const confirmationId = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);
	const confirmationRef = useRef<HTMLInputElement>(null);
	const [confirmation, setConfirmation] = useState("");
	const requiresConfirmation = props.confirmationPhrase !== undefined;
	const confirmationMatches = !requiresConfirmation || confirmation === props.confirmationPhrase;

	return (
		<Dialog
			kind="alert"
			closeIcon={null}
			title={props.title}
			onClose={props.onClose}
			description={props.detail}
			dismissible={!props.pending}
			triggerRef={props.triggerRef}
			closeLabel={t(kernelMessage("common.action.close"))}
			initialFocusRef={requiresConfirmation ? confirmationRef : cancelRef}
			footer={
				<>
					<Button ref={cancelRef} variant="ghost" onClick={props.onClose} disabled={props.pending}>
						{t(kernelMessage("common.action.cancel"))}
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
							className="grid gap-1.5 text-label font-medium text-text"
						>
							{t(
								kernelMessage("ui.destructive-confirmation.type-to-confirm", {
									phrase: props.confirmationPhrase ?? "",
								}),
							)}
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
