export const normalizeIsbn = (value: string) => {
	const trimmed = value.trim();
	const withoutFormula =
		trimmed.startsWith('="') && trimmed.endsWith('"') ? trimmed.slice(2, -1) : trimmed;
	return withoutFormula.toUpperCase().replace(/[^0-9X]/g, "");
};

const isValidIsbn10 = (value: string) =>
	/^\d{9}[\dX]$/.test(value) &&
	value.split("").reduce((total, char, index) => {
		const digit = char === "X" ? 10 : Number.parseInt(char, 10);
		return total + digit * (10 - index);
	}, 0) %
		11 ===
		0;

const isValidIsbn13 = (value: string) => {
	if (!/^\d{13}$/.test(value)) {
		return false;
	}
	const checksum = value
		.slice(0, 12)
		.split("")
		.reduce(
			(total, char, index) => total + Number.parseInt(char, 10) * (index % 2 === 0 ? 1 : 3),
			0,
		);
	return (10 - (checksum % 10)) % 10 === Number.parseInt(value[12] ?? "", 10);
};

export const isValidIsbn = (value: string) =>
	value.length === 10 ? isValidIsbn10(value) : value.length === 13 && isValidIsbn13(value);
