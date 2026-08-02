import { describe, expect, it, jest } from "@jest/globals";
import type { UpdateUserPreferencesBody } from "@ryot/contract/modules/user-settings/schemas";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Exit } from "effect";

import { PreferenceSettingsForm } from "./preference-settings-form";

let finish: (result: Exit.Exit<typeof preferences>) => void = () => undefined;
const preferences = { allowNsfw: false, language: null, disableIntegrations: false };

describe("preference settings form", () => {
	it("submits changed preferences and resets the dirty state", async () => {
		const user = userEvent.setup();
		const save = jest.fn((payload: UpdateUserPreferencesBody) =>
			Promise.resolve(Exit.succeed({ ...preferences, ...payload })),
		);
		await render(<PreferenceSettingsForm preferences={preferences} onSave={save} />);
		const submit = screen.getByRole("button", { name: "Save changes" });

		expect(submit).toBeDisabled();
		await user.press(screen.getByRole("switch", { name: "Show NSFW content" }));
		expect(submit).toBeEnabled();
		await user.press(submit);

		expect(await screen.findByText("Preferences saved.")).toBeOnTheScreen();
		expect(save).toHaveBeenCalledWith({ allowNsfw: true });
		expect(submit).toBeDisabled();
	});

	it("keeps edits available after a failed update", async () => {
		const user = userEvent.setup();
		const save = jest.fn((_payload: UpdateUserPreferencesBody) =>
			Promise.resolve(Exit.fail("failed")),
		);
		await render(<PreferenceSettingsForm preferences={preferences} onSave={save} />);
		const toggle = screen.getByRole("switch", { name: "Disable integrations" });

		await user.press(toggle);
		await user.press(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Could not save preferences. Try again.",
		);
		expect(toggle).toBeChecked();
		expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
	});

	it("submits a selected metadata language", async () => {
		const user = userEvent.setup();
		const save = jest.fn((payload: UpdateUserPreferencesBody) =>
			Promise.resolve(Exit.succeed({ ...preferences, ...payload })),
		);
		await render(<PreferenceSettingsForm preferences={preferences} onSave={save} />);

		await user.press(screen.getByRole("button", { name: "Metadata language: Provider default" }));
		await user.press(screen.getByRole("radio", { name: "Spanish es" }));
		await user.press(screen.getByRole("button", { name: "Save changes" }));

		expect(save).toHaveBeenCalledWith({ language: "es" });
	});

	it("disables controls while saving", async () => {
		const user = userEvent.setup();
		const save = jest.fn(
			(_payload: UpdateUserPreferencesBody) =>
				new Promise<Exit.Exit<typeof preferences>>((resolve) => {
					finish = resolve;
				}),
		);
		await render(<PreferenceSettingsForm preferences={preferences} onSave={save} />);

		await user.press(screen.getByRole("switch", { name: "Show NSFW content" }));
		await user.press(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByRole("button", { name: "Saving..." })).toBeDisabled();
		expect(screen.getByRole("switch", { name: "Show NSFW content" })).toBeDisabled();
		finish(Exit.succeed({ ...preferences, allowNsfw: true }));
		expect(await screen.findByText("Preferences saved.")).toBeOnTheScreen();
	});
});
