import type { NavigationData } from "@ryot/ryotql-recipes/navigation";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { mapNavigationState } from "./navigation-state";

const workspace = (slug: string, isDisabled = false) => ({
	slug,
	isDisabled,
	sortOrder: slug === "media" ? 1 : 2,
	name: slug === "media" ? "Media" : "Fitness",
	icon: slug === "media" ? "clapperboard" : "dumbbell",
});
const navigation = (workspaces = [workspace("media"), workspace("fitness")]) =>
	({
		workspaces,
		collections: [
			{
				sortOrder: 0,
				isDisabled: false,
				icon: "layers-3",
				pluginSlug: null,
				name: "Favorites",
				slug: "collection-1",
			},
		],
		savedViews: [
			{
				icon: "film",
				name: "Movies",
				slug: "movies",
				sortOrder: 1,
				pluginSlug: "media",
				isDisabled: false,
			},
		],
	}) satisfies NavigationData;
const map = (
	result: AsyncResult.AsyncResult<NavigationData, unknown>,
	options: { routeWorkspace?: string; selectedWorkspace?: string; pathname?: string } = {},
) =>
	mapNavigationState({
		result,
		pathname: options.pathname ?? "/media",
		routeWorkspace: options.routeWorkspace,
		selectedWorkspace: options.selectedWorkspace ?? "media",
	});

describe("navigation application state", () => {
	it("maps loading and transport failures", () => {
		expect(map(AsyncResult.initial())).toEqual({ status: "loading" });
		expect(map(AsyncResult.fail("private transport detail"))).toMatchObject({
			status: "error",
			failure: { kind: "transport" },
			title: "Unable to load navigation",
		});
	});

	it("maps malformed failures to a stable display error", () => {
		expect(map(AsyncResult.fail(new RyotQLMalformedResultError("invalid")))).toMatchObject({
			status: "error",
			failure: { kind: "malformed" },
			title: "Unable to display navigation",
		});
	});

	it("reports when no workspace is enabled", () => {
		expect(map(AsyncResult.success(navigation([workspace("media", true)])))).toEqual({
			status: "error",
			title: "No enabled workspaces",
			detail: "Enable a plugin to create a workspace.",
		});
	});

	it("uses route and selected workspace fallbacks", () => {
		const selected = map(AsyncResult.success(navigation()), {
			routeWorkspace: "missing",
			selectedWorkspace: "fitness",
		});
		const route = map(AsyncResult.success(navigation()), {
			pathname: "/v/movies",
			routeWorkspace: "media",
		});

		expect(selected).toMatchObject({ status: "ready", workspace: { slug: "fitness" } });
		expect(route).toMatchObject({
			status: "ready",
			activeKey: "view:movies",
			workspace: { slug: "media" },
		});
	});
});
