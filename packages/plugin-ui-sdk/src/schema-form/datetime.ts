export const localDateTime = (value: string, timeZone: string) => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	const parts = new Intl.DateTimeFormat("sv-SE", {
		timeZone,
		day: "2-digit",
		year: "numeric",
		hour: "2-digit",
		month: "2-digit",
		hourCycle: "h23",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(date);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((item) => item.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}${date.getUTCMilliseconds() === 0 ? "" : `.${String(date.getUTCMilliseconds()).padStart(3, "0")}`}`;
};

export const utcDateTime = (value: string, timeZone: string) => {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) {
		return undefined;
	}
	const wall = Date.parse(`${value}Z`);
	if (!Number.isFinite(wall)) {
		return undefined;
	}
	let instant = wall;
	for (let attempt = 0; attempt < 4; attempt++) {
		const difference =
			wall - Date.parse(`${localDateTime(new Date(instant).toISOString(), timeZone)}Z`);
		if (difference === 0) {
			return new Date(instant).toISOString();
		}
		instant += difference;
	}
	return undefined;
};
