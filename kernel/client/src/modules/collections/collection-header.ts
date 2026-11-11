import type { EntityId } from "@ryot-app/contract/schema/brands";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	collectionHeaderRecipe,
	type CollectionHeaderResult,
} from "@ryot-app/ryotql-recipes/collections";

export const collectionHeaderQuery = createRyotQuery<EntityId, CollectionHeaderResult>(
	({ input, client }) => client.data.query(collectionHeaderRecipe, { collectionId: input }),
);
