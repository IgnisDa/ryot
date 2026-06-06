const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");
const path = require("node:path");
const fs = require("node:fs");

function resolveHashImport(callerPath, specifier) {
	let dir = path.dirname(callerPath);
	while (dir !== path.parse(dir).root) {
		const pkgPath = path.join(dir, "package.json");
		if (fs.existsSync(pkgPath)) {
			let pkg;
			try {
				pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
			} catch {
				return null;
			}
			const { imports } = pkg;
			if (!imports) {
				return null;
			}
			for (const [key, value] of Object.entries(imports)) {
				let suffix = null;
				if (key === specifier) {
					suffix = "";
				} else if (key.endsWith("*")) {
					const prefix = key.slice(0, -1);
					if (specifier.startsWith(prefix)) {
						suffix = specifier.slice(prefix.length);
					}
				}
				if (suffix !== null) {
					const candidates = Array.isArray(value) ? value : [value];
					for (const template of candidates) {
						const resolved = path.join(dir, template.replace("*", suffix));
						if (fs.existsSync(resolved)) {
							return resolved;
						}
					}
				}
			}
			return null;
		}
		dir = path.dirname(dir);
	}
	return null;
}

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
	if (moduleName.startsWith("#")) {
		const resolved = resolveHashImport(context.originModulePath, moduleName);
		if (resolved) {
			return { filePath: resolved, type: "sourceFile" };
		}
	}
	return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativewind(config);
