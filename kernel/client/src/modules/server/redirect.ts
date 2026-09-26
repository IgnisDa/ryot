export type SafeRedirect = string;

const redirectBase = new URL("https://ryot.invalid");

export function sanitizeRedirect(value: unknown): SafeRedirect | undefined {
	if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
		return undefined;
	}

	try {
		const url = new URL(value, redirectBase);
		const pathname = decodeURIComponent(url.pathname).replaceAll("\\", "/");
		const normalizedPathname = pathname.toLowerCase();
		if (
			url.origin !== redirectBase.origin ||
			pathname.startsWith("//") ||
			normalizedPathname === "/auth" ||
			normalizedPathname.startsWith("/auth/") ||
			normalizedPathname === "/onboarding" ||
			normalizedPathname.startsWith("/onboarding/")
		) {
			return undefined;
		}
		return value;
	} catch {
		return undefined;
	}
}
