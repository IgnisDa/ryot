const twoDigits = (value: number) => String(value).padStart(2, "0");

export const localDay = (time: Date | number) => {
	const date = new Date(time);
	return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
};
