import { TrackerSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";

export interface CreateTrackerOptions {
	icon?: string;
	name?: string;
	slug?: string;
	accentColor?: string;
	description?: string;
}

export const createTracker = (client: Client, options: CreateTrackerOptions = {}) =>
	Effect.gen(function* () {
		const {
			icon = "rocket",
			name = "Test Tracker",
			accentColor = "#FF5733",
			slug = `tracker-${crypto.randomUUID()}`,
			description = "Test tracker description",
		} = options;
		const tracker = {
			icon,
			name,
			slug,
			accentColor,
			description,
			sortOrder: (yield* client.call((c) => c.definitions.listTrackers({}))).length,
			entitySchemaSlugs: [],
		};
		yield* getBackendClient().call(
			(c) => c.testSupport.installDefinitions({ payload: { trackers: [tracker] } }),
			adminHeaders,
		);
		const trackerSlug = TrackerSlug.make(slug);
		const state = yield* client.call((c) =>
			c.trackers.updateState({
				path: { trackerSlug },
				payload: { config: { fixture: true }, sortOrder: tracker.sortOrder },
			}),
		);
		return {
			trackerSlug,
			tracker: {
				...state,
				id: trackerSlug,
			},
		};
	});

export const listTrackers = (client: Client, options: { includeDisabled?: boolean } = {}) =>
	client
		.call((c) =>
			c.trackers.list({ urlParams: { includeDisabled: options.includeDisabled ?? false } }),
		)
		.pipe(
			Effect.map((trackers) =>
				trackers.map((tracker) => ({ ...tracker, id: tracker.slug, isBuiltin: true })),
			),
		);

export const findBuiltinTracker = (client: Client) =>
	Effect.gen(function* () {
		const trackers = yield* listTrackers(client, { includeDisabled: true });
		const builtinTracker = trackers.find((tracker) => tracker.isBuiltin);
		return requirePresent(builtinTracker, "Built-in tracker not found");
	});

export const findBuiltinTrackerBySlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const trackers = yield* listTrackers(client, { includeDisabled: true });
		const tracker = trackers.find((entry) => entry.isBuiltin && entry.slug === slug);
		return requirePresent(tracker, `Built-in tracker '${slug}' not found`);
	});

export const disableTracker = (input: { trackerSlug: string; client: Client }) =>
	input.client.call((c) =>
		c.trackers.updateState({
			payload: { isDisabled: true },
			path: { trackerSlug: TrackerSlug.make(input.trackerSlug) },
		}),
	);
