/** @type {import('jest').Config} */
module.exports = {
	watchman: false,
	preset: "jest-expo",
	reporters: ["jest-silent-reporter"],
	transform: { "^.+\\.mjs$": "babel-jest" },
	testMatch: ["<rootDir>/src/**/*.component.test.tsx"],
	moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
	moduleDirectories: ["node_modules", "<rootDir>/node_modules"],
	transformIgnorePatterns: [
		"node_modules/(?!(.bun|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|standard-navigation|react-native-svg|lucide-react-native|effect|@effect/.*|msgpackr|@tanstack/.*))",
	],
};
