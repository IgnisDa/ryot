import { render } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { ThemeController } from "#/modules/theme/controller";
import type { ThemePreference } from "#/modules/theme/preference";
import { makeTestThemeStore } from "#/modules/theme/store.test-store";
import { ClientStorage } from "#/persistence/storage";

describe("ThemeController", () => {
	it("renders nothing and persists a preference change made through the ThemeStore", async () => {
		const persisted: ThemePreference[] = [];
		const runtime = ManagedRuntime.make(
			Layer.succeed(ClientStorage, {
				remove: () => Effect.void,
				clearServerSelection: Effect.void,
				setLastWorkspace: () => Effect.void,
				setSavedViewLayout: () => Effect.void,
				setServerSelection: () => Effect.void,
				setRememberedProvider: () => Effect.void,
				getServerSelection: Effect.succeed(null),
				getLastWorkspace: () => Effect.succeed(null),
				getRememberedProvider: () => Effect.succeed(null),
				getThemePreference: Effect.succeed("system" as const),
				getSavedViewLayout: () => Effect.succeed("grid" as const),
				setThemePreference: (preference) =>
					Effect.sync(() => {
						persisted.push(preference);
					}),
			}),
		);
		const theme = makeTestThemeStore("system");
		const view = render(<ThemeController runtime={runtime} theme={theme} />);

		expect(view.container.textContent).toBe("");

		theme.setPreference("dark");

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(persisted).toEqual(["system", "dark"]);
	});
});
