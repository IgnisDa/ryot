import { emptySinkResult, createSinkFailure, type SinkParser } from "./shared";

export const parseGenericJsonSink: SinkParser = async () =>
	Promise.resolve({
		...emptySinkResult(),
		failures: [
			createSinkFailure({
				stage: "source_fetch",
				message: "Generic JSON integration is not implemented in V2 yet",
			}),
		],
	});
