import { Tabs, tabId } from "@ryot-app/plugin-ui-sdk";
import { useState } from "react";

import { ComponentsExample } from "#/modules/design-system/components-example";
import { MediaExample } from "#/modules/design-system/media-example";
import { SettingsExample } from "#/modules/design-system/settings-example";
import { WorkoutExample } from "#/modules/design-system/workout-example";
import { Appearance } from "#/modules/settings/appearance";
import { AppScreen } from "#/modules/shell/app-screen";
import type { ThemeStore } from "#/modules/theme/store";

// TODO: Remove this module and the `/design` route once the redesign is applied across the app.
const EXAMPLES = {
	media: MediaExample,
	workout: WorkoutExample,
	settings: SettingsExample,
	components: ComponentsExample,
} as const;

const PANEL_ID = "design-system-panel";

export function DesignSystemScreen(props: { readonly theme: ThemeStore }) {
	const [example, setExample] = useState<keyof typeof EXAMPLES>("workout");
	const Example = EXAMPLES[example];
	return (
		<AppScreen
			title="Design system"
			actions={<Appearance theme={props.theme} />}
			meta={
				<p className="text-sm text-text-muted">
					Representative screens built only from shared tokens and UI SDK components, with sample
					data.
				</p>
			}
		>
			<div className="grid gap-6">
				<Tabs
					value={example}
					label="Examples"
					panelId={PANEL_ID}
					onChange={setExample}
					options={[
						{ value: "workout", label: "Workout" },
						{ value: "media", label: "Media detail" },
						{ value: "settings", label: "Settings" },
						{ value: "components", label: "Components" },
					]}
				/>
				<div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(PANEL_ID, example)}>
					<Example />
				</div>
			</div>
		</AppScreen>
	);
}
