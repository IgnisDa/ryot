import { render } from "@testing-library/react";
import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { ThemeController } from "#/modules/theme/controller";
import type { ThemePreference } from "#/modules/theme/preference";
import { makeTestThemeStore } from "#/modules/theme/store.test-store";
import { makeClientStorage } from "#/persistence/storage.test-layer";

describe("ThemeController", () => {
	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits React's asynchronous persistence callback.
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

		await Effect.runPromise(Effect.sleep(0));
		expect(persisted).toEqual(["system", "dark"]);
	});
});
