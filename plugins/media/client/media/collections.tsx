import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Button, Row } from "@ryot-app/plugin-ui-sdk";

import { type MediaCollectionList, mediaCollectionsLabel } from "./summary-state";

const manageCollections = createRyotMutation<{ readonly entityId: string }, void>(
	({ input, client }) => client.screens.addToCollection(input).pipe(Effect.asVoid),
);

export function MediaCollectionsRow(props: {
	readonly entityId: string;
	readonly collections: MediaCollectionList;
}) {
	const mutation = useRyotMutation(manageCollections);
	return (
		<Row
			title="Collections"
			trailing={
				<Button
					size="sm"
					variant="ghost"
					disabled={mutation.isPending}
					onClick={() => mutation.mutate({ entityId: props.entityId })}
				>
					Manage
				</Button>
			}
			description={
				<>
					{mediaCollectionsLabel(props.collections)}
					{mutation.error === null ? null : (
						<span role="alert" className="block">
							Unable to open collections. Try again.
						</span>
					)}
				</>
			}
		/>
	);
}
