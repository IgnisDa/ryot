import { createFileRoute } from "@tanstack/react-router";

import { SettingsIndex } from "#/modules/settings/settings-index";

export const Route = createFileRoute("/_authenticated/settings/")({ component: SettingsIndex });
