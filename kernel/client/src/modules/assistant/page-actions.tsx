import type {
	SaveAssistantPageBody,
	SaveAssistantPageResult,
} from "@ryot-app/contract/modules/assistant/schemas";
import type { PageDraftBuildIdentity } from "@ryot-app/contract/modules/pages/identity";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Button, Field, Notice, TextField } from "@ryot-app/plugin-ui-sdk";
import { Effect } from "effect";
import { useState } from "react";

import { PublicationPageEditor } from "#/modules/publications/manager";

import { assistantFailureText, savePageMutation } from "./service";

export function AssistantPageActions(
	props: Pick<SaveAssistantPageBody, "turnId" | "conversationId"> & {
		readonly ready: boolean;
		readonly disabled: boolean;
		readonly identity: PageDraftBuildIdentity;
	},
) {
	const save = useRyotMutation(savePageMutation);
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const [submission, setSubmission] = useState<null | SaveAssistantPageBody>(null);
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [saved, setSaved] = useState<null | SaveAssistantPageResult>(null);
	const [sharing, setSharing] = useState(false);
	const [publicationId, setPublicationId] = useState<null | string>(null);
	const sharingHref = `/settings/publications#publication-${encodeURIComponent(publicationId ?? "")}`;
	return (
		<>
			{saved === null ? (
				<form
					className="grid gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						const captured = submission ?? {
							...props.identity,
							name,
							slug,
							requestId,
							icon: "file-text",
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
					<Field label="Page name">
						{(control) => (
							<TextField
								{...control}
								required
								value={name}
								disabled={submission !== null}
								onChange={(event) => setName(event.target.value)}
							/>
						)}
					</Field>
					<Field label="Page address">
						{(control) => (
							<TextField
								{...control}
								required
								value={slug}
								disabled={submission !== null}
								onChange={(event) => setSlug(event.target.value)}
							/>
						)}
					</Field>
					<Button type="submit" disabled={props.disabled || save.isPending || !props.ready}>
						{save.isPending ? "Saving…" : "Save page and view"}
					</Button>
					{save.error === null ? null : (
						<Button
							type="button"
							variant="secondary"
							disabled={props.disabled || save.isPending}
							onClick={() => {
								setSubmission(null);
								setRequestId(crypto.randomUUID());
								save.reset();
							}}
						>
							Edit details
						</Button>
					)}
				</form>
			) : (
				<div className="flex gap-3">
					<a href={`/v/c/${encodeURIComponent(saved.savedViewId)}`}>Open saved page</a>
					{publicationId === null ? (
						<Button disabled={props.disabled} onClick={() => setSharing(true)}>
							Share
						</Button>
					) : (
						<a href={sharingHref}>Share</a>
					)}
				</div>
			)}
			{save.error === null ? null : (
				<Notice tone="danger">{assistantFailureText(save.error)}</Notice>
			)}
			{publicationId === null ? null : <a href={sharingHref}>Manage sharing links</a>}
			{sharing && saved !== null ? (
				<PublicationPageEditor
					publication={null}
					pageId={saved.pageId}
					disabled={props.disabled}
					onDone={() => setSharing(false)}
					onCreated={(id) => {
						setPublicationId(id);
						setSharing(false);
					}}
				/>
			) : null}
		</>
	);
}
