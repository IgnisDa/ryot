import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, jsonValueSchema } from "../wire";

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The host wire validates JSON; RyotQL validates the document.
export const ryotqlDocumentSchema = jsonValueSchema as unknown as Schema.Codec<
	RyotQLDocument,
	typeof jsonValueSchema.Encoded
>;
export const executeRyotqlDataSchema = Schema.Unknown;
export const executeRyotqlArgsSchema = Schema.Tuple([ryotqlDocumentSchema]);
export const executeRyotqlResultSchema = hostResultSchema(executeRyotqlDataSchema);
