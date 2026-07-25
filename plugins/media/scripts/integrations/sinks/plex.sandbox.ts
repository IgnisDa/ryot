import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { resolvedMediaRef } from "../../../imports/source-helpers";
import {
	emptyResult,
	failureResult,
	jsonRecord,
	progressPercent,
	progressResult,
	showEpisodeRef,
	SinkInput,
	specifics,
	executionStartedAt,
} from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Plex sink",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "integration.plex-sink",
	capabilities: ["getCurrentIntegration"],
});

const multipartPayload = (rawBody: string, contentType: string) => {
	const boundary = contentType
		.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
		?.slice(1)
		.find(Boolean)
		?.trim();
	if (!contentType.toLowerCase().startsWith("multipart/form-data") || !boundary) {
		throw new Error("invalid multipart");
	}
	for (const section of rawBody.split(`--${boundary}`)) {
		const [headers, ...parts] = section.split(/\r?\n\r?\n/);
		if (headers?.includes('name="payload"')) {
			return parts
				.join("\n\n")
				.replace(/\r?\n--$/, "")
				.trim();
		}
	}
	throw new Error("missing payload");
};
const stringValue = (value: unknown) => {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number") {
		return String(value);
	}
	return undefined;
};

export default defineScript({
	manifest,
	input: SinkInput,
	output: MediaIntegrationAdapterResult,
	run: (input, host, execution) =>
		Effect.gen(function* () {
			const occurredAt = yield* executionStartedAt(execution);
			const integration = yield* host.getCurrentIntegration();
			return yield* Effect.try(() => {
				const payload = jsonRecord(multipartPayload(input.rawBody, input.contentType));
				const metadata = specifics(payload["Metadata"]);
				if (!metadata) {
					throw new Error("missing metadata");
				}
				const settings = specifics(integration.providerSpecifics);
				const username =
					typeof settings?.["username"] === "string" ? settings["username"].trim() : "";
				if (username && specifics(payload["Account"])?.["title"] !== username) {
					return emptyResult();
				}
				const event = (stringValue(payload["event"]) ?? "").toLowerCase().replace(/^media\./, "");
				if (!["play", "pause", "resume", "scrobble", "stop"].includes(event)) {
					return emptyResult();
				}
				let lot: "movie" | "show" | null = null;
				if (metadata["type"] === "episode" || metadata["librarySectionType"] === "show") {
					lot = "show";
				}
				if (metadata["type"] === "movie" || metadata["librarySectionType"] === "movie") {
					lot = "movie";
				}
				if (!lot) {
					return failureResult("Plex webhook payload has an unsupported media type");
				}
				const percent =
					progressPercent(Number(metadata["viewOffset"]), Number(metadata["duration"])) ??
					(event === "scrobble" ? 100 : undefined);
				if (percent === undefined) {
					return failureResult("Plex webhook payload is missing playback timing data");
				}
				const guid = Array.isArray(metadata["Guid"])
					? metadata["Guid"]
							.map((value) => (typeof value === "string" ? value : specifics(value)?.["id"]))
							.find(
								(value): value is string =>
									typeof value === "string" && /^tmdb:\/\/\d+/i.test(value),
							)
					: undefined;
				const id = guid?.match(/^tmdb:\/\/(\d+)/i)?.[1] ?? stringValue(metadata["Provider_tmdb"]);
				if (!id) {
					return failureResult("Plex webhook payload is missing a TMDB identifier");
				}
				const label =
					(lot === "show" ? stringValue(metadata["grandparentTitle"]) : undefined) ??
					stringValue(metadata["title"]) ??
					id;
				const locator =
					lot === "show"
						? showEpisodeRef(Number(metadata["parentIndex"]), Number(metadata["index"]))
						: undefined;
				if (lot === "show" && !locator) {
					return failureResult("Plex webhook payload is missing show episode coordinates");
				}
				return progressResult({
					occurredAt,
					consumedOn: "plex_sink",
					progressPercent: percent,
					...(locator ? { unresolvedEpisode: locator } : {}),
					entityRef: resolvedMediaRef(lot, "tmdb", id, label),
				});
			}).pipe(Effect.orElseSucceed(() => failureResult("Could not parse Plex webhook payload")));
		}),
});
