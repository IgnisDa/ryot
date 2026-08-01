import type { RowItem, RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import { mapNavigationState } from "./navigation-state";

const rows = (items: readonly RowItem[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { page: 1, limit: 100, total: items.length, hasMore: false },
});
const workspace = (slug: string, isDisabled = false) => ({
	slug: { kind: "text" as const, value: slug },
	isDisabled: { kind: "boolean" as const, value: isDisabled },
	sortOrder: { kind: "number" as const, value: slug === "media" ? 1 : 2 },
	name: { kind: "text" as const, value: slug === "media" ? "Media" : "Fitness" },
	icon: { kind: "text" as const, value: slug === "media" ? "clapperboard" : "dumbbell" },
});
const navigationResponse = (workspaces = [workspace("media"), workspace("fitness")]) =>
	({
		data: {
			workspaces: rows(workspaces),
			collections: rows([
				{ name: { kind: "text", value: "Favorites" }, id: { kind: "text", value: "collection-1" } },
			]),
			savedViews: rows([
				{
					icon: { kind: "text", value: "film" },
					name: { kind: "text", value: "Movies" },
					slug: { kind: "text", value: "movies" },
					sortOrder: { kind: "number", value: 1 },
					pluginSlug: { kind: "text", value: "media" },
					isDisabled: { kind: "boolean", value: false },
				},
			]),
		},
	}) satisfies RyotQLResponse;
const map = (
	result: AsyncResult.AsyncResult<unknown, unknown>,
	options: { routeWorkspace?: string; selectedWorkspace?: string; pathname?: string } = {},
) =>
	mapNavigationState({
		result,
		pathname: options.pathname ?? "/media",
		routeWorkspace: options.routeWorkspace,
		selectedWorkspace: options.selectedWorkspace ?? "media",
	});

describe("navigation application state", () => {
	it("maps loading state", () => {
		expect(map(AsyncResult.initial())).toEqual({ status: "loading" });
	});

	it("maps transport failures to a stable user-facing error", () => {
		expect(map(AsyncResult.fail("private transport detail"))).toMatchObject({
			status: "error",
			failure: { kind: "transport" },
			title: "Unable to load navigation",
			detail: "The server could not load navigation. Check your connection and try again.",
		});
	});

	it("maps malformed responses to a stable user-facing error", () => {
		expect(map(AsyncResult.success({ data: {} }))).toMatchObject({
			status: "error",
			failure: { kind: "malformed" },
			title: "Unable to display navigation",
			detail: "The server returned navigation data that could not be displayed. Try again later.",
		});
	});

	it("reports when no workspace is enabled", () => {
		expect(map(AsyncResult.success(navigationResponse([workspace("media", true)])))).toEqual({
			status: "error",
			title: "No enabled workspaces",
			detail: "Enable a plugin to create a workspace.",
		});
	});

	it("uses a selected workspace and falls back to the first enabled workspace", () => {
		const selected = map(AsyncResult.success(navigationResponse()), {
			routeWorkspace: "missing",
			selectedWorkspace: "fitness",
		});
		const fallback = map(AsyncResult.success(navigationResponse()), {
			routeWorkspace: "missing",
			selectedWorkspace: "missing",
		});

		expect(selected).toMatchObject({ status: "ready", workspace: { slug: "fitness" } });
		expect(fallback).toMatchObject({ status: "ready", workspace: { slug: "media" } });
	});

	it("builds ready navigation from the route workspace and pathname", () => {
		const state = map(AsyncResult.success(navigationResponse()), {
			pathname: "/v/movies",
			routeWorkspace: "media",
			selectedWorkspace: "fitness",
		});

		expect(state).toMatchObject({
			status: "ready",
			activeKey: "view:movies",
			workspace: { slug: "media" },
			items: {
				collections: [{ kind: "collection", slug: "collection-1" }],
				views: [
					{ kind: "home", slug: "home" },
					{ kind: "view", slug: "movies" },
				],
			},
		});
	});
});
