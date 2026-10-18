import { type RyotClient, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { usePluginScreenSurface } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotMutation,
	createRyotQuery,
	nextPageCursor,
	paginationItems,
	type RyotSubmission,
	useRyot,
	useRyotInfiniteQuery,
	useRyotSchedule,
	useRyotSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import {
	Button,
	Eyebrow,
	IconButton,
	ReorderableList,
	schemaSlugLabel,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	collectionMembersRecipe,
	type CollectionMembersResult,
} from "@ryot-app/ryotql-recipes/collections";
import clsx from "clsx";
import { useEffect, useState } from "react";

type Move = Omit<
	Parameters<RyotClient["collections"]["reorderMembership"]>[0],
	"submittedAt" | "idempotencyKey"
>;
const moveMutation = createRyotMutation(
	({ input, client }: { client: RyotClient; input: RyotSubmission<Move> }) =>
		client.collections.reorderMembership({
			...input.input,
			submittedAt: input.submittedAt,
			idempotencyKey: input.submissionId,
		}),
);

const jumps = [
	{ kind: "start", icon: "arrow-up-to-line" },
	{ kind: "end", icon: "arrow-down-to-line" },
] as const;

export const CollectionOrder = ({
	name,
	onClose,
	collectionId,
}: {
	readonly name: string;
	readonly onClose: () => void;
	readonly collectionId: string;
}) => {
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const { scrollRootRef } = usePluginScreenSurface();
	const [query] = useState(() =>
		createRyotQuery<null | string, CollectionMembersResult>(
			({ input, client }) =>
				client.data
					.query(
						collectionMembersRecipe({
							collectionId,
							membershipPropertiesSchema: null,
							...(input === null ? {} : { after: input }),
						}),
					)
					.pipe(
						Effect.filterOrFail(
							(page) => !page.stale,
							() => new RyotClientError("collection-stale"),
						),
					),
			{ cancelOnUnmount: true },
		),
	);
	const result = useRyotInfiniteQuery(query, undefined, {
		initialPageParam: null,
		getNextPageParam: nextPageCursor,
		getPageInput: (_input, cursor: null | string) => cursor,
	});
	const move = useRyotSubmission(moveMutation);
	const { refetch } = result;
	useEffect(() => {
		if (move.data !== undefined) {
			refetch();
		}
	}, [move.data, refetch]);
	const items = paginationItems(
		result.pages,
		(page) => page.items,
		(item) => item.entityId,
	);
	const busy =
		move.isPending ||
		move.status === "retained" ||
		result.isFetching ||
		result.isError ||
		(move.data !== undefined && (result.data?.orderRevision ?? -1) < move.data.orderRevision);
	const submit = (entityId: string, destination: Move["destination"]) => {
		if (busy || result.data === undefined) {
			return;
		}
		move.submit({
			entityId,
			destination,
			collectionId,
			expectedRevision: result.data.orderRevision,
		});
	};
	const feedback = (kind: "impact" | "selection") =>
		schedule.run(ryot.device({ kind, action: "haptic" }).pipe(Effect.ignore), () => {});
	const reload = () => {
		move.abandon();
		result.refetch();
	};
	return (
		<PluginScreenFrame
			title={`Reorder ${name}`}
			titleIcon={<AppIcon size={20} name="library" />}
			actions={
				<Button onClick={onClose} disabled={move.isPending}>
					Done
				</Button>
			}
		>
			<p className="text-sm text-text-muted">
				Drag the handle or use the arrow keys. Changes save automatically.
			</p>
			{move.error !== null && (
				<StatusMessage tone="error">
					{move.error instanceof RyotClientError && move.error.reason === "collection-stale"
						? "This collection changed. Reload before moving another item."
						: "The move could not be confirmed. Retry the same move or reload."}
					{move.error instanceof RyotClientError &&
						(move.error.reason === "transport" || move.error.reason === "malformed-result") && (
							<Button onClick={move.retry}>Retry move</Button>
						)}
					<Button onClick={reload}>Reload collection</Button>
				</StatusMessage>
			)}
			{result.isError && (
				<StatusMessage tone="error">
					The collection changed or could not be loaded.{" "}
					<Button onClick={reload}>Reload collection</Button>
				</StatusMessage>
			)}
			{result.isPending && <p role="status">Loading collection...</p>}
			{move.isPending && <p role="status">Saving order...</p>}
			<fieldset
				disabled={busy}
				className="m-0 min-w-0 overflow-hidden rounded-lg border border-border bg-raised p-0"
			>
				<legend className="sr-only">Collection order</legend>
				<ReorderableList
					items={items}
					itemHeight={60}
					label="Collection order"
					scrollRef={scrollRootRef}
					itemLabel={(item) => item.name}
					itemKey={(item) => item.entityId}
					onPickUp={() => feedback("impact")}
					onDrop={() => feedback("selection")}
					handleIcon={<AppIcon size={18} name="grip-vertical" />}
					onReorder={(from, to) => {
						const reordered = [...items];
						const [member] = reordered.splice(from, 1);
						if (member === undefined) {
							return;
						}
						reordered.splice(to, 0, member);
						const next = reordered[to + 1];
						const previous = reordered[to - 1];
						let destination: Move["destination"] = { kind: "start" };
						if (next !== undefined) {
							destination = { kind: "before", entityId: next.entityId };
						} else if (previous !== undefined) {
							destination = { kind: "after", entityId: previous.entityId };
						}
						submit(member.entityId, destination);
					}}
					renderItem={({ item, index, handle, isDragging }) => (
						<div
							className={clsx(
								"group flex h-15 items-center gap-2 border-b border-border bg-raised pr-2 pl-1 [li:last-child>&]:border-b-0",
								isDragging ? "rounded-md" : "hover:bg-hover",
							)}
						>
							{handle}
							<span className="w-7 shrink-0 text-right text-xs text-text-subtle tabular-nums">
								{index + 1}
							</span>
							<div className="grid min-w-0 flex-1 gap-0.5 pl-2">
								<span className="truncate text-sm font-medium text-text">{item.name}</span>
								<Eyebrow>{schemaSlugLabel(item.entitySchemaSlug)}</Eyebrow>
							</div>
							<div className="flex shrink-0 items-center gap-0.5 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
								{jumps.map(({ kind, icon }) => (
									<IconButton
										size="sm"
										key={kind}
										label={`Move ${item.name} to ${kind}`}
										onClick={() => {
											feedback("selection");
											submit(item.entityId, { kind });
										}}
									>
										<AppIcon size={16} name={icon} />
									</IconButton>
								))}
							</div>
						</div>
					)}
				/>
			</fieldset>
			{result.hasNextPage && (
				<Button disabled={busy} onClick={result.fetchNextPage}>
					{result.isFetchingNextPage ? "Loading more..." : "Load more"}
				</Button>
			)}
			{!result.isPending && items.length === 0 && !result.isError && (
				<p>This collection is empty.</p>
			)}
		</PluginScreenFrame>
	);
};
