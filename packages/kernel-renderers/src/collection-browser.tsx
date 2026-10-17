import { CollectionCardResults } from "./collection-card-results";
import EntityBrowserPage from "./entity-browser";
import type { BrowserResultsRenderer } from "./entity-browser-controller";

const renderCollectionResults: BrowserResultsRenderer = ({ items, layout, references }) => (
	<CollectionCardResults items={items} layout={layout} references={references} />
);

export default function CollectionBrowserPage() {
	return <EntityBrowserPage renderResults={renderCollectionResults} />;
}
