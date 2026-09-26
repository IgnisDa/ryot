import { render } from "@testing-library/react";
import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { ThemeController } from "#/modules/theme/controller";
import type { ThemePreference } from "#/modules/theme/preference";
import { makeTestThemeStore } from "#/modules/theme/store.test-store";
import { makeClientStorage } from "#/persistence/storage.test-layer";

describe("ThemeController", () => {
	it("renders nothing and persists a preference change made through the ThemeStore", async () => {
		const persisted: ThemePreference[] = [];
		const runtime = ManagedRuntime.make(
			makeClientStorage({
				setThemePreference: (preference) =>
					Effect.sync(() => {
						persisted.push(preference);
					}),
			}),
		);
		const theme = makeTestThemeStore("system");
		const view = render(<ThemeController theme={theme} runtime={runtime} />);

		expect(view.container.textContent).toBe("");

		theme.setPreference("dark");

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(persisted).toEqual(["system", "dark"]);
	});
});
