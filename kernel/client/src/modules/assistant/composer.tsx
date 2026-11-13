import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { IconButton, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Effect } from "effect";
import { type ReactNode, useId, useState } from "react";

import { ASSISTANT_NAME } from "./presentation";
import { assistantFailureText, submitMutation } from "./service";

export const useAssistantSubmit = (options: {
	readonly conversationId?: undefined | AssistantConversationId;
	readonly onSubmitted?: (conversationId: AssistantConversationId) => void;
}) => {
	const submit = useRyotMutation(submitMutation);
	const [text, setText] = useState("");
	const [pending, setPending] = useState<null | {
		readonly text: string;
		readonly requestId: string;
	}>(null);
	const send = (value: string) => {
		const captured = pending ?? { text: value.trim(), requestId: crypto.randomUUID() };
		if (captured.text === "") {
			return;
		}
		setPending(captured);
		void Effect.runPromise(
			submit
				.mutateEffect({
					...captured,
					...(options.conversationId === undefined
						? {}
						: { conversationId: options.conversationId }),
				})
				.pipe(
					Effect.match({
						onFailure: () => undefined,
						onSuccess: (result) => {
							setText("");
							setPending(null);
							options.onSubmitted?.(result.conversationId);
						},
					}),
				),
		);
	};
	return {
		send,
		text,
		setText,
		error: submit.error,
		locked: pending !== null,
		sending: submit.isPending,
		retrying: pending !== null && submit.error !== null,
	};
};

export function AssistantComposer(props: {
	readonly disabled: boolean;
	readonly footer?: ReactNode;
	readonly placeholder: string;
	readonly submit: ReturnType<typeof useAssistantSubmit>;
	readonly stop?: undefined | { readonly pending: boolean; readonly onStop: () => void };
}) {
	const { submit } = props;
	const inputId = useId();
	const canSend = !props.disabled && !submit.sending && submit.text.trim() !== "";
	return (
		<div className="mx-auto grid w-full max-w-2xl gap-2">
			{submit.error === null ? null : (
				<Notice tone="danger">{assistantFailureText(submit.error)}</Notice>
			)}
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (canSend) {
						submit.send(submit.text);
					}
				}}
				className="grid gap-1.5 rounded-xl border border-border-emphasis bg-surface p-2 pl-3 shadow-sm focus-within:border-border-strong"
			>
				<label htmlFor={inputId} className="sr-only">
					Message {ASSISTANT_NAME}
				</label>
				<div className="flex items-end gap-2">
					<textarea
						rows={1}
						id={inputId}
						value={submit.text}
						placeholder={props.placeholder}
						disabled={props.disabled || submit.locked}
						onChange={(event) => submit.setText(event.target.value)}
						className="max-h-48 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-base text-text outline-none field-sizing-content placeholder:text-text-subtle disabled:opacity-60 pointer-fine:text-body"
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								!event.shiftKey &&
								!event.nativeEvent.isComposing &&
								canSend
							) {
								event.preventDefault();
								submit.send(submit.text);
							}
						}}
					/>
					{props.stop === undefined ? (
						<IconButton
							type="submit"
							tone="accent"
							disabled={!canSend && !submit.retrying}
							label={submit.retrying ? "Retry message" : "Send"}
						>
							<AppIcon size={16} name={submit.retrying ? "rotate-ccw" : "arrow-up"} />
						</IconButton>
					) : (
						<IconButton
							label="Stop"
							tone="filled"
							onClick={props.stop.onStop}
							disabled={props.stop.pending}
						>
							<AppIcon size={14} name="square" />
						</IconButton>
					)}
				</div>
				{props.footer === undefined ? null : (
					<div className="text-micro text-text-subtle">{props.footer}</div>
				)}
			</form>
		</div>
	);
}
