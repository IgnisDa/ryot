import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";

import { CollectionCardResults } from "./collection-card-results";
import EntityBrowserPage from "./entity-browser";
import type { BrowserResultsRenderer } from "./entity-browser-controller";

const renderCollectionResults: BrowserResultsRenderer = ({ items, layout, references }) => (
	<CollectionCardResults items={items} layout={layout} references={references} />
);

export default function CollectionBrowserPage() {
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const newCollection = () =>
		schedule.run(
			ryot.screens.editCollection({}).pipe(
				Effect.tap((outcome) =>
					Effect.sync(() => {
						if (outcome.kind === "saved") {
							ryot.navigation.push({ kind: "entity", entityId: outcome.collectionId });
						}
					}),
				),
				Effect.ignore,
			),
			() => undefined,
		);
	return (
		<EntityBrowserPage
			renderResults={renderCollectionResults}
			add={{ open: newCollection, label: "New collection" }}
		/>
	);
}
