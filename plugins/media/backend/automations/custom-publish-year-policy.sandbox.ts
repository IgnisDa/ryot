import {
	type AutomationPolicyBatchInput,
	type AutomationPolicyInput,
	defineAutomationPolicy,
} from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { builtinMediaEntitySchemaSlugs } from "../../shared/media-schema-slugs";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "policy",
	name: "Custom Media Publish Year Policy",
	slug: "policy.media-custom-publish-year",
	inputProjection: { entity: { properties: ["publishDate", "publishYear"] } },
});

const decide = (payload: AutomationPolicyInput["automation"]["payload"]) => {
	if (
		payload.resource !== "entity" ||
		payload.operation === "delete" ||
		payload.draft.providerId !== null ||
		!builtinMediaEntitySchemaSlugs.some((slug) => slug === payload.draft.entitySchemaSlug)
	) {
		return { action: "allow" } as const;
	}
	const { publishDate, publishYear } = payload.draft.properties;
	if (
		publishYear != null ||
		typeof publishDate !== "string" ||
		!/^\d{4}-\d{2}-\d{2}$/.test(publishDate)
	) {
		return { action: "allow" } as const;
	}
	const date = new Date(`${publishDate}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== publishDate) {
		return { action: "allow" } as const;
	}
	return {
		action: "transform",
		patch: {
			resource: "entity",
			draft: { properties: { remove: [], set: { publishYear: date.getUTCFullYear() } } },
		},
	} as const;
};

export default defineAutomationPolicy({
	manifest,
	run: ({ items }: AutomationPolicyBatchInput) =>
		Effect.succeed({
			items: items.map(({ payload, itemIdentity }) => ({
				itemIdentity,
				decision: decide(payload),
			})),
		}),
});
