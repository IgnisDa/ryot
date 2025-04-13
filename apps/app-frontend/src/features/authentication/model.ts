export const getNameFromEmail = (email: string) => {
	const [localPart = ""] = email.split("@");
	const normalized = localPart.replace(/[._-]+/g, " ").trim();
	if (!normalized) {
		return "New User";
	}

	return normalized
		.split(/\s+/)
		.map((segment) => {
			if (!segment) {
				return segment;
			}
			return `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`;
		})
		.join(" ");
};
