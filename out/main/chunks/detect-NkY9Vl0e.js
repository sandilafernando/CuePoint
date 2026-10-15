const require_rolldown_runtime = require("./rolldown-runtime-VH7oDXx4.js");
let node_fs = require("node:fs");
let node_path = require("node:path");
node_path = require_rolldown_runtime.__toESM(node_path);
//#region src/main/ndi/detect.ts
/**
* NDI runtime discovery.
*
* CuePoint never redistributes the NDI runtime — NewTek/Vizrt licensing places that
* responsibility on the operator. Instead the installed runtime is located at startup
* and loaded through FFI, which also means CuePoint works with NDI 5 and NDI 6 without
* carrying a compile-time SDK dependency.
*
* Deliberately free of Electron imports so the helper process and unit tests can use it.
*/
var NDI_X64_LIBRARY = "Processing.NDI.Lib.x64.dll";
var KNOWN_DIRECTORIES = [
	"C:\\Program Files\\NDI\\NDI 6 Runtime\\v6",
	"C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime",
	"C:\\Program Files (x86)\\NDI\\NDI 6 Runtime\\v6",
	"C:\\Program Files\\NewTek\\NDI 5 Runtime",
	"C:\\Program Files (x86)\\NewTek\\NDI 5 Runtime",
	"C:\\Program Files\\NewTek\\NDI 4 Runtime",
	"C:\\Program Files (x86)\\NewTek\\NDI 4 Runtime"
];
var ENVIRONMENT_VARIABLES = [
	"NDI_RUNTIME_DIR_V6",
	"NDI_RUNTIME_DIR_V5",
	"NDI_RUNTIME_DIR_V4"
];
function candidateFrom(directory) {
	return node_path.default.join(directory, NDI_X64_LIBRARY);
}
function readNdiEnvironment() {
	const found = [];
	for (const name of ENVIRONMENT_VARIABLES) {
		const value = process.env[name];
		if (value && value.trim()) found.push({
			variable: name,
			value: value.trim()
		});
	}
	return found;
}
function scanProgramFiles(searched) {
	for (const root of ["C:\\Program Files\\NDI", "C:\\Program Files\\NewTek"]) {
		if (!(0, node_fs.existsSync)(root)) continue;
		searched.push(root);
		let entries = [];
		try {
			entries = (0, node_fs.readdirSync)(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => node_path.default.join(root, entry.name));
		} catch {
			continue;
		}
		for (const entry of entries) {
			const candidates = [
				candidateFrom(entry),
				candidateFrom(node_path.default.join(entry, "v6")),
				candidateFrom(node_path.default.join(entry, "Runtime"))
			];
			for (const candidate of candidates) {
				searched.push(candidate);
				if ((0, node_fs.existsSync)(candidate)) return candidate;
			}
		}
	}
	return null;
}
/**
* Finds the x64 NDI runtime library.
* Order: explicit override -> NDI_RUNTIME_DIR_* -> PATH -> well known install dirs -> scan.
*/
function findNdiLibrary(override) {
	const searched = [];
	if (override && override.trim()) {
		const candidate = override.trim();
		searched.push(candidate);
		if ((0, node_fs.existsSync)(candidate)) return {
			path: candidate,
			directory: node_path.default.dirname(candidate),
			source: "override",
			searched
		};
	}
	for (const { value } of readNdiEnvironment()) {
		const candidate = candidateFrom(value);
		searched.push(candidate);
		if ((0, node_fs.existsSync)(candidate)) return {
			path: candidate,
			directory: node_path.default.dirname(candidate),
			source: "environment",
			searched
		};
	}
	for (const entry of (process.env.PATH ?? "").split(node_path.default.delimiter)) {
		if (!entry) continue;
		const candidate = candidateFrom(entry);
		searched.push(candidate);
		if ((0, node_fs.existsSync)(candidate)) return {
			path: candidate,
			directory: node_path.default.dirname(candidate),
			source: "path",
			searched
		};
	}
	for (const directory of KNOWN_DIRECTORIES) {
		const candidate = candidateFrom(directory);
		searched.push(candidate);
		if ((0, node_fs.existsSync)(candidate)) return {
			path: candidate,
			directory: node_path.default.dirname(candidate),
			source: "known-location",
			searched
		};
	}
	const scanned = scanProgramFiles(searched);
	if (scanned) return {
		path: scanned,
		directory: node_path.default.dirname(scanned),
		source: "scan",
		searched
	};
	return {
		path: null,
		directory: null,
		source: "none",
		searched
	};
}
function describeNdiSearch(info) {
	if (info.path) return `${info.path} (found via ${info.source})`;
	return [`Runtime not found. Checked ${info.searched.length} location(s).`, "Install the NDI Runtime (Tools) from https://ndi.video/tools/ and restart CuePoint."].join(" ");
}
//#endregion
Object.defineProperty(exports, "describeNdiSearch", {
	enumerable: true,
	get: function() {
		return describeNdiSearch;
	}
});
Object.defineProperty(exports, "findNdiLibrary", {
	enumerable: true,
	get: function() {
		return findNdiLibrary;
	}
});
