import type {
	SaveAssistantPageBody,
	SaveAssistantPageResult,
} from "@ryot-app/contract/modules/assistant/schemas";
import type { PageDraftBuildIdentity } from "@ryot-app/contract/modules/pages/identity";
import type { AssistantConversationId, AssistantTurnId } from "@ryot-app/contract/schema/brands";
import { formatDisplayText } from "@ryot-app/i18n/format";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, Dialog, Notice, tabId, Tabs } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { useId, useRef, useState } from "react";

import { PageIdentityFields, usePageIdentity } from "#/modules/page-authoring/identity-fields";
import { pageQuery } from "#/modules/page-authoring/service";
import { EmbeddedPagePreview } from "#/modules/pages/runtime/embedded-preview";
import { PublicationPageEditor } from "#/modules/publications/manager";
import { useEdge } from "#/modules/shell/authenticated-shell-context";

import { assistantFailureMessage, savePageMutation } from "./service";

type DraftProps = {
	readonly disabled: boolean;
	readonly turnId: AssistantTurnId;
	readonly identity: PageDraftBuildIdentity;
	readonly conversationId: AssistantConversationId;
};

const decodeSource = (content: string) => {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(
			Uint8Array.from(atob(content), (character) => character.charCodeAt(0)),
		);
	} catch {
		return null;
	}
};

export function AssistantPageSave(
	props: DraftProps & { readonly name: string; readonly onNavigate: (href: string) => void },
) {
	const t = useT();
	const save = useRyotMutation(savePageMutation);
	const identity = usePageIdentity(props.name);
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const [submission, setSubmission] = useState<null | SaveAssistantPageBody>(null);
	const [saved, setSaved] = useState<null | SaveAssistantPageResult>(null);
	const [sharing, setSharing] = useState(false);
	if (saved !== null) {
		return sharing ? (
			<PublicationPageEditor
				publication={null}
				pageId={saved.pageId}
				disabled={props.disabled}
				onDone={() => setSharing(false)}
				onCreated={(publicationId) =>
					props.onNavigate(
						`/settings/publications#publication-${encodeURIComponent(publicationId)}`,
					)
				}
			/>
		) : (
			<div className="flex flex-wrap items-center gap-2">
				<AppIcon size={16} name="circle-check" className="text-success" />
				<p className="flex-1 text-sm text-text">
					{t(kernelMessage("client.assistant.draft.saved"))}
				</p>
				<Button variant="secondary" disabled={props.disabled} onClick={() => setSharing(true)}>
					{t(kernelMessage("common.action.share"))}
				</Button>
				<Button onClick={() => props.onNavigate(`/v/c/${encodeURIComponent(saved.savedViewId)}`)}>
					{t(kernelMessage("client.assistant.draft.open-page"))}
				</Button>
			</div>
		);
	}
	return (
		<form
			className="grid gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				const captured = submission ?? {
					...props.identity,
					requestId,
					icon: "file-text",
					name: identity.name,
					slug: identity.slug,
					turnId: props.turnId,
					conversationId: props.conversationId,
				};
				setSubmission(captured);
				void Effect.runPromise(
					save
						.mutateEffect(captured)
						.pipe(Effect.match({ onSuccess: setSaved, onFailure: () => undefined })),
				);
			}}
		>
			<PageIdentityFields identity={identity} disabled={submission !== null} />
			<div className="flex flex-wrap items-center gap-2">
				<p className="flex-1 text-label text-text-subtle">
					{t(kernelMessage("client.assistant.draft.no-write-access"))}
				</p>
				{save.error === null ? null : (
					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							setSubmission(null);
							setRequestId(crypto.randomUUID());
							save.reset();
						}}
					>
						{t(kernelMessage("client.assistant.draft.edit-details"))}
					</Button>
				)}
				<Button type="submit" disabled={props.disabled || save.isPending || !identity.complete}>
					{t(
						save.isPending
							? kernelMessage("common.status.saving")
							: kernelMessage("client.assistant.draft.save"),
					)}
				</Button>
			</div>
			{save.error === null ? null : (
				<Notice tone="danger">{t(assistantFailureMessage(save.error))}</Notice>
			)}
		</form>
	);
}

function DraftSource(props: { readonly pageId: string }) {
	const t = useT();
	const page = useRyotQuery(pageQuery, { reload: 0, pageId: props.pageId });
	if (page.data == null) {
		return (
			<p role="status" className="text-sm text-text-muted">
				{t(
					page.isError
						? kernelMessage("client.assistant.draft.source-unavailable")
						: kernelMessage("client.assistant.draft.source-loading"),
				)}
			</p>
		);
	}
	return (
		<div className="grid gap-4">
			{page.data.draftDefinition.files.map((file) => (
				<section key={file.path} className="grid gap-1.5">
					<h3 className="font-mono text-label text-text-muted">{file.path}</h3>
					<pre className="max-h-96 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-micro text-text">
						{decodeSource(file.content) ?? t(kernelMessage("client.assistant.draft.binary-file"))}
					</pre>
				</section>
			))}
		</div>
	);
}

const tabs = [
	{ value: "preview", label: kernelMessage("client.assistant.draft.tab.preview") },
	{ value: "source", label: kernelMessage("client.assistant.draft.tab.source") },
] as const;

export function AssistantPageDraft(props: DraftProps) {
	const t = useT();
	const edge = useEdge();
	const navigate = useNavigate();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const page = useRyotQuery(pageQuery, { reload: 0, pageId: props.identity.pageId });
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<(typeof tabs)[number]["value"]>("preview");
	const panelId = useId();
	const name =
		page.data?.name === undefined
			? t(kernelMessage("client.assistant.draft.default-name"))
			: formatDisplayText(t, page.data.name);
	const files = page.data?.draftDefinition.files.length;
	return (
		<>
			<div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-card bg-surface p-3">
				<span className="flex size-10 items-center justify-center rounded-md bg-accent-soft text-accent-text">
					<AppIcon size={18} name="file-text" />
				</span>
				<div className="grid min-w-0 flex-1 gap-0.5">
					<p className="truncate font-medium text-text">{name}</p>
					<p className="flex flex-wrap items-center gap-1.5 text-label text-text-subtle">
						<Badge size="sm" variant="neutral">
							{t(kernelMessage("client.assistant.draft.badge"))}
						</Badge>
						{t(
							kernelMessage("client.assistant.draft.revision", {
								revision: props.identity.draftRevision,
							}),
						)}
						{files === undefined ? null : (
							<> · {t(kernelMessage("client.assistant.draft.files", { count: files }))}</>
						)}
					</p>
				</div>
				<Button ref={triggerRef} variant="secondary" onClick={() => setOpen(true)}>
					{t(kernelMessage("client.assistant.draft.open-preview"))}
				</Button>
			</div>
			{open ? (
				<Dialog
					size="lg"
					title={name}
					triggerRef={triggerRef}
					onClose={() => setOpen(false)}
					placement={edge.compact ? "sheet" : "center"}
					closeLabel={t(kernelMessage("client.assistant.draft.close-preview"))}
					description={t(kernelMessage("client.assistant.draft.preview-description"))}
					footer={
						page.data == null ? undefined : (
							<AssistantPageSave
								{...props}
								name={page.data.name}
								onNavigate={(href) => {
									setOpen(false);
									void navigate({ href });
								}}
							/>
						)
					}
				>
					<div className="grid gap-4">
						<Tabs
							value={tab}
							panelId={panelId}
							onChange={setTab}
							label={t(kernelMessage("client.assistant.draft.tabs-label"))}
							options={tabs.map(({ value, label }) => ({ value, label: t(label) }))}
						/>
						<div id={panelId} role="tabpanel" aria-labelledby={tabId(panelId, tab)}>
							{tab === "preview" ? (
								<div className="h-[min(60vh,32rem)] overflow-hidden rounded-lg border border-border">
									<EmbeddedPagePreview title={name} identity={props.identity} />
								</div>
							) : (
								<DraftSource pageId={props.identity.pageId} />
							)}
						</div>
					</div>
				</Dialog>
			) : null}
		</>
	);
}
