import { Effect } from "effect";

import { processMediaImport } from "../../media/import-processor";
import {
	getOptionalSourcePayloadBoolean,
	getOptionalSourcePayloadString,
	getRequiredSourcePayloadString,
} from "../shared/source-payload";
import { adaptJellyfinData } from "./adapter";

export const processJellyfinImport = (input: {
	runId: string;
	userId: string;
	sourcePayload?: Record<string, unknown>;
}) =>
	processMediaImport({
		runId: input.runId,
		userId: input.userId,
		sourceName: "Jellyfin",
		adapterErrorFallback: "Failed to fetch data from Jellyfin",
		loadAdapterResult: Effect.gen(function* () {
			const apiUrl = getRequiredSourcePayloadString(input.sourcePayload, "apiUrl");
			const username = getRequiredSourcePayloadString(input.sourcePayload, "username");
			const password = getOptionalSourcePayloadString(input.sourcePayload, "password");
			const allowInsecureConnections = getOptionalSourcePayloadBoolean(
				input.sourcePayload,
				"allowInsecureConnections",
			);
			if (!apiUrl || !username) {
				return yield* Effect.fail("Import job is missing Jellyfin connection details");
			}
			return yield* adaptJellyfinData({ apiUrl, username, password, allowInsecureConnections });
		}),
	});
