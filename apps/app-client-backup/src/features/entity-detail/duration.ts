export function formatMinutes(mins: number): string {
	const hours = Math.floor(mins / 60);
	const minutes = mins % 60;
	if (hours === 0) {
		return `${minutes}m`;
	}
	return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function formatSeconds(secs: number): string {
	return formatMinutes(Math.round(secs / 60));
}
