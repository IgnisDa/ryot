import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";

export type PublishedPage = {
	readonly name: string;
	readonly pageId: string;
	readonly revision: number;
	readonly artifactHash: string;
	readonly definitionHash: string;
	readonly authorityRevision: number;
	readonly definition: PageDefinition;
};
