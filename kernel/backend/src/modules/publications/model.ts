import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import type { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import type { JsonValue } from "@ryot-app/contract/schema/json";

import type { CapturedClientPageComposition } from "#modules/pages/preparation/composition";
import type { PublishedPage } from "#modules/pages/preparation/published-page";

export type PublicationSnapshot = {
	readonly result: RyotQLResponse;
	readonly document: RyotQLDocument;
	readonly page: null | PublishedPage;
	readonly composition: CapturedClientPageComposition;
	readonly settings: Readonly<Record<string, JsonValue>>;
	readonly arguments: Readonly<Record<string, JsonValue>>;
};

export const PUBLICATION_RESULT_BYTES = 2 * 1024 * 1024;
