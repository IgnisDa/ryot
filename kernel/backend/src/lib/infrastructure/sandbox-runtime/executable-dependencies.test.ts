import { expect, it } from "@effect/vitest";

import { isDeclaredExecutableCall } from "./executable-dependencies";

it("restricts activities and child workflows to generated targets", () => {
	const metadata = {
		executableDependencies: [
			{ slug: "collect", kind: "script" as const },
			{ slug: "apply", kind: "workflow" as const },
		],
	};
	const activity = {
		index: 0,
		name: "collect",
		kind: "activity" as const,
		args: { input: {}, scriptSlug: "collect" },
	};
	expect(isDeclaredExecutableCall(metadata, activity)).toBe(true);
	expect(
		isDeclaredExecutableCall(metadata, {
			...activity,
			args: { ...activity.args, scriptSlug: "other" },
		}),
	).toBe(false);
	expect(isDeclaredExecutableCall({}, activity)).toBe(false);
	expect(
		isDeclaredExecutableCall(metadata, {
			index: 1,
			name: "apply",
			kind: "child",
			args: { input: {}, workflowSlug: "apply" },
		}),
	).toBe(true);
	expect(
		isDeclaredExecutableCall(metadata, {
			index: 1,
			name: "apply",
			kind: "child",
			args: { input: {}, workflowSlug: "collect" },
		}),
	).toBe(false);
});
