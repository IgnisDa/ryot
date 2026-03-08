import { PluginSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";

export const createPluginScope = (slug = `plugin-${crypto.randomUUID()}`) => PluginSlug.make(slug);

export const listPluginWorkspaces = (client: Client, options: { includeDisabled?: boolean } = {}) =>
	client.call((c) =>
		c.definitions.listWorkspaces({
			query: { includeDisabled: options.includeDisabled ?? false },
		}),
	);

export const findBuiltinWorkspace = (client: Client) =>
	Effect.gen(function* () {
		const workspaces = yield* listPluginWorkspaces(client, { includeDisabled: true });
		return requirePresent(workspaces[0], "Built-in plugin workspace not found");
	});

export const findBuiltinWorkspaceBySlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const workspaces = yield* listPluginWorkspaces(client, { includeDisabled: true });
		const workspace = workspaces.find((entry) => entry.slug === slug);
		return requirePresent(workspace, `Built-in plugin workspace '${slug}' not found`);
	});

export const updatePluginWorkspaceState = (
	client: Client,
	pluginSlug: string,
	payload: { config?: Record<string, unknown>; isDisabled?: boolean; sortOrder?: number },
) =>
	client.call((c) =>
		c.definitions.updateWorkspaceState({
			payload,
			params: { pluginSlug: PluginSlug.make(pluginSlug) },
		}),
	);
