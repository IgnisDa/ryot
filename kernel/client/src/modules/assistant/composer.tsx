import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { EntitlementNotice, IconButton, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { createUuid } from "@ryot-app/ts-utils/uuid";
import { Effect } from "effect";
import { type ReactNode, useId, useState } from "react";

import { useEntitlement } from "#/modules/entitlements/context";

import { ASSISTANT_NAME } from "./presentation";
import { assistantFailureMessage, submitMutation } from "./service";

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
		const captured = pending ?? { text: value.trim(), requestId: createUuid() };
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
	readonly placeholder: Text;
	readonly footer?: ReactNode;
	readonly submit: ReturnType<typeof useAssistantSubmit>;
	readonly stop?: undefined | { readonly pending: boolean; readonly onStop: () => void };
}) {
	const { submit } = props;
	const t = useT();
	const inputId = useId();
	const pro = useEntitlement("pro");
	const canSend = !props.disabled && !submit.sending && submit.text.trim() !== "";
	if (!pro) {
		return (
			<div className="mx-auto w-full max-w-2xl">
				<EntitlementNotice
					entitlement="pro"
					icon={<AppIcon size={16} name="sparkles" />}
					detail={t(kernelMessage("client.assistant.pro-required", { name: ASSISTANT_NAME }))}
				/>
			</div>
		);
	}
	return (
		<div className="mx-auto grid w-full max-w-2xl gap-2">
			{submit.error === null ? null : (
				<Notice tone="danger">{t(assistantFailureMessage(submit.error))}</Notice>
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
					{t(kernelMessage("client.assistant.composer.label", { name: ASSISTANT_NAME }))}
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
					{props.stop === undefined ? null : (
						<IconButton
							tone="filled"
							onClick={props.stop.onStop}
							disabled={props.stop.pending}
							label={t(kernelMessage("client.assistant.composer.stop"))}
						>
							<AppIcon size={14} name="square" />
						</IconButton>
					)}
					{props.stop !== undefined && submit.text.trim() === "" && !submit.retrying ? null : (
						<IconButton
							type="submit"
							tone="accent"
							disabled={!canSend && !submit.retrying}
							label={t(
								submit.retrying
									? kernelMessage("client.assistant.composer.retry")
									: kernelMessage("client.assistant.composer.send"),
							)}
						>
							<AppIcon size={16} name={submit.retrying ? "rotate-ccw" : "arrow-up"} />
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
