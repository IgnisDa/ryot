const pad = (part: number) => String(part).padStart(2, "0");

export const toDateTimeInput = (iso: string) => {
	const date = new Date(iso);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const fromDateTimeInput = (value: string, original: string | null | undefined) =>
	original !== null && original !== undefined && value === toDateTimeInput(original)
		? original
		: new Date(value).toISOString();
