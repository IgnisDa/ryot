const measurementMetricUnits = new Map([
	["fat", "%"],
	["hip", "cm"],
	["lbm", "kg"],
	["bone", "kg"],
	["water", "%"],
	["muscle", "%"],
	["waist", "cm"],
	["bmi", "kg/m²"],
	["weight", "kg"],
]);

export const measurementMetricUnit = (key: string) => measurementMetricUnits.get(key);

export const measurementMetricKey = (name: string) =>
	name
		.toLowerCase()
		.trim()
		.replace(/\s+/g, "_")
		.replace(/[^a-z0-9_]/g, "")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");
