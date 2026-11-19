export function getNameFromEmail(email: string) {
	const [localPart = ""] = email.split("@");
	const normalized = localPart.replace(/[._-]+/g, " ").trim();
	if (!normalized) {
		return "New User";
	}
	return normalized
		.split(/\s+/)
		.map((s) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s))
		.join(" ");
}
