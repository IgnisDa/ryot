export function getNameFromEmail(email: string) {
	const [localPart = ""] = email.split("@");
	const normalized = localPart.replace(/[._-]+/g, " ").trim();
	if (!normalized) {
		return "New User";
	}
	return normalized
		.split(/\s+/)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}
