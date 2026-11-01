import { useRyot } from "@ryot-app/plugin-client-sdk/react";

import { CollectionCardResults } from "./collection-card-results";
import EntityBrowserPage from "./entity-browser";
import type { BrowserResultsRenderer } from "./entity-browser-controller";
import { useHostScreen } from "./host-screen";

const renderCollectionResults: BrowserResultsRenderer = ({ items, layout, references }) => (
	<CollectionCardResults items={items} layout={layout} references={references} />
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
			renderResults={renderCollectionResults}
			add={{ open: newCollection, label: "New collection" }}
		/>
	);
}
