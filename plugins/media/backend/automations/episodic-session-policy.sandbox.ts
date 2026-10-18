import {
	type AutomationPolicyBatchInput,
	type AutomationPolicyInput,
	automationPolicyResultSchema,
	defineAutomationPolicy,
} from "@ryot-app/plugin-backend-sdk/automation";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import {
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	type EpisodeParentResolution,
	resolveEpisodeParentRecipe,
} from "../contracts/episode-parent-recipe";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "policy",
	name: "Media Episodic Session Policy",
	slug: "policy.media-episodic-session",
	inputProjection: { event: { properties: [] } },
});

type AutomationHost = Pick<ScriptHost, "executeRyotql">;

type EventPayload = Extract<AutomationPolicyInput["automation"]["payload"], { resource: "event" }>;

const sessionPolicyResult = (payload: EventPayload, resolution: null | EpisodeParentResolution) => {
	if (resolution === null) {
		return { action: "reject", reason: "episodic_parent_not_found" } as const;
	}
	return Schema.decodeSync(automationPolicyResultSchema)({
		action: "transform",
		patch: {
			resource: "event",
			draft: {
				sessionEntityId:
					resolution.kind === "show" && resolution.seasonNumber === 0
						? null
						: resolution.parentEntityId,
			},
		},
	});
};

const assignShowEpisodeSession = (host: AutomationHost, payload: EventPayload) =>
	executeRyotqlRecipe(
		host.executeRyotql,
		resolveEpisodeParentRecipe({
			reference: { kind: "self" },
			config: showEpisodicKindConfig,
			episodeEntityId: payload.draft.entityId,
		}),
	).pipe(Effect.map((resolution) => sessionPolicyResult(payload, resolution)));

const assignPodcastEpisodeSession = (host: AutomationHost, payload: EventPayload) =>
	executeRyotqlRecipe(
		host.executeRyotql,
		resolveEpisodeParentRecipe({
			reference: { kind: "self" },
			config: podcastEpisodicKindConfig,
			episodeEntityId: payload.draft.entityId,
		}),
	).pipe(Effect.map((resolution) => sessionPolicyResult(payload, resolution)));

const runItem = (input: AutomationPolicyInput, host: AutomationHost) => {
	const payload = input.automation.payload;
	if (payload.resource !== "event" || payload.operation !== "create") {
		return Effect.succeed({ action: "allow" } as const);
	}
	const draft = payload.draft;
	if (draft.entitySchemaSlug === "show" || draft.entitySchemaSlug === "podcast") {
		return Effect.succeed({
			action: "transform",
			patch: { resource: "event", draft: { sessionEntityId: draft.entityId } },
		} as const);
	}
	if (draft.entitySchemaSlug === "show-episode") {
		return assignShowEpisodeSession(host, payload);
	}
	if (draft.entitySchemaSlug === "podcast-episode") {
		return assignPodcastEpisodeSession(host, payload);
	}
	return Effect.succeed({ action: "allow" } as const);
};

export default defineAutomationPolicy({
	manifest,
	run: ({ items, automation }: AutomationPolicyBatchInput, host) =>
		Effect.forEach(items, ({ payload, itemIdentity }) =>
			Effect.gen(function* () {
				const decision = yield* runItem({ automation: { ...automation, payload } }, host);
				return { decision, itemIdentity };
			}),
		).pipe(Effect.map((decisions) => ({ items: decisions }))),
});
