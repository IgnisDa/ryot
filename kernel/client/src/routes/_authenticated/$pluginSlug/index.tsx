import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/$pluginSlug/")({ component: () => null });
