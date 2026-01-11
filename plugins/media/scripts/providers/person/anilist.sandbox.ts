import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { cleanHtmlDescription } from "../../script-helpers/clean-html-description";
import {
	type UnknownRecord,
	asRecord,
	numberValue,
	stringValue,
} from "../../script-helpers/records";
import type { RoleRelatedEntity } from "../../script-helpers/role-accumulator";
import {
	anilistGraphql,
	mediaScriptSlug,
	parseAnilistId,
	pickPreferredMediaName,
	type AnilistHost,
} from "../anilist-shared";

export const manifest = defineManifest({
	name: "Anilist",
	kind: "provider",
	slug: "person.anilist",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
	providerInformation: { source: "anilist" },
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

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	anilistGraphql(host, "person search", STAFF_SEARCH_QUERY, {
		search: input.query,
		page: input.page,
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
						externalId: String(staffId),
						titleProperty: { kind: "text" as const, value: name },
						calloutProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						primarySubtitleProperty:
							birthYear === null
								? { kind: "null" as const, value: null }
								: { kind: "number" as const, value: birthYear },
						imageProperty:
							image === null
								? { kind: "null" as const, value: null }
								: { kind: "image" as const, value: { type: "remote" as const, url: image } },
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
);

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
	const dt = DateTime.unsafeFromDate(
		new Date(Date.UTC(Math.trunc(yearValue), Math.trunc(monthValue) - 1, Math.trunc(dayValue))),
	);
	return DateTime.formatIsoDateUtc(dt);
};

type StaffPages = {
	staffData: UnknownRecord;
	staffEdges: unknown[];
	characterEdges: unknown[];
};

const getStaffPage = (host: AnilistHost, staffId: number, page: number) =>
	anilistGraphql(host, "person details", STAFF_DETAILS_QUERY, { id: staffId, page }).pipe(
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

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	const staffId = parseAnilistId(input.externalId, "staff");
	return collectStaffPages(host, staffId, 1, {
		staffData: null,
		staffEdges: [],
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
				const scriptSlug = mediaScriptSlug(record["type"]);
				if (idValue === null || !scriptSlug) {
					return;
				}
				const externalId = String(Math.trunc(idValue));
				const key = `${scriptSlug}:${externalId}`;
				const existing = relatedByKey.get(key);
				if (existing) {
					if (!existing.relationshipProperties.roles.includes(role)) {
						existing.relationshipProperties.roles.push(role);
					}
					return;
				}
				relatedByKey.set(key, {
					scriptSlug,
					externalId,
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
				relatedEntityGroups: [
					{
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "person-to-anime",
						entities: relatedEntities.filter((entity) => entity.scriptSlug === "anime.anilist"),
					},
					{
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "person-to-manga",
						entities: relatedEntities.filter((entity) => entity.scriptSlug === "manga.anilist"),
					},
				],
				properties: {
					alternateNames: [],
					gender: stringValue(staffData["gender"]),
					sourceUrl: `https://anilist.co/staff/${staffId}`,
					birthPlace: stringValue(staffData["homeTown"]),
					birthDate: formatFuzzyDate(staffData["dateOfBirth"]),
					deathDate: formatFuzzyDate(staffData["dateOfDeath"]),
					images: image ? [{ type: "remote" as const, url: image }] : [],
					description: cleanHtmlDescription(staffData["description"]),
				},
			};
		}),
	);
});

export default defineProvider({ manifest, drivers: { search, details } });
