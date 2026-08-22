import { defineAutomationPolicy } from "@ryot-app/sandbox-sdk/automation";
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import { showEpisodicKindConfig } from "../../shared/lifecycle-expressions";
import {
	podcastEpisodicKindConfig,
	resolveEpisodeParentRecipe,
	type EpisodeParentResolution,
} from "../contracts/lifecycle-recipes";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["executeRyotql"],
	name: "Media Episodic Session Policy",
	slug: "policy.media-episodic-session",
});

type AutomationHost = SandboxHost<typeof manifest.capabilities>;

const sessionPolicyResult = (resolution: EpisodeParentResolution | null) => {
	if (resolution === null) {
		return { action: "skip", reason: "episodic_parent_not_found" } as const;
	}
	return {
		action: "replace",
		body: {
			sessionEntityId:
				resolution.kind === "show" && resolution.seasonNumber === 0
					? null
					: resolution.parentEntityId,
		},
	} as const;
};

const assignShowEpisodeSession = (host: AutomationHost, episodeEntityId: string) =>
	executeRyotqlRecipe(
		host.executeRyotql,
		resolveEpisodeParentRecipe({ config: showEpisodicKindConfig, episodeEntityId }),
	).pipe(Effect.map(sessionPolicyResult));

const assignPodcastEpisodeSession = (host: AutomationHost, episodeEntityId: string) =>
	executeRyotqlRecipe(
		host.executeRyotql,
		resolveEpisodeParentRecipe({ config: podcastEpisodicKindConfig, episodeEntityId }),
	).pipe(Effect.map(sessionPolicyResult));

export default defineAutomationPolicy({
	manifest,
	run: ({ automation }, host) => {
		const draft = automation.source.draft;
		if (draft.entitySchemaSlug === "show" || draft.entitySchemaSlug === "podcast") {
			return Effect.succeed({
				action: "replace",
				body: { sessionEntityId: draft.entityId },
			} as const);
		}
		if (draft.entitySchemaSlug === "show-episode") {
			return assignShowEpisodeSession(host, draft.entityId);
		}
		if (draft.entitySchemaSlug === "podcast-episode") {
			return assignPodcastEpisodeSession(host, draft.entityId);
		}
		return Effect.succeed({ action: "allow" } as const);
	},
});
