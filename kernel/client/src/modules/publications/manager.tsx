import type { PublicationSource } from "@ryot-app/contract/modules/publications/schemas";
import { PublicationId } from "@ryot-app/contract/schema/brands";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	DestructiveConfirmation,
	EmptyState,
	Field,
	LoadMoreButton,
	Notice,
	Select,
	TextArea,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { PublicationSummary } from "@ryot-app/ryotql-recipes/publications";
import { Effect } from "effect";
import { type SubmitEvent, useRef, useState } from "react";

import type { ServerOrigin } from "#/api/origin";

import { PublicationDetailsFields } from "./details-fields";
import { publicationFailureText, PublicationLinks } from "./links";
import { usePublicationPreview } from "./preview";
import {
	COLLECTION_PUBLICATION_ICON,
	createPublicationMutation,
	publicationCommandMutation,
	PUBLICATIONS_PAGE_SIZE,
	publicationSourcesQuery,
	publicationsQuery,
} from "./service";
import { PublicationHeader } from "./status";

const KEEP_SOURCE = "keep";
const initialCursor: string | undefined = undefined;

export function PublicationsManager(props: {
	readonly disabled: boolean;
	readonly serverUrl: ServerOrigin;
}) {
	const [editing, setEditing] = useState<null | "new" | PublicationSummary>(null);
	const query = useRyotInfiniteQuery(
		publicationsQuery,
		{ limit: PUBLICATIONS_PAGE_SIZE },
		{
			initialPageParam: initialCursor,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after }),
		},
	);
	const publications = paginationItems(
		query.pages,
		(page) => page.items,
		(publication) => publication.id,
	);

	if (editing !== null) {
		return (
			<PublicationEditor
				disabled={props.disabled}
				onDone={() => setEditing(null)}
				publication={editing === "new" ? null : editing}
			/>
		);
	}

	return (
		<div className="grid gap-4">
			<p className="text-sm text-text-muted">
				Share a read-only page of a collection or saved view. Anyone with a link can view it without
				an account, and it stays up to date as you change things.
			</p>
			<div>
				<Button disabled={props.disabled} onClick={() => setEditing("new")}>
					New publication
				</Button>
			</div>
			{query.isError && publications.length === 0 ? (
				<Notice tone="danger" action={<Button onClick={query.refetch}>Retry</Button>}>
					Your publications could not be loaded.
				</Notice>
			) : null}
			{!query.isPending && !query.isError && publications.length === 0 ? (
				<EmptyState
					title="Nothing shared yet"
					description="Use Share on a collection or saved view, or create a publication here."
				/>
			) : null}
			{publications.map((publication) => (
				<PublicationCard
					key={publication.id}
					disabled={props.disabled}
					publication={publication}
					serverUrl={props.serverUrl}
					onEdit={() => setEditing(publication)}
				/>
			))}
			{query.data?.pageInfo.hasMore === true && (
				<LoadMoreButton
					label="Load more"
					disabled={query.isFetching}
					onClick={query.fetchNextPage}
					isFetchingNextPage={query.isFetchingNextPage}
				/>
			)}
		</div>
	);
}

function PublicationCard(props: {
	readonly disabled: boolean;
	readonly onEdit: () => void;
	readonly serverUrl: ServerOrigin;
	readonly publication: PublicationSummary;
}) {
	const { publication } = props;
	const command = useRyotMutation(publicationCommandMutation);
	const preview = usePublicationPreview();
	const [confirming, setConfirming] = useState<null | "delete" | "revoke">(null);
	const confirmTrigger = useRef<null | HTMLButtonElement>(null);
	const active = publication.revokedAt === null;
	const payload = { publicationId: PublicationId.make(publication.id) };
	const confirm = (action: "delete" | "revoke", trigger: HTMLButtonElement) => {
		confirmTrigger.current = trigger;
		setConfirming(action);
	};
	const closeConfirmation = () => {
		command.reset();
		setConfirming(null);
	};
	const confirmation =
		confirming === "revoke"
			? {
					actionLabel: "Stop sharing",
					pendingLabel: "Stopping...",
					title: "Stop sharing this publication?",
					detail: "Every link to it stops working, and it cannot be shared again.",
				}
			: {
					pendingLabel: "Deleting...",
					actionLabel: "Delete publication",
					title: "Delete this publication?",
					detail: "The publication and its links are deleted permanently.",
				};
	return (
		<Card className="grid gap-4">
			<PublicationHeader heading="h2" publication={publication} />
			{publication.description === null ? null : (
				<p className="text-sm text-text-muted">{publication.description}</p>
			)}
			{active && (
				<PublicationLinks
					disabled={props.disabled}
					publication={publication}
					serverUrl={props.serverUrl}
				/>
			)}
			<div className="flex flex-wrap gap-2 border-t border-border pt-4">
				{active && (
					<>
						<Button
							size="sm"
							variant="secondary"
							disabled={preview.isPending}
							onClick={() => preview.open(publication.id)}
						>
							<AppIcon size={16} name="eye" />
							Preview
						</Button>
						<Button size="sm" variant="secondary" onClick={props.onEdit} disabled={props.disabled}>
							Edit
						</Button>
						<Button
							size="sm"
							variant="dangerGhost"
							disabled={props.disabled}
							onClick={(event) => confirm("revoke", event.currentTarget)}
						>
							Stop sharing
						</Button>
					</>
				)}
				<Button
					size="sm"
					variant="dangerGhost"
					disabled={props.disabled}
					onClick={(event) => confirm("delete", event.currentTarget)}
				>
					Delete
				</Button>
			</div>
			{confirming === null ? null : (
				<DestructiveConfirmation
					{...confirmation}
					onClose={closeConfirmation}
					triggerRef={confirmTrigger}
					pending={command.isPending}
					errorMessage={command.error === null ? undefined : publicationFailureText(command.error)}
					onConfirm={() =>
						void Effect.runPromise(
							command
								.mutateEffect({ action: confirming, request: { payload } })
								.pipe(
									Effect.match({
										onFailure: () => undefined,
										onSuccess: () => setConfirming(null),
									}),
								),
						)
					}
				/>
			)}
		</Card>
	);
}

function PublicationEditor(props: {
	readonly disabled: boolean;
	readonly onDone: () => void;
	readonly publication: null | PublicationSummary;
}) {
	const sources = useRyotQuery(publicationSourcesQuery, undefined);
	const create = useRyotMutation(createPublicationMutation);
	const command = useRyotMutation(publicationCommandMutation);
	const [title, setTitle] = useState(props.publication?.title ?? "");
	const [description, setDescription] = useState(props.publication?.description ?? "");
	const [showOwnerName, setShowOwnerName] = useState(props.publication?.showOwnerName ?? false);
	const [selected, setSelected] = useState(props.publication === null ? "" : KEEP_SOURCE);
	const [error, setError] = useState<null | string>(null);

	const options: readonly {
		readonly key: string;
		readonly icon: string;
		readonly hint: string;
		readonly label: string;
		readonly source: PublicationSource;
	}[] = [
		...(props.publication === null
			? []
			: [
					{
						hint: "Current",
						key: KEEP_SOURCE,
						icon: props.publication.icon,
						label: "Keep what is shared now",
						source: props.publication.source,
					},
				]),
		...(sources.data?.collections ?? []).map(({ id, name }) => ({
			label: name,
			hint: "Collection",
			key: `collection:${id}`,
			icon: COLLECTION_PUBLICATION_ICON,
			source: { collectionId: id, kind: "collection" } as const,
		})),
		...(sources.data?.savedViews ?? []).map((view, index) => ({
			icon: view.icon,
			label: view.name,
			hint: "Saved view",
			key: `view:${index}`,
			source: { kind: "saved-view", reference: view.reference } as const,
		})),
	];

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const option = options.find(({ key }) => key === selected);
		if (option === undefined) {
			setError("Choose what to share.");
			return;
		}
		const details = {
			title,
			showOwnerName,
			icon: option.icon,
			source: option.source,
			description: description.trim() === "" ? null : description,
		};
		const save =
			props.publication === null
				? create.mutateEffect(details)
				: command.mutateEffect({
						action: "republish",
						request: { payload: { ...details, publicationId: props.publication.id } },
					});
		setError(null);
		void Effect.runPromise(
			save.pipe(
				Effect.match({
					onSuccess: props.onDone,
					onFailure: (failure) => setError(publicationFailureText(failure)),
				}),
			),
		);
	};

	return (
		<Card className="grid gap-4">
			<form onSubmit={submit} className="grid gap-4">
				<Select
					value={selected}
					label="What to share"
					onChange={setSelected}
					checkIcon={<AppIcon size={16} name="check" />}
					placeholder="Choose a collection or saved view"
					disabled={props.disabled || sources.data === undefined}
					chevronIcon={<AppIcon size={16} name="chevron-down" />}
					choices={options.map(({ key, hint, label }) => ({ hint, label, value: key }))}
				/>
				<PublicationDetailsFields
					title={title}
					onTitleChange={setTitle}
					showOwnerName={showOwnerName}
					onShowOwnerNameChange={setShowOwnerName}
				>
					<Field optional label="Description">
						{(control) => (
							<TextArea
								{...control}
								rows={2}
								maxLength={2000}
								value={description}
								onChange={(event) => setDescription(event.target.value)}
							/>
						)}
					</Field>
				</PublicationDetailsFields>
				{error === null ? null : <Notice tone="danger">{error}</Notice>}
				<div className="flex gap-2">
					<Button type="submit" disabled={props.disabled || create.isPending || command.isPending}>
						{props.publication === null ? "Publish" : "Save"}
					</Button>
					<Button type="button" variant="ghost" onClick={props.onDone}>
						Cancel
					</Button>
				</div>
			</form>
		</Card>
	);
}
