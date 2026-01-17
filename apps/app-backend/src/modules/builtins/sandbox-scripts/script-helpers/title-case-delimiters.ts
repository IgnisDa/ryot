export const toTitleCase = (value: string) =>
	value
		.toLowerCase()
		.replace(/[_-]+/g, " ")
		.split(/\s+/)
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
