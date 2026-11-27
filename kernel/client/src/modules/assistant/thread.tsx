import { AssistantConversationTitle } from "@ryot-app/contract/modules/assistant/schemas";
import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { formatDisplayText } from "@ryot-app/i18n/format";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	DestructiveConfirmation,
	Dialog,
	EmptyState,
	Field,
	LoadMoreButton,
	MenuButton,
	Notice,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import {
	type AssistantTranscriptTurn,
	isActiveAssistantTurn,
	projectAssistantTurn,
} from "@ryot-app/ryotql-recipes/assistant";
import { Link } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { usePluginCatalog } from "#/modules/plugins/catalog/provider";

import { AssistantComposer, useAssistantSubmit } from "./composer";
import { ASSISTANT_NAME } from "./presentation";
import {
	assistantFailureMessage,
	deleteConversationMutation,
	interruptMutation,
	providerQuery,
	renameConversationMutation,
	transcriptQuery,
} from "./service";
import { type AssistantMood, turnMood } from "./sprite";
import { AssistantTurn } from "./turn";

const initialCursor: string | undefined = undefined;
const isTitle = Schema.is(AssistantConversationTitle);

export type AssistantFrameParts = {
	readonly title: Text;
	readonly dock?: ReactNode;
	readonly followEnd?: string;
	readonly mood: AssistantMood;
	readonly actions?: ReactNode;
	readonly children: ReactNode;
};

export function AssistantConversation(props: {
	readonly disabled: boolean;
	readonly onDeleted: () => void;
	readonly onStartNew: () => void;
	readonly conversationId: AssistantConversationId;
	readonly renderFrame: (parts: AssistantFrameParts) => ReactNode;
}) {
	const t = useT();
	const { catalog } = usePluginCatalog();
	const provider = useRyotQuery(providerQuery, {});
	const transcript = useRyotInfiniteQuery(
		transcriptQuery,
		{ conversationId: props.conversationId },
		{
			initialPageParam: initialCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after }),
			getNextPageParam: (page, param, pages) =>
				nextPageCursor(
					page.turns,
					param,
					pages.map((item) => item.turns),
				),
		},
	);
	const interrupt = useRyotMutation(interruptMutation);
	const remove = useRyotMutation(deleteConversationMutation);
	const submit = useAssistantSubmit({ conversationId: props.conversationId });
	const [renaming, setRenaming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const menuTrigger = useRef<HTMLButtonElement>(null);
	const conversation = transcript.pages[0]?.conversation;
	const { turns, latest } = useMemo((): {
		readonly turns: readonly AssistantTranscriptTurn[];
		readonly latest: undefined | AssistantTranscriptTurn;
	} => {
		const newestFirst = paginationItems(
			transcript.pages,
			(page) => page.turns.items,
			(turn) => turn.id,
		);
		const ordered: AssistantTranscriptTurn[] = [];
		for (let index = newestFirst.length - 1; index >= 0; index -= 1) {
			ordered.push(projectAssistantTurn(newestFirst[index]));
		}
		return { turns: ordered, latest: ordered[ordered.length - 1] };
	}, [transcript.pages]);
	const active = latest !== undefined && isActiveAssistantTurn(latest.status);

	if (transcript.isSuccess && conversation === undefined) {
		return props.renderFrame({
			mood: "oops",
			title: t(kernelMessage("client.assistant.thread.default-title")),
			children: (
				<EmptyState
					title={t(kernelMessage("client.assistant.thread.unavailable-title"))}
					description={t(kernelMessage("client.assistant.thread.unavailable-detail"))}
					action={
						<Button onClick={props.onStartNew}>
							{t(kernelMessage("client.assistant.new-chat"))}
						</Button>
					}
				/>
			),
		});
	}

	const title =
		conversation === undefined
			? t(kernelMessage("client.assistant.thread.default-title"))
			: formatDisplayText(t, conversation.title);
	let dock = (
		<AssistantComposer
			submit={submit}
			disabled={provider.data == null}
			placeholder={t(
				kernelMessage("client.assistant.thread.reply-placeholder", { name: ASSISTANT_NAME }),
			)}
			stop={
				active
					? {
							pending: interrupt.isPending,
							onStop: () =>
								void Effect.runPromise(
									interrupt
										.mutateEffect({ turnId: latest.id, conversationId: props.conversationId })
										.pipe(Effect.ignore),
								),
						}
					: undefined
			}
		/>
	);
	if (latest?.status === "awaiting-approval" || latest?.status === "awaiting-input") {
		dock = (
			<div className="mx-auto flex w-full max-w-2xl items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-3 text-label text-text-muted">
				<span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" />
				<span className="flex-1">
					{t(
						kernelMessage("client.assistant.thread.waiting", {
							name: ASSISTANT_NAME,
							kind: latest.status === "awaiting-input" ? "answer" : "decision",
						}),
					)}
				</span>
				<Button
					size="sm"
					variant="secondary"
					onClick={() =>
						document
							.querySelector("[data-assistant-pending-approval]")
							?.scrollIntoView({ block: "center", behavior: "smooth" })
					}
				>
					{t(kernelMessage("client.assistant.thread.review"))}
				</Button>
			</div>
		);
	}

	return props.renderFrame({
		dock,
		title,
		mood: turnMood(latest),
		followEnd: latest?.id ?? "",
		actions: (
			<MenuButton
				label={t(kernelMessage("client.assistant.thread.actions"))}
				items={[
					{
						key: "rename",
						onSelect: () => setRenaming(true),
						label: t(kernelMessage("client.assistant.thread.rename")),
					},
					{
						key: "delete",
						disabled: active,
						destructive: true,
						onSelect: () => setDeleting(true),
						label: t(kernelMessage("common.action.delete")),
					},
				]}
			/>
		),
		children: (
			<div className="grid gap-6 pb-2">
				{props.disabled ? (
					<Notice tone="info">{t(kernelMessage("client.assistant.start.demo-notice"))}</Notice>
				) : null}
				{provider.data === null ? (
					<Notice
						tone="info"
						action={
							<Link to="/settings/assistant">
								{t(kernelMessage("client.assistant.settings-link", { name: ASSISTANT_NAME }))}
							</Link>
						}
					>
						{t(kernelMessage("client.assistant.thread.connect-provider"))}
					</Notice>
				) : null}
				{transcript.isError ? (
					<Notice
						tone="danger"
						action={
							<Button onClick={transcript.refetch}>
								{t(kernelMessage("common.action.retry"))}
							</Button>
						}
					>
						{t(kernelMessage("client.assistant.thread.load-failed"))}
					</Notice>
				) : null}
				{transcript.hasNextPage ? (
					<LoadMoreButton
						onClick={transcript.fetchNextPage}
						isFetchingNextPage={transcript.isFetchingNextPage}
						label={t(kernelMessage("client.assistant.thread.earlier"))}
					/>
				) : null}
				{transcript.isPending ? (
					<p role="status" className="text-sm text-text-muted">
						{t(kernelMessage("client.assistant.thread.loading"))}
					</p>
				) : null}
				{turns.map((turn) => (
					<AssistantTurn
						turn={turn}
						key={turn.id}
						catalog={catalog}
						disabled={props.disabled}
						conversationId={props.conversationId}
					/>
				))}
				{interrupt.error === null ? null : (
					<Notice tone="danger">{t(assistantFailureMessage(interrupt.error))}</Notice>
				)}
				{renaming ? (
					<RenameDialog
						title={title}
						onClose={() => setRenaming(false)}
						conversationId={props.conversationId}
					/>
				) : null}
				{deleting ? (
					<DestructiveConfirmation
						triggerRef={menuTrigger}
						pending={remove.isPending}
						onClose={() => setDeleting(false)}
						pendingLabel={t(kernelMessage("common.status.deleting"))}
						title={t(kernelMessage("client.assistant.thread.delete-title"))}
						detail={t(kernelMessage("client.assistant.thread.delete-detail"))}
						actionLabel={t(kernelMessage("client.assistant.thread.delete-action"))}
						errorMessage={
							remove.error === null ? undefined : t(assistantFailureMessage(remove.error))
						}
						onConfirm={() =>
							void Effect.runPromise(
								remove
									.mutateEffect({ conversationId: props.conversationId })
									.pipe(Effect.match({ onFailure: () => undefined, onSuccess: props.onDeleted })),
							)
						}
					/>
				) : null}
			</div>
		),
	});
}

function RenameDialog(props: {
	readonly title: string;
	readonly onClose: () => void;
	readonly conversationId: AssistantConversationId;
}) {
	const t = useT();
	const rename = useRyotMutation(renameConversationMutation);
	const [title, setTitle] = useState(props.title);
	const formId = "assistant-rename";
	return (
		<Dialog
			size="sm"
			onClose={props.onClose}
			closeLabel={t(kernelMessage("common.action.cancel"))}
			title={t(kernelMessage("client.assistant.thread.rename-title"))}
			footer={
				<Button type="submit" form={formId} disabled={rename.isPending || !isTitle(title.trim())}>
					{t(
						rename.isPending
							? kernelMessage("common.status.saving")
							: kernelMessage("common.action.save"),
					)}
				</Button>
			}
		>
			<form
				id={formId}
				className="grid gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					void Effect.runPromise(
						rename
							.mutateEffect({ title: title.trim(), conversationId: props.conversationId })
							.pipe(Effect.match({ onSuccess: props.onClose, onFailure: () => undefined })),
					);
				}}
			>
				<Field label={t(kernelMessage("client.assistant.thread.title-label"))}>
					{(control) => (
						<TextField
							{...control}
							required
							value={title}
							maxLength={60}
							onChange={(event) => setTitle(event.target.value)}
						/>
					)}
				</Field>
				{rename.error === null ? null : (
					<Notice tone="danger">{t(assistantFailureMessage(rename.error))}</Notice>
				)}
			</form>
		</Dialog>
	);
}
