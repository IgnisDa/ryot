export const toTitleCase = (value: string) =>
	value
		.toLowerCase()
		.split(/\s+/)
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
