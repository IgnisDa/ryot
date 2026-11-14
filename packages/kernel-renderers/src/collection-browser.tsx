import { useHostScreen, useRyot } from "@ryot-app/plugin-client-sdk/react";

import { CollectionCardResults } from "./collection-card-results";
import EntityBrowserPage, { type EntityBrowserResultsRenderer } from "./entity-browser";

const renderCollectionResults: EntityBrowserResultsRenderer = ({ items, layout, selection }) =>
	layout === "table" ? undefined : (
		<CollectionCardResults items={items} layout={layout} selection={selection} />
	);

export default function CollectionBrowserPage() {
	const ryot = useRyot();
	const openScreen = useHostScreen();
	const newCollection = () =>
		openScreen(ryot.screens.editCollection({}), (outcome) => {
			if (outcome.kind === "saved") {
				ryot.navigation.push({ kind: "entity", entityId: outcome.collectionId });
			}
		});
	return (
		<EntityBrowserPage
			shareable={false}
			renderResults={renderCollectionResults}
			add={{ open: newCollection, searchesOnline: false, label: "New collection" }}
		/>
	);
}
