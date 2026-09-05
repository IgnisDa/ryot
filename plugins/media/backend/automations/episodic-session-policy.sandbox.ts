import {
	defineAutomationPolicy,
	automationPolicyResultSchema,
	type AutomationPolicyInput,
} from "@ryot-app/sandbox-sdk/automation";
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import {
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	resolveEpisodeParentRecipe,
	type EpisodeParentResolution,
} from "../contracts/lifecycle-recipes";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "policy",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["executeRyotql"],
	name: "Media Episodic Session Policy",
	slug: "policy.media-episodic-session",
	inputProjection: { event: { properties: [] } },
});

type AutomationHost = SandboxHost<typeof manifest.capabilities>;

type EventPayload = Extract<AutomationPolicyInput["automation"]["payload"], { resource: "event" }>;

const sessionPolicyResult = (payload: EventPayload, resolution: EpisodeParentResolution | null) => {
	if (resolution === null) {
		return { action: "reject", reason: "episodic_parent_not_found" } as const;
	}
	return Schema.decodeUnknownSync(automationPolicyResultSchema)({
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
			config: showEpisodicKindConfig,
			episodeEntityId: payload.draft.entityId,
		}),
	).pipe(Effect.map((resolution) => sessionPolicyResult(payload, resolution)));

const assignPodcastEpisodeSession = (host: AutomationHost, payload: EventPayload) =>
	executeRyotqlRecipe(
		host.executeRyotql,
		resolveEpisodeParentRecipe({
			config: podcastEpisodicKindConfig,
			episodeEntityId: payload.draft.entityId,
		}),
	).pipe(Effect.map((resolution) => sessionPolicyResult(payload, resolution)));

export default defineAutomationPolicy({
	manifest,
	run: ({ automation }, host) => {
		const payload = automation.payload;
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
	},
});
