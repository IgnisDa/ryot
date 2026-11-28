import { collectionOrderStatements } from "./collection-order";
import { dataChangeStatements } from "./data-changes";
import { entityOccursAtStatements } from "./entity-occurs-at";
import { immutableRevisionStatements } from "./immutable-revisions";

export const postMigrationStatements = [
	...immutableRevisionStatements,
	...collectionOrderStatements,
	...entityOccursAtStatements,
	...dataChangeStatements,
];
