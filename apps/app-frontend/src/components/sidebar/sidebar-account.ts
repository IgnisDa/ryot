import { dayjs } from "@ryot/ts-utils";

import type { AuthenticatedUser } from "~/lib/auth";

import type { SidebarAccount } from "./Sidebar.types";

export function toSidebarAccount(input: AuthenticatedUser): SidebarAccount {
	return {
		id: input.user.id,
		name: input.user.name,
		email: input.user.email,
		image: input.user.image ?? null,
		createdAt: input.user.createdAt,
		updatedAt: input.user.updatedAt,
	};
}

export function getSidebarAccountInitials(name: string, email: string) {
	const source = name.trim() || email.trim();
	const parts = source.split(/\s+/).filter(Boolean);

	if (parts.length === 0) {
		return "RY";
	}

	if (parts.length === 1) {
		const first = parts[0];
		return first ? first.slice(0, 2).toUpperCase() : "RY";
	}

	return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

export function formatSidebarAccountDate(value?: Date | string) {
	if (!value) {
		return "--";
	}

	const parsed = dayjs(value);
	if (!parsed.isValid()) {
		return "--";
	}

	return parsed.format("MMM D, YYYY");
}
