import type { CreditRoleCode } from "@ryot-app/media-plugin/shared/credit-roles";

import { quoteSqlString } from "./shared";

/**
 * V1 role names, compared trimmed and lowercased, for roles V2 media stores as role codes. Other
 * V1 roles stay provider-named text.
 */
const legacyCreditRoleCodes: Readonly<Record<string, CreditRoleCode>> = {
	actor: "actor",
	acting: "actor",
	author: "author",
	artist: "artist",
	studio: "studio",
	creator: "creator",
	porting: "porting",
	network: "network",
	narrator: "narrator",
	voicing: "voice_actor",
	developer: "developer",
	publisher: "publisher",
	publishing: "publisher",
	development: "developer",
	supporting: "supporting",
	distributor: "distributor",
	distribution: "distributor",
	"voice actor": "voice_actor",
	"special effects": "special_effects",
	"production company": "production_company",
};

/** `(role, code)` rows of the mapping, for a `VALUES` list. */
export const legacyCreditRoleValuesSql = Object.entries(legacyCreditRoleCodes)
	.map(([role, code]) => `(${quoteSqlString(role)}, ${quoteSqlString(code)})`)
	.join(", ");

/** The SQL key a V1 role text expression is matched on. */
export const legacyCreditRoleKeySql = (role: string) => `lower(btrim(${role}))`;

/** V1 free creators as V2 unlinked creators, with mapped roles moved to `roleCode`. */
export const buildLegacyUnlinkedCreatorsSql = (freeCreators: string) => `(
	SELECT COALESCE(
		jsonb_agg(
			CASE
				WHEN legacy_role.code IS NULL THEN creator.value
				ELSE (creator.value - 'role') || jsonb_build_object('roleCode', legacy_role.code)
			END
			ORDER BY creator.ordinality
		),
		'[]'::jsonb
	)
	FROM jsonb_array_elements(COALESCE(${freeCreators}, '[]'::jsonb))
		WITH ORDINALITY AS creator(value, ordinality)
	LEFT JOIN (VALUES ${legacyCreditRoleValuesSql}) AS legacy_role(role, code)
		ON legacy_role.role = ${legacyCreditRoleKeySql("creator.value ->> 'role'")}
)`;
