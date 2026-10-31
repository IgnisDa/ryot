import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { ChipButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import { type MediaCollectionList, mediaCollectionsLabel } from "./summary-state";

const manageCollections = createRyotMutation<{ readonly entityId: string }, void>(
	({ input, client }) => client.screens.addToCollection(input).pipe(Effect.asVoid),
);

export function MediaCollectionsControl(props: {
	readonly entityId: string;
	readonly collections: MediaCollectionList;
}) {
	const mutation = useRyotMutation(manageCollections);
	const inAny = props.collections.items.length > 0;
	return (
		<>
			<ChipButton
				pressed={inAny}
				disabled={mutation.isPending}
				icon={<AppIcon size={13} name="layers-3" />}
				onClick={() => mutation.mutate({ entityId: props.entityId })}
			>
				{mediaCollectionsLabel(props.collections)}
			</ChipButton>
			{mutation.error === null ? null : (
				<span role="alert" className="text-xs text-danger">
					Unable to open collections. Try again.
				</span>
			)}
		</>
	);
}
