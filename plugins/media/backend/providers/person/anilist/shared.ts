import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { DateTime, Effect } from "@ryot-app/plugin-backend-sdk/effect";
import {
	defineProvider,
	type ProviderDetailsRelatedEntity,
} from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { normalizeAnilistDescription } from "../../../lib/anilist-description";
import { mediaFailureMessage } from "../../../lib/error-message";
import { MediaSandboxError } from "../../../lib/failures";
import { numberValue, stringValue, type UnknownRecord } from "../../../lib/records";
import { createRoleAccumulator } from "../../../lib/role-accumulator";
import {
	anilistConnection,
	anilistGraphql,
	type AnilistHost,
	anilistRelatedPage,
	mediaScriptSlug,
	parseAnilistId,
	pickPreferredMediaName,
} from "../../../lib/vendors/anilist";

export const manifest = defineManifest({
	name: "Anilist",
	kind: "provider",
	slug: "person.anilist",
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
				const staffItems = asArray(pageData["staff"]);
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
    description(asHtml: true)
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

const staffInventory = (staffData: UnknownRecord, page: number) => {
	const staffMedia = anilistConnection(staffData["staffMedia"], "edges");
	const characterMedia = anilistConnection(staffData["characterMedia"], "edges");
	const related = createRoleAccumulator();
	const addMedia = (media: unknown, role: string, character: null | string = null) => {
		const record = asRecord(media);
		const idValue = numberValue(record?.["id"]);
		const providerSlug = mediaScriptSlug(record?.["type"]);
		if (
			!record ||
			idValue === null ||
			!Number.isSafeInteger(idValue) ||
			idValue <= 0 ||
			!providerSlug
		) {
			throw new MediaSandboxError({ message: "AniList staff inventory media edge is malformed" });
		}
		related.add({
			providerSlug,
			externalId: String(Math.trunc(idValue)),
			name: pickPreferredMediaName(record["title"]),
			relationshipProperties: { roles: [role], ...(character === null ? {} : { character }) },
		});
	};
	for (const edge of characterMedia.items) {
		const record = asRecord(edge);
		const names = asArray(record?.["characters"]).flatMap((character) => {
			const name = stringValue(asRecord(asRecord(character)?.["name"])?.["full"]);
			return name ? [name] : [];
		});
		for (const name of names.length ? names : [null]) {
			addMedia(record?.["node"], "Voicing", name);
		}
	}
	for (const edge of staffMedia.items) {
		const record = asRecord(edge);
		addMedia(record?.["node"], stringValue(record?.["staffRole"]) ?? "Production");
	}
	return {
		entities: related.entities,
		coverage:
			staffMedia.hasNextPage || characterMedia.hasNextPage
				? { status: "more" as const, continuation: { page: page + 1 } }
				: { status: "complete" as const },
	};
};

const mediaEntities = (entities: readonly ProviderDetailsRelatedEntity[], slug: string) =>
	entities.filter(
		(entity) =>
			entity.providerSlug === (slug === "person-to-anime" ? "anime.anilist" : "manga.anilist"),
	);

export const related = defineProvider({
	manifest,
	operation: "related",
	run: (input, host) => {
		if (
			input.direction !== "outgoing" ||
			!["person-to-anime", "person-to-manga"].includes(input.relationshipSchemaSlug)
		) {
			throw new Error("Unsupported AniList staff inventory");
		}
		const page = anilistRelatedPage(input.continuation);
		return getStaffPage(host, parseAnilistId(input.externalId, "staff"), page).pipe(
			Effect.flatMap((staff) =>
				Effect.try({
					try: () => staffInventory(staff, page),
					catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
				}).pipe(
					Effect.map((inventory) => ({
						coverage: inventory.coverage,
						entities: mediaEntities(inventory.entities, input.relationshipSchemaSlug),
					})),
				),
			),
		);
	},
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		const staffId = parseAnilistId(input.externalId, "staff");
		return getStaffPage(host, staffId, 1).pipe(
			Effect.flatMap((staffData) =>
				Effect.gen(function* () {
					const name = stringValue(asRecord(staffData["name"])?.["full"]);
					if (!name) {
						throw new Error("Anilist staff data is missing name");
					}

					const inventory = yield* Effect.try({
						try: () => staffInventory(staffData, 1),
						catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
					});
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
							images: image
								? [{ url: image, type: "remote" as const, purpose: "profile" as const }]
								: [],
							description: yield* normalizeAnilistDescription(
								staffData["description"],
								"https://anilist.co",
							),
						},
						relatedEntityGroups: [
							{
								coverage: inventory.coverage,
								direction: "outgoing" as const,
								synchronization: "additive" as const,
								relationshipSchemaSlug: "person-to-anime",
								entities: inventory.entities.filter(
									(entity) => entity.providerSlug === "anime.anilist",
								),
							},
							{
								coverage: inventory.coverage,
								direction: "outgoing" as const,
								synchronization: "additive" as const,
								relationshipSchemaSlug: "person-to-manga",
								entities: inventory.entities.filter(
									(entity) => entity.providerSlug === "manga.anilist",
								),
							},
						],
					};
				}),
			),
		);
	},
});
