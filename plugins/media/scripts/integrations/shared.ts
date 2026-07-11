import type { CoreSandboxHostMethodMap } from "@ryot/sandbox-sdk/core";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

const JsonProperties = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const ResolvedEntityRef = Schema.Struct({
	kind: Schema.Literal("resolved"),
	sourceLabel: Schema.String,
	externalId: Schema.NonEmptyString,
	providerSlug: Schema.NonEmptyString,
	entitySchemaSlug: Schema.NonEmptyString,
});
const UnresolvedEntityRef = Schema.Struct({
	kind: Schema.Literal("unresolved"),
	sourceLabel: Schema.String,
	identifierType: Schema.NonEmptyString,
	identifierValue: Schema.NonEmptyString,
	entitySchemaSlug: Schema.NonEmptyString,
});
export const EntityRef = Schema.Union(ResolvedEntityRef, UnresolvedEntityRef);
export type EntityRef = typeof EntityRef.Type;
const EpisodeLocator = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("show"),
		seasonNumber: Schema.Int.pipe(Schema.nonNegative()),
		episodeNumber: Schema.Int.pipe(Schema.nonNegative()),
	}),
	Schema.Struct({
		type: Schema.Literal("podcast"),
		episodeNumber: Schema.Int.pipe(Schema.nonNegative()),
	}),
);
const MediaEvent = Schema.Struct({
	occurredAt: Schema.String,
	properties: JsonProperties,
	eventSchemaSlug: Schema.String,
	episodeLocator: Schema.optional(EpisodeLocator),
});
const AdapterFailure = Schema.Struct({
	message: Schema.String,
	itemIndex: Schema.Number,
	stage: Schema.String,
	context: Schema.optional(JsonProperties),
	sourceLabel: Schema.optional(Schema.String),
	sourceIdentifier: Schema.optional(Schema.String),
});
export const AdapterResult = Schema.Struct({
	failures: Schema.Array(AdapterFailure),
	entityGroups: Schema.Array(
		Schema.Struct({
			entityRef: EntityRef,
			events: Schema.Array(MediaEvent),
			itemIndex: Schema.optional(Schema.Number),
			ownershipProvider: Schema.optional(Schema.String),
			collectionMemberships: Schema.Array(Schema.Struct({ collectionName: Schema.String })),
		}),
	),
});
export type AdapterResult = typeof AdapterResult.Type;
export const SinkInput = Schema.Struct({ rawBody: Schema.String, contentType: Schema.String });

export const emptyResult = (): AdapterResult => ({ failures: [], entityGroups: [] });
export const failureResult = (message: string, stage = "input_transformation"): AdapterResult => ({
	entityGroups: [],
	failures: [{ message, stage, itemIndex: 0 }],
});
export const sourceFailure = (input: {
	message: string;
	itemIndex: number;
	sourceLabel?: string | undefined;
	sourceIdentifier?: string | undefined;
}): AdapterResult["failures"][number] => ({
	stage: "source_fetch",
	message: input.message,
	itemIndex: input.itemIndex,
	...(input.sourceLabel === undefined ? {} : { sourceLabel: input.sourceLabel }),
	...(input.sourceIdentifier === undefined ? {} : { sourceIdentifier: input.sourceIdentifier }),
});
export const movieOrShowRef = (input: {
	sourceLabel: string;
	entitySchemaSlug: "movie" | "show";
	providerIds: { imdb?: string; tmdb?: string; tvdb?: string };
}): EntityRef | null => {
	const tmdb = input.providerIds.tmdb?.trim();
	if (tmdb) {
		return resolvedRef(input.entitySchemaSlug, "tmdb", tmdb, input.sourceLabel);
	}
	const imdb = input.providerIds.imdb?.trim();
	if (imdb) {
		return {
			kind: "unresolved",
			sourceLabel: input.sourceLabel,
			identifierType: "imdb",
			identifierValue: imdb,
			entitySchemaSlug: input.entitySchemaSlug,
		};
	}
	const tvdb = input.providerIds.tvdb?.trim();
	return tvdb ? resolvedRef(input.entitySchemaSlug, "tvdb", tvdb, input.sourceLabel) : null;
};
export const resolvedRef = (
	entitySchemaSlug: "movie" | "show",
	provider: "tmdb" | "tvdb",
	externalId: string,
	sourceLabel: string,
): EntityRef => ({
	kind: "resolved",
	externalId,
	sourceLabel,
	entitySchemaSlug,
	providerSlug: `${entitySchemaSlug}.${provider}`,
});
export const progressResult = (input: {
	entityRef: EntityRef;
	consumedOn: string;
	occurredAt?: string;
	progressPercent: number;
	episodeLocator?: typeof EpisodeLocator.Type;
}): AdapterResult => ({
	failures: [],
	entityGroups: [
		{
			itemIndex: 0,
			entityRef: input.entityRef,
			collectionMemberships: [],
			events: [
				{
					eventSchemaSlug: "progress",
					occurredAt: input.occurredAt ?? new Date().toISOString(),
					properties: { consumedOn: input.consumedOn, progressPercent: input.progressPercent },
					...(input.episodeLocator ? { episodeLocator: input.episodeLocator } : {}),
				},
			],
		},
	],
});
export const showLocator = (season?: number, episode?: number) => {
	if (season === undefined || episode === undefined) {
		return undefined;
	}
	return Number.isInteger(season) && Number.isInteger(episode) && season >= 0 && episode >= 0
		? ({ type: "show", seasonNumber: season, episodeNumber: episode } as const)
		: undefined;
};
export const progressPercent = (position?: number, duration?: number) => {
	if (
		position === undefined ||
		duration === undefined ||
		!Number.isFinite(position) ||
		duration <= 0
	) {
		return undefined;
	}
	return Math.max(0, Math.min(100, Math.round((position / duration) * 10_000) / 100));
};
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
export const jsonRecord = (value: string) => {
	const parsed: unknown = JSON.parse(value);
	if (!isRecord(parsed)) {
		throw new Error("Expected a JSON object");
	}
	return parsed;
};
const nested = (input: unknown, keys: string[]) => {
	const pending = [input];
	while (pending.length) {
		const current = pending.shift();
		if (!current || typeof current !== "object") {
			continue;
		}
		if (isRecord(current)) {
			for (const key of keys) {
				const value = current[key];
				if (value != null) {
					return value;
				}
			}
		}
		pending.push(...Object.values(current));
	}
	return undefined;
};
export const nestedString = (input: unknown, keys: string[]) => {
	const value = nested(input, keys);
	if (typeof value === "string") {
		return value.trim() || undefined;
	}
	if (typeof value === "number") {
		return String(value);
	}
	return undefined;
};
export const nestedNumber = (input: unknown, keys: string[]) => {
	const value = nested(input, keys);
	let number = Number.NaN;
	if (typeof value === "number") {
		number = value;
	}
	if (typeof value === "string") {
		number = Number.parseFloat(value);
	}
	return Number.isFinite(number) ? number : undefined;
};
export const specifics = (value: unknown) => (isRecord(value) ? value : null);
export const requestJson = (
	host: { readonly httpCall: CoreSandboxHostMethodMap["httpCall"] },
	method: string,
	url: string,
	options?: { body?: string; headers?: Record<string, string> },
) =>
	host.httpCall(method, url, options).pipe(
		Effect.flatMap((response) =>
			Effect.try(() => {
				const parsed: unknown = JSON.parse(response.body);
				return parsed;
			}),
		),
	);
export const baseUrl = (value: unknown) =>
	typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
