import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { cleanHtmlDescription } from "../../../lib/clean-html-description";
import { type UnknownRecord, asRecord, numberValue, stringValue } from "../../../lib/records";
import type { RoleRelatedEntity } from "../../../lib/role-accumulator";
import {
	anilistGraphql,
	mediaScriptSlug,
	parseAnilistId,
	pickPreferredMediaName,
	type AnilistHost,
} from "../../../lib/vendors/anilist";

export const manifest = defineManifest({
	name: "Anilist",
	kind: "provider",
	slug: "person.anilist",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

const STAFF_SEARCH_QUERY = `
query StaffSearchQuery($search: String!, $page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total }
    staff(search: $search) {
      id
      name { full }
      image { medium }
      dateOfBirth { year }
    }
  }
}
`;

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		anilistGraphql(host, "person search", STAFF_SEARCH_QUERY, {
			page: input.page,
			search: input.query,
			perPage: input.pageSize,
		}).pipe(
			Effect.map((data) => {
				const pageData = asRecord(data?.["Page"]);
				if (!pageData) {
					throw new Error("Anilist returned invalid response structure");
				}
				const totalValue = numberValue(asRecord(pageData["pageInfo"])?.["total"]);
				const totalItems = totalValue === null ? 0 : Math.max(0, Math.trunc(totalValue));
				const staffItems = Array.isArray(pageData["staff"]) ? pageData["staff"] : [];
				const items = staffItems.flatMap((item) => {
					const staff = asRecord(item);
					if (!staff) {
						return [];
					}
					const idValue = numberValue(staff["id"]);
					const staffId = idValue === null ? null : Math.trunc(idValue);
					if (staffId === null || staffId <= 0) {
						return [];
					}
					const name = stringValue(asRecord(staff["name"])?.["full"]);
					if (!name) {
						return [];
					}
					const image = stringValue(asRecord(staff["image"])?.["medium"]);
					const birthYearValue = numberValue(asRecord(staff["dateOfBirth"])?.["year"]);
					const birthYear = birthYearValue === null ? null : Math.trunc(birthYearValue);
					return [
						{
							title: name,
							externalId: String(staffId),
							...(image === null ? {} : { imageUrl: image }),
							...(birthYear === null ? {} : { metadata: [birthYear] as const }),
						},
					];
				});
				return {
					items,
					details: {
						totalItems,
						nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
					},
				};
			}),
		),
});

const STAFF_DETAILS_QUERY = `
query StaffQuery($id: Int!, $page: Int!) {
  Staff(id: $id) {
    id
    name { full }
    image { large }
    gender
    description
    homeTown
    dateOfBirth { day year month }
    dateOfDeath { day year month }
    characterMedia(page: $page, perPage: 25) {
      pageInfo { hasNextPage }
      edges {
        characters { name { full } }
        node { id type title { userPreferred english romaji native } }
      }
    }
    staffMedia(page: $page, perPage: 25) {
      pageInfo { hasNextPage }
      edges {
        staffRole
        node { id type title { userPreferred english romaji native } }
      }
    }
  }
}
`;

const formatFuzzyDate = (value: unknown) => {
	const record = asRecord(value);
	if (!record) {
		return null;
	}
	const dayValue = numberValue(record["day"]);
	const yearValue = numberValue(record["year"]);
	const monthValue = numberValue(record["month"]);
	if (yearValue === null || monthValue === null || dayValue === null) {
		return null;
	}
	const dt = DateTime.fromDateUnsafe(
		new Date(Date.UTC(Math.trunc(yearValue), Math.trunc(monthValue) - 1, Math.trunc(dayValue))),
	);
	return DateTime.formatIsoDateUtc(dt);
};

type StaffPages = { staffData: UnknownRecord; staffEdges: unknown[]; characterEdges: unknown[] };

const getStaffPage = (host: AnilistHost, staffId: number, page: number) =>
	anilistGraphql(host, "person details", STAFF_DETAILS_QUERY, { page, id: staffId }).pipe(
		Effect.map((data) => {
			const staff = asRecord(data?.["Staff"]);
			if (!staff) {
				throw new Error("Anilist returned no staff data");
			}
			return staff;
		}),
	);

const collectStaffPages = (
	host: AnilistHost,
	staffId: number,
	page: number,
	collected: Omit<StaffPages, "staffData"> & { staffData: UnknownRecord | null },
): Effect.Effect<StaffPages, unknown> =>
	getStaffPage(host, staffId, page).pipe(
		Effect.flatMap((staffPage) => {
			const staffData = collected.staffData ?? staffPage;
			const staffMedia = asRecord(staffPage["staffMedia"]);
			const characterMedia = asRecord(staffPage["characterMedia"]);
			const pageStaffEdges = staffMedia?.["edges"];
			const pageCharacterEdges = characterMedia?.["edges"];
			collected.staffEdges.push(...(Array.isArray(pageStaffEdges) ? pageStaffEdges : []));
			collected.characterEdges.push(
				...(Array.isArray(pageCharacterEdges) ? pageCharacterEdges : []),
			);
			const hasNextPage =
				asRecord(characterMedia?.["pageInfo"])?.["hasNextPage"] === true ||
				asRecord(staffMedia?.["pageInfo"])?.["hasNextPage"] === true;
			if (hasNextPage) {
				return collectStaffPages(host, staffId, page + 1, { ...collected, staffData });
			}
			return Effect.succeed({
				staffData,
				staffEdges: collected.staffEdges,
				characterEdges: collected.characterEdges,
			});
		}),
	);

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		const staffId = parseAnilistId(input.externalId, "staff");
		return collectStaffPages(host, staffId, 1, {
			staffEdges: [],
			staffData: null,
			characterEdges: [],
		}).pipe(
			Effect.map(({ staffData, staffEdges, characterEdges }) => {
				const name = stringValue(asRecord(staffData["name"])?.["full"]);
				if (!name) {
					throw new Error("Anilist staff data is missing name");
				}

				const relatedByKey = new Map<string, RoleRelatedEntity>();
				const addMedia = (media: unknown, role: string) => {
					const record = asRecord(media);
					if (!record) {
						return;
					}
					const idValue = numberValue(record["id"]);
					const providerSlug = mediaScriptSlug(record["type"]);
					if (idValue === null || !providerSlug) {
						return;
					}
					const externalId = String(Math.trunc(idValue));
					const key = `${providerSlug}:${externalId}`;
					const existing = relatedByKey.get(key);
					if (existing) {
						if (!existing.relationshipProperties.roles.includes(role)) {
							existing.relationshipProperties.roles.push(role);
						}
						return;
					}
					relatedByKey.set(key, {
						externalId,
						providerSlug,
						relationshipProperties: { roles: [role] },
						name: pickPreferredMediaName(record["title"]),
					});
				};

				for (const edge of characterEdges) {
					const record = asRecord(edge);
					const characters = record?.["characters"];
					const characterNames = (Array.isArray(characters) ? characters : []).flatMap(
						(character) => {
							const characterName = stringValue(asRecord(asRecord(character)?.["name"])?.["full"]);
							return characterName ? [characterName] : [];
						},
					);
					for (const characterName of characterNames.length > 0 ? characterNames : [null]) {
						addMedia(record?.["node"], characterName ? `Voicing (${characterName})` : "Voicing");
					}
				}
				for (const edge of staffEdges) {
					const record = asRecord(edge);
					addMedia(record?.["node"], stringValue(record?.["staffRole"]) ?? "Production");
				}
				const relatedEntities = [...relatedByKey.values()];
				const image = stringValue(asRecord(staffData["image"])?.["large"]);

				return {
					name,
					properties: {
						alternateNames: [],
						gender: stringValue(staffData["gender"]),
						birthPlace: stringValue(staffData["homeTown"]),
						sourceUrl: `https://anilist.co/staff/${staffId}`,
						birthDate: formatFuzzyDate(staffData["dateOfBirth"]),
						deathDate: formatFuzzyDate(staffData["dateOfDeath"]),
						description: cleanHtmlDescription(staffData["description"]),
						images: image
							? [{ url: image, type: "remote" as const, purpose: "profile" as const }]
							: [],
					},
					relatedEntityGroups: [
						{
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "person-to-anime",
							entities: relatedEntities.filter((entity) => entity.providerSlug === "anime.anilist"),
						},
						{
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "person-to-manga",
							entities: relatedEntities.filter((entity) => entity.providerSlug === "manga.anilist"),
						},
					],
				};
			}),
		);
	},
});
