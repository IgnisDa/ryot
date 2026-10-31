import { expect, it } from "@effect/vitest";
import { getByRole, queryByRole } from "@testing-library/dom";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	decodeFlatSummary,
	fixtureSummaryRecipe,
} from "../../tests/client/flat-media/summary-fixture";
import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { MediaSummaryHeader } from "../media/summary-header";
import type { MediaEntitySummaryValue } from "../media/summary-state";

const header = (media: MediaEntitySummaryValue) => (
	<MediaSummaryHeader
		media={media}
		compact={false}
		settled={undefined}
		artwork={{ purpose: "cover", aspect: "poster" }}
		detail={{
			chips: [],
			facts: [],
			links: [],
			identityDetail: undefined,
			rail: { logActivity: undefined },
		}}
	/>
);

it("routes custom entities to their encoded edit path", () => {
	const navigations: unknown[] = [];
	const mounted = mountRyotClient(
		{
			navigate: (mode, target) => {
				navigations.push({ mode, target });
			},
		},
		header(
			decodeFlatSummary(fixtureSummaryRecipe, {
				images: [],
				id: "media/1",
				isCustom: true,
				schemaSlug: "movie",
			}),
		),
	);
	try {
		clickRyotElement(getByRole(mounted.container, "button", { name: "Edit" }));
		expect(navigations).toEqual([
			{
				mode: "push",
				target: {
					search: {},
					kind: "plugin-route",
					packageId: PLUGIN_PACKAGE_ID,
					path: "/movie/media%2F1/edit",
				},
			},
		]);
	} finally {
		mounted.unmount();
	}
});

it("hides edit for provider-backed entities and unsupported custom schemas", () => {
	const mounted = mountRyotClient(
		{},
		header(
			decodeFlatSummary(fixtureSummaryRecipe, { images: [], isCustom: false, schemaSlug: "movie" }),
		),
	);
	try {
		expect(queryByRole(mounted.container, "button", { name: "Edit" })).toBeNull();
		mounted.rerender(
			header(
				decodeFlatSummary(fixtureSummaryRecipe, {
					images: [],
					isCustom: true,
					schemaSlug: "media-library",
				}),
			),
		);
		expect(queryByRole(mounted.container, "button", { name: "Edit" })).toBeNull();
	} finally {
		mounted.unmount();
	}
});
