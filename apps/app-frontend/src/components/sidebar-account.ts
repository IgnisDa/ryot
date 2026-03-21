import type { AuthenticatedUser } from "#/hooks/auth";
import type { SidebarAccount } from "./Sidebar.types";

export function toSidebarAccount(input: AuthenticatedUser): SidebarAccount {
	return {
		id: input.id,
		name: input.name,
		email: input.email,
		image: input.image ?? null,
		createdAt: input.createdAt,
		updatedAt: input.updatedAt,
		emailVerified: input.emailVerified ?? false,
	};
}

export function getSidebarAccountInitials(name: string, email: string) {
	const source = name.trim() || email.trim();
	const parts = source.split(/\s+/).filter(Boolean);

	if (parts.length === 0) return "RY";

	if (parts.length === 1) {
		const first = parts[0];
		return first ? first.slice(0, 2).toUpperCase() : "RY";
	}

	return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

export function formatSidebarAccountDate(value?: Date | string) {
	if (!value) return "--";

	const parsed = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(parsed.getTime())) return "--";

	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(parsed);
}
