import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Option } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../../script-helpers/records";
import type { RoleRelatedEntity } from "../../../script-helpers/role-accumulator";
import { getIdentifier, loadMetronJson, type MetronHost } from "../../metron-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Metron",
	slug: "comic-book.metron",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["metronUsername", "metronPassword"],
	requiredSystemConfigKeys: [],
});

type SuggestionEntity = { name: string; externalId: string; providerSlug: string };

const formatIssueTitle = (seriesName: unknown, number: unknown) => {
	const resolvedSeriesName = stringValue(seriesName) ?? "Unknown Series";
	const resolvedNumber = stringValue(number);
	return resolvedNumber ? `${resolvedSeriesName} #${resolvedNumber}` : resolvedSeriesName;
};

const parsePublishYear = (value: unknown) => {
	const date = stringValue(value);
	if (!date) {
		return null;
	}
	const parsed = DateTime.make(date);
	if (Option.isNone(parsed)) {
		return null;
	}
	return DateTime.toDateUtc(parsed.value).getFullYear();
};

const parsePublishDate = (value: unknown) => {
	const date = stringValue(value);
	if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return null;
	}
	return date;
};

const buildPeople = (credits: unknown): RoleRelatedEntity[] => {
	if (!Array.isArray(credits)) {
		return [];
	}
	const relatedEntityByKey = new Map<string, RoleRelatedEntity>();
	const addRelatedEntity = (relatedEntity: RoleRelatedEntity) => {
		const key = `${relatedEntity.providerSlug}:${relatedEntity.externalId}`;
		const existing = relatedEntityByKey.get(key);
		if (!existing) {
			relatedEntityByKey.set(key, relatedEntity);
			return;
		}
		existing.relationshipProperties.roles = [
			...new Set([
				...existing.relationshipProperties.roles,
				...relatedEntity.relationshipProperties.roles,
			]),
		];
		if (existing.name === "Loading..." && relatedEntity.name !== "Loading...") {
			existing.name = relatedEntity.name;
		}
	};
	const seen = new Set<string>();
	for (const credit of credits) {
		const record = asRecord(credit);
		if (!record) {
			continue;
		}
		const externalId = getIdentifier(record["id"]);
		if (!externalId) {
			continue;
		}
		const name = stringValue(record["creator"]) ?? "Loading...";
		const roleList = record["role"];
		const roleNames = Array.isArray(roleList)
			? roleList.flatMap((role) => {
					const roleName = stringValue(asRecord(role)?.["name"]);
					return roleName ? [roleName] : [];
				})
			: [];
		const roles = roleNames.length > 0 ? roleNames : ["Contributor"];
		for (const role of roles) {
			const key = `${externalId}:${role}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			addRelatedEntity({
				name,
				externalId,
				providerSlug: "person.metron",
				relationshipProperties: { roles: [role] },
			});
		}
	}
	return [...relatedEntityByKey.values()];
};

const collectSuggestions = (host: MetronHost, sourceExternalId: string, arcs: unknown) => {
	const arcIds = (Array.isArray(arcs) ? arcs.slice(0, 3) : []).flatMap((arc) => {
		const arcId = getIdentifier(asRecord(arc)?.["id"]);
		return arcId ? [arcId] : [];
	});
	return Effect.all(
		arcIds.map((arcId) =>
			loadMetronJson(
				host,
				`https://metron.cloud/api/arc/${encodeURIComponent(arcId)}/issue_list/?page_size=20`,
				"Metron arc issue list request failed",
			),
		),
	).pipe(
		Effect.map((payloads) => {
			const suggestionByKey = new Map<string, SuggestionEntity>();
			for (const payload of payloads) {
				const results = asRecord(payload)?.["results"];
				for (const issue of Array.isArray(results) ? results : []) {
					const record = asRecord(issue);
					const externalId = getIdentifier(record?.["id"]);
					if (!externalId || externalId === sourceExternalId) {
						continue;
					}
					suggestionByKey.set(`comic-book.metron:${externalId}`, {
						externalId,
						providerSlug: "comic-book.metron",
						name: formatIssueTitle(asRecord(record?.["series"])?.["name"], record?.["number"]),
					});
				}
			}
			return [...suggestionByKey.values()];
		}),
	);
};

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const params = new URLSearchParams({
			series_name: input.query,
			page: String(input.page),
			page_size: String(input.pageSize),
		});
		return loadMetronJson(
			host,
			`https://metron.cloud/api/issue/?${params.toString()}`,
			"Metron issue search request failed",
		).pipe(
			Effect.map((payloadValue) => {
				const payload = asRecord(payloadValue);
				const count = numberValue(payload?.["count"]);
				const totalItems = count === null ? 0 : Math.max(0, Math.trunc(count));
				const results = payload?.["results"];
				const items = (Array.isArray(results) ? results : [])
					.flatMap((issue) => {
						const record = asRecord(issue);
						const externalId = getIdentifier(record?.["id"]);
						if (!externalId) {
							return [];
						}
						const image = stringValue(record?.["image"]);
						const title = formatIssueTitle(
							asRecord(record?.["series"])?.["name"],
							record?.["number"],
						);
						const publishYear = parsePublishYear(record?.["cover_date"]);
						return [
							{
								externalId,
								calloutProperty: { kind: "null" as const, value: null },
								titleProperty: { kind: "text" as const, value: title },
								secondarySubtitleProperty: { kind: "null" as const, value: null },
								primarySubtitleProperty:
									publishYear === null
										? { kind: "null" as const, value: null }
										: { kind: "number" as const, value: publishYear },
								imageProperty:
									image === null
										? { kind: "null" as const, value: null }
										: { kind: "image" as const, value: { type: "remote" as const, url: image } },
							},
						];
					})
					.slice(0, input.pageSize);
				return {
					items,
					details: {
						totalItems,
						nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
					},
				};
			}),
		);
	},
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			const payloadValue = yield* loadMetronJson(
				host,
				`https://metron.cloud/api/issue/${encodeURIComponent(input.externalId)}/`,
				"Metron issue details request failed",
			);
			const payload = asRecord(payloadValue) ?? {};
			const seriesRecord = asRecord(payload["series"]);
			const title = formatIssueTitle(seriesRecord?.["name"], payload["number"]);
			const pageCount = numberValue(payload["page_count"]);
			const image = stringValue(payload["image"]);
			const people = buildPeople(payload["credits"]);

			const groupRelatedEntities: RoleRelatedEntity[] = [];
			if (seriesRecord) {
				const seriesId = getIdentifier(seriesRecord["id"]);
				if (seriesId) {
					groupRelatedEntities.push({
						externalId: seriesId,
						providerSlug: "comic-book-group.metron",
						name: stringValue(seriesRecord["name"]) ?? "Loading...",
						relationshipProperties: { roles: ["Member"] },
					});
				}
			}

			const suggestions = yield* collectSuggestions(host, input.externalId, payload["arcs"]);
			return {
				name: title,
				relatedEntityGroups: [
					{
						entities: people,
						direction: "incoming" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "person-to-comic-book",
					},
					{
						direction: "incoming" as const,
						synchronization: "additive" as const,
						entities: groupRelatedEntities,
						relationshipSchemaSlug: "comic-book-group-to-comic-book",
					},
					{
						entities: suggestions,
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "media-suggestion",
					},
				],
				properties: {
					genres: [],
					description: stringValue(payload["desc"]),
					pages: pageCount === null ? null : Math.trunc(pageCount),
					publishDate: parsePublishDate(payload["cover_date"]),
					publishYear: parsePublishYear(payload["cover_date"]),
					sourceUrl: `https://metron.cloud/issue/${input.externalId}`,
					images: image ? [{ type: "remote" as const, url: image }] : [],
				},
			};
		}),
});
