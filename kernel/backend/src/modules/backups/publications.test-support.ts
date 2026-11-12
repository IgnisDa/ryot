import {
	encodeEntitySourceReference,
	EntitySourceReference,
} from "@ryot-app/contract/modules/ryotql/entity-source";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import { buildDefinitionSnapshot } from "@ryot-app/definitions/snapshot";
import { Result, Schema } from "effect";

import { kernelPublicationDocument } from "./publications";

export const publicationDocument = kernelPublicationDocument(
	buildDefinitionSnapshot(kernelDefinitionSource()),
) ?? { queries: {} };
export const publicationDefinition = (source: unknown) => ({
	mode: "live" as const,
	page: { kind: "kernel" as const, name: "publication" as const },
	arguments: {
		source: encodeEntitySourceReference(
			Result.getOrThrow(Schema.decodeUnknownResult(EntitySourceReference)(source)),
		),
	},
});
export const publicationFields = (source: unknown) => ({
	snapshot: null,
	document: publicationDocument,
	definition: publicationDefinition(source),
});
