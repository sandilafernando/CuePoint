const require_rolldown_runtime = require("./chunks/rolldown-runtime-VH7oDXx4.js");
const require_detect = require("./chunks/detect-NkY9Vl0e.js");
const require_protocol = require("./chunks/protocol-BaKXCjPd.js");
let node_fs = require("node:fs");
let node_path = require("node:path");
node_path = require_rolldown_runtime.__toESM(node_path);
let electron = require("electron");
let node_fs_promises = require("node:fs/promises");
let sql_js = require("sql.js");
sql_js = require_rolldown_runtime.__toESM(sql_js);
let node_zlib = require("node:zlib");
let node_child_process = require("node:child_process");
let node_events = require("node:events");
let node_os = require("node:os");
node_os = require_rolldown_runtime.__toESM(node_os);
//#region src/shared/ipc.ts
/** Channel names. Grouped by domain so both processes stay in sync. */
var IPC = {
	app: {
		info: "app:info",
		settings: "app:settings:get",
		saveSettings: "app:settings:save",
		window: "app:window",
		isMaximized: "app:isMaximized",
		chooseDirectory: "app:chooseDirectory",
		chooseFile: "app:chooseFile",
		openExternal: "app:openExternal",
		openPath: "app:openPath",
		revealPath: "app:revealPath",
		clipboardWrite: "app:clipboard:write",
		clipboardRead: "app:clipboard:read",
		setMenuState: "app:menuState:set"
	},
	project: {
		create: "project:create",
		openDialog: "project:openDialog",
		openPath: "project:openPath",
		current: "project:current",
		save: "project:save",
		saveAs: "project:saveAs",
		apply: "project:apply",
		validate: "project:validate",
		recent: "project:recent",
		forgetRecent: "project:forgetRecent",
		pinRecent: "project:pinRecent",
		duplicate: "project:duplicate",
		rename: "project:rename",
		snapshots: "project:snapshots",
		restoreSnapshot: "project:restoreSnapshot",
		deleteSnapshot: "project:deleteSnapshot",
		markClean: "project:markClean"
	},
	stage: {
		importBackground: "stage:importBackground",
		probeAsset: "stage:probeAsset",
		readAssetDataUrl: "stage:readAssetDataUrl",
		clearBackground: "stage:clearBackground"
	},
	export: {
		run: "export:run",
		preview: "export:preview",
		defaultDirectory: "export:defaultDirectory"
	},
	ndi: {
		status: "ndi:status",
		start: "ndi:start",
		stop: "ndi:stop",
		discover: "ndi:discover",
		connect: "ndi:connect",
		disconnect: "ndi:disconnect",
		setPaused: "ndi:setPaused",
		setPreviewFps: "ndi:setPreviewFps",
		stats: "ndi:stats",
		requestPort: "ndi:requestPort",
		rendererReady: "ndi:rendererReady"
	},
	recording: {
		status: "recording:status",
		start: "recording:start",
		pause: "recording:pause",
		resume: "recording:resume",
		stop: "recording:stop",
		cancel: "recording:cancel",
		begin: "recording:begin",
		receiveChunk: "recording:chunk",
		finalize: "recording:finalize",
		entries: "recording:entries",
		deleteEntry: "recording:deleteEntry",
		verify: "recording:verify",
		openFolder: "recording:openFolder",
		checkEncoder: "recording:checkEncoder",
		config: "recording:config"
	},
	diagnostics: {
		report: "diagnostics:report",
		logs: "diagnostics:logs",
		clearLogs: "diagnostics:clearLogs",
		writeReport: "diagnostics:writeReport"
	},
	docs: {
		list: "docs:list",
		read: "docs:read",
		open: "docs:open"
	},
	events: {
		/** Main -> renderer: execute a command id from the menu or an accelerator. */
		command: "event:command",
		/** Main -> renderer: project content changed on disk or by another flow. */
		projectChanged: "event:projectChanged",
		/** Main -> renderer: transient toast/notification. */
		toast: "event:toast",
		/** Main -> renderer: settings changed. */
		settingsChanged: "event:settingsChanged",
		/** Main -> renderer: NDI statistics sample. */
		ndiStats: "event:ndiStats",
		/** Main -> renderer: NDI runtime / helper state. */
		ndiRuntime: "event:ndiRuntime",
		/** Main -> renderer: NDI source list changed. */
		ndiSources: "event:ndiSources",
		/** Main -> renderer: recording state changed. */
		recording: "event:recording",
		/** Main -> renderer: unsaved-changes prompt answer. */
		dirtyState: "event:dirtyState",
		/** Main -> renderer: request to close, after save prompt. */
		closeRequested: "event:closeRequested"
	}
};
//#endregion
//#region src/main/services/logger.ts
var LEVEL_ORDER = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3
};
/**
* Structured logger.
*
* Writes one line per entry to a daily file and keeps a bounded in-memory ring so the
* Diagnostics dashboard and "Copy diagnostic report" never need to parse log files.
* Never logs secrets, tokens or full file contents.
*/
var Logger = class {
	directory;
	level;
	keepFiles;
	ring = [];
	ringSize;
	fileName;
	ready;
	queue = [];
	flushing = false;
	failed = false;
	constructor(options) {
		this.directory = options.directory;
		this.level = options.level ?? "info";
		this.keepFiles = options.keepFiles ?? 10;
		this.ringSize = options.ringSize ?? 500;
		this.fileName = options.fileName ?? `cuepoint-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.log`;
		this.ready = (0, node_fs_promises.mkdir)(this.directory, { recursive: true }).then(() => void 0);
	}
	get logFilePath() {
		return node_path.default.join(this.directory, this.fileName);
	}
	setLevel(level) {
		this.level = level;
	}
	getLevel() {
		return this.level;
	}
	log(level, scope, message, detail) {
		const entry = {
			ts: (/* @__PURE__ */ new Date()).toISOString(),
			level,
			scope,
			message,
			...detail ? { detail } : {}
		};
		this.ring.push(entry);
		if (this.ring.length > this.ringSize) this.ring.splice(0, this.ring.length - this.ringSize);
		if (LEVEL_ORDER[level] > LEVEL_ORDER[this.level]) return;
		const line = `${entry.ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${detail ? ` | ${detail.replace(/\s+/g, " ").slice(0, 2e3)}` : ""}\n`;
		this.queue.push(line);
		this.flush();
		if (level === "error") console.error(line.trimEnd());
		else if (level === "warn") console.warn(line.trimEnd());
		else if (this.level === "debug") console.log(line.trimEnd());
	}
	error(scope, message, detail) {
		this.log("error", scope, message, detail);
	}
	warn(scope, message, detail) {
		this.log("warn", scope, message, detail);
	}
	info(scope, message, detail) {
		this.log("info", scope, message, detail);
	}
	debug(scope, message, detail) {
		this.log("debug", scope, message, detail);
	}
	async flush() {
		if (this.flushing || this.failed || this.queue.length === 0) return;
		this.flushing = true;
		try {
			await this.ready;
			const payload = this.queue.join("");
			this.queue = [];
			await (0, node_fs_promises.appendFile)(this.logFilePath, payload, "utf8");
		} catch {
			this.failed = true;
			this.queue = [];
		} finally {
			this.flushing = false;
		}
	}
	recent(limit = 200, level, scope) {
		let entries = this.ring;
		if (level) entries = entries.filter((entry) => entry.level === level);
		if (scope) entries = entries.filter((entry) => entry.scope === scope);
		return entries.slice(-limit);
	}
	counts() {
		return {
			errors: this.ring.filter((e) => e.level === "error").length,
			warnings: this.ring.filter((e) => e.level === "warn").length
		};
	}
	/** Trims old log files so the folder does not grow without bound. */
	async rotate() {
		try {
			const files = (await (0, node_fs_promises.readdir)(this.directory)).filter((name) => name.startsWith("cuepoint-") && name.endsWith(".log")).sort();
			const excess = files.length - this.keepFiles;
			for (let i = 0; i < excess; i += 1) await (0, node_fs_promises.unlink)(node_path.default.join(this.directory, files[i])).catch(() => void 0);
		} catch {}
	}
	async flushNow() {
		while (this.queue.length > 0) await this.flush();
	}
};
var instance = null;
function createLogger(options) {
	instance = new Logger(options);
	return instance;
}
function getLogger() {
	if (!instance) instance = new Logger({ directory: node_path.default.join(process.cwd(), "logs") });
	return instance;
}
//#endregion
//#region src/main/services/paths.ts
/**
* Central path resolution.
*
* Development and packaged layouts differ, so every path is derived here rather than
* being reconstructed at each call site. User projects always live under userData,
* which is what lets the uninstaller remove the application without touching them.
*/
function resolveAppPaths(app) {
	const userData = app.getPath("userData");
	const appRoot = app.getAppPath();
	const packaged = app.isPackaged;
	const docs = packaged ? firstExisting([node_path.default.join(process.resourcesPath, "docs"), node_path.default.join(appRoot, "docs")]) : node_path.default.join(appRoot, "docs");
	return {
		userData,
		logs: node_path.default.join(userData, "logs"),
		library: node_path.default.join(userData, "library.sqlite"),
		projects: node_path.default.join(userData, "projects"),
		exports: node_path.default.join(userData, "exports"),
		recordings: node_path.default.join(userData, "recordings"),
		assets: node_path.default.join(userData, "assets"),
		tmp: node_path.default.join(userData, "tmp"),
		crashDumps: app.getPath("crashDumps"),
		docs,
		appRoot,
		resources: packaged ? process.resourcesPath : appRoot
	};
}
function firstExisting(candidates) {
	for (const candidate of candidates) if ((0, node_fs.existsSync)(candidate)) return candidate;
	return candidates[candidates.length - 1];
}
/**
* Resolves sql.js's WebAssembly payload.
*
* `require.resolve` is avoided on purpose: the main bundle is produced by Rollup and a
* literal `require.resolve('sql.js/...')` would be rewritten at build time. Reading
* inside app.asar works normally, so no unpacked copy is required.
*/
function resolveSqlJsWasm(paths) {
	return firstExisting([
		node_path.default.join(paths.appRoot, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
		node_path.default.join(paths.resources, "app.asar.unpacked", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
		node_path.default.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm")
	]);
}
/**
* Resolves a runtime dependency that must be unpacked from the asar archive
* (native addons and executables cannot be loaded from inside app.asar).
*/
function resolveUnpackedModule(paths, relative) {
	return firstExisting([
		node_path.default.join(paths.resources, "app.asar.unpacked", "node_modules", relative),
		node_path.default.join(paths.appRoot, "node_modules", relative),
		node_path.default.join(process.cwd(), "node_modules", relative)
	]);
}
//#endregion
//#region src/shared/units.ts
function clamp(value, min, max) {
	if (Number.isNaN(value)) return min;
	return Math.min(max, Math.max(min, value));
}
//#endregion
//#region src/shared/geometry.ts
/**
* Geometry core.
*
* Coordinate systems
* ------------------
* 1. Stage space   — millimetres, origin at the stage's top-left, +x right, +y down.
* 2. Canvas space  — logical canvas pixels: `mmPerCanvasPx = 1000 / canvasPxPerMeter`.
*                    Stage space is scaled into canvas space by `canvasPxPerMeter`.
* 3. View space    — canvas space after zoom/pan. View space is the only place
*                    zoom and pan exist; stored geometry is never rewritten by them.
* 4. Output space  — output device pixels used by the mapping engine.
*
* A screen is stored as an axis-aligned rect (x, y, width, height) in millimetres plus
* a rotation about that rect's centre. This keeps the stored model unambiguous while
* still supporting rotated screens.
*/
var DEG = Math.PI / 180;
function rectCenter(rect) {
	return {
		x: rect.x + rect.width / 2,
		y: rect.y + rect.height / 2
	};
}
function rectRight(rect) {
	return rect.x + rect.width;
}
function rectBottom(rect) {
	return rect.y + rect.height;
}
function rectArea(rect) {
	return rect.width * rect.height;
}
function cloneRect(rect) {
	return {
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height
	};
}
/** A rect containing both inputs (axis-aligned, ignores rotation). */
function unionRect(a, b) {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(rectRight(a), rectRight(b)) - x,
		height: Math.max(rectBottom(a), rectBottom(b)) - y
	};
}
function unionRects(rects) {
	if (rects.length === 0) return null;
	let acc = cloneRect(rects[0]);
	for (let i = 1; i < rects.length; i += 1) acc = unionRect(acc, rects[i]);
	return acc;
}
function rectsIntersect(a, b, epsilon = 0) {
	return a.x + epsilon < rectRight(b) && rectRight(a) - epsilon > b.x && a.y + epsilon < rectBottom(b) && rectBottom(a) - epsilon > b.y;
}
function intersectionRect(a, b) {
	if (!rectsIntersect(a, b)) return null;
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	return {
		x,
		y,
		width: Math.min(rectRight(a), rectRight(b)) - x,
		height: Math.min(rectBottom(a), rectBottom(b)) - y
	};
}
function normalizeDegrees(deg) {
	if (!Number.isFinite(deg)) return 0;
	let d = deg % 360;
	if (d < 0) d += 360;
	return d;
}
/** Rotates `point` around `origin` by `deg` degrees clockwise (screen space, +y down). */
function rotatePoint(point, origin, deg) {
	if (deg === 0) return {
		x: point.x,
		y: point.y
	};
	const rad = deg * DEG;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const dx = point.x - origin.x;
	const dy = point.y - origin.y;
	return {
		x: origin.x + dx * cos - dy * sin,
		y: origin.y + dx * sin + dy * cos
	};
}
/** The four corners of a rotated rect, in order nw, ne, se, sw. */
function rectCorners(rect, rotationDeg = 0) {
	const c = rectCenter(rect);
	const nw = {
		x: rect.x,
		y: rect.y
	};
	const ne = {
		x: rectRight(rect),
		y: rect.y
	};
	const se = {
		x: rectRight(rect),
		y: rectBottom(rect)
	};
	const sw = {
		x: rect.x,
		y: rectBottom(rect)
	};
	return [
		rotatePoint(nw, c, rotationDeg),
		rotatePoint(ne, c, rotationDeg),
		rotatePoint(se, c, rotationDeg),
		rotatePoint(sw, c, rotationDeg)
	];
}
/** Axis-aligned bounding box of a rotated rect. */
function rotatedBounds(rect, rotationDeg = 0) {
	if (!rotationDeg) return cloneRect(rect);
	const corners = rectCorners(rect, rotationDeg);
	const xs = corners.map((corner) => corner.x);
	const ys = corners.map((corner) => corner.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	return {
		x: minX,
		y: minY,
		width: Math.max(...xs) - minX,
		height: Math.max(...ys) - minY
	};
}
function gcd(a, b) {
	let x = Math.abs(Math.round(a));
	let y = Math.abs(Math.round(b));
	while (y) {
		const t = y;
		y = x % y;
		x = t;
	}
	return x || 1;
}
/** Simplifies a pixel resolution into a display aspect string, e.g. "16:9". */
function aspectRatioLabel(width, height, maxTerms = 40) {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "—";
	const d = gcd(width, height);
	const w = width / d;
	const h = height / d;
	if (w > maxTerms || h > maxTerms) {
		const ratio = width / height;
		const common = [
			[64, 27],
			[32, 9],
			[21, 9],
			[16, 9],
			[16, 10],
			[3, 2],
			[4, 3],
			[5, 4],
			[1, 1],
			[9, 16],
			[9, 21]
		];
		let best = common[0];
		let bestErr = Infinity;
		for (const pair of common) {
			const err = Math.abs(ratio - pair[0] / pair[1]);
			if (err < bestErr) {
				bestErr = err;
				best = pair;
			}
		}
		return `${best[0]}:${best[1]} (~)`;
	}
	return `${w}:${h}`;
}
function aspectDecimal(width, height) {
	if (!height) return 0;
	return width / height;
}
var SCREEN_COLORS = [
	"#4c8dff",
	"#39c6a4",
	"#f0a83c",
	"#e2647a",
	"#a97bff",
	"#3fb8d8",
	"#c6d84d",
	"#ff8f4d"
];
function newId(prefix) {
	return `${prefix}_${(typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).replace(/-/g, "").slice(0, 24)}`;
}
function nowIso() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function createDefaultBackground() {
	return {
		assetPath: null,
		assetMissing: false,
		visible: true,
		opacity: .65,
		fit: "contain",
		offsetXMm: 0,
		offsetYMm: 0,
		scale: 1,
		rotationDeg: 0,
		locked: false,
		sourceWidth: null,
		sourceHeight: null
	};
}
function createDefaultStage(overrides = {}) {
	return {
		name: "Main Stage",
		widthMm: 12e3,
		heightMm: 6e3,
		canvasPxPerMeter: 40,
		defaultUnit: "m",
		gridVisible: true,
		gridSpacingMm: 500,
		gridMajorEvery: 4,
		gridSubdivisions: 4,
		snapToGrid: true,
		snapToScreens: true,
		snapToStage: true,
		snapTolerancePx: 8,
		guidesVisible: true,
		rulersVisible: true,
		background: createDefaultBackground(),
		...overrides
	};
}
function createDefaultOutput(overrides = {}) {
	return {
		id: newId("out"),
		name: "Output 1",
		width: 1920,
		height: 1080,
		enabled: true,
		notes: "",
		...overrides
	};
}
function createScreen(options = {}) {
	const widthMm = options.widthMm ?? 2e3;
	const heightMm = options.heightMm ?? 1e3;
	const pixelPitchMm = options.pixelPitchMm === void 0 ? 2.5 : options.pixelPitchMm;
	const pixelWidth = options.pixelWidth ?? Math.round(widthMm / (pixelPitchMm ?? 2.5));
	const pixelHeight = options.pixelHeight ?? Math.round(heightMm / (pixelPitchMm ?? 2.5));
	const id = options.id ?? newId("scr");
	const color = SCREEN_COLORS[(options.colorIndex ?? 0) % SCREEN_COLORS.length];
	return {
		id,
		name: options.name ?? "Screen 1",
		type: options.type ?? "led",
		color,
		visible: true,
		locked: false,
		notes: "",
		order: 0,
		groupId: null,
		xMm: options.xMm ?? 0,
		yMm: options.yMm ?? 0,
		widthMm,
		heightMm,
		rotationDeg: 0,
		pixelWidth,
		pixelHeight,
		pixelPitchMm,
		mapping: {
			outputId: null,
			region: {
				x: 0,
				y: 0,
				width: pixelWidth,
				height: pixelHeight
			},
			autoRegion: true,
			exportVisible: true,
			scale: 1,
			offsetXPx: 0,
			offsetYPx: 0,
			notes: ""
		}
	};
}
function createDefaultProjectMeta(name, author = "") {
	const ts = nowIso();
	return {
		id: newId("prj"),
		name: name.trim() || "Untitled Project",
		createdAt: ts,
		updatedAt: ts,
		author,
		notes: ""
	};
}
function createDefaultProject(options) {
	const stage = createDefaultStage({
		widthMm: options.stageWidthMm ?? 12e3,
		heightMm: options.stageHeightMm ?? 6e3,
		...options.defaultUnit ? { defaultUnit: options.defaultUnit } : {}
	});
	if (options.backgroundAssetPath) stage.background.assetPath = options.backgroundAssetPath;
	const outputs = options.outputs?.length ? options.outputs : [createDefaultOutput()];
	const screenCount = clamp(options.initialScreenCount ?? 0, 0, 12);
	const screens = [];
	for (let i = 0; i < screenCount; i += 1) {
		const screen = createScreen({
			name: `Screen ${i + 1}`,
			colorIndex: i,
			pixelPitchMm: 2.5
		});
		const placement = nextScreenPosition(stage, screens, screen);
		screen.xMm = placement.x;
		screen.yMm = placement.y;
		screen.order = i;
		screen.mapping.outputId = outputs[0].id;
		screens.push(screen);
	}
	return {
		schemaVersion: 2,
		meta: createDefaultProjectMeta(options.name, options.author ?? ""),
		stage,
		screens,
		groups: [],
		outputs,
		settings: {
			autosaveEnabled: true,
			autosaveIntervalMs: 3e4,
			backupRetention: 10,
			exportDirectory: null
		}
	};
}
/**
* Finds a free-ish spot for a new screen: scans left to right along the stage,
* wrapping to a new row below the current content when the row is full.
*/
function nextScreenPosition(stage, existing, candidate) {
	const gap = Math.max(100, stage.gridSpacingMm);
	const maxX = Math.max(stage.widthMm - candidate.widthMm, 0);
	const maxY = Math.max(stage.heightMm - candidate.heightMm, 0);
	const occupied = existing.map((s) => rotatedBounds({
		x: s.xMm,
		y: s.yMm,
		width: s.widthMm,
		height: s.heightMm
	}, s.rotationDeg));
	const startY = Math.min(gap, maxY);
	const rows = Math.max(1, Math.floor((maxY - startY) / Math.max(candidate.heightMm + gap, 1)) + 1);
	for (let row = 0; row < rows; row += 1) {
		const y = Math.min(startY + row * (candidate.heightMm + gap), maxY);
		let x = Math.min(gap, maxX);
		let guard = 0;
		while (x <= maxX && guard < 200) {
			guard += 1;
			const probe = {
				x,
				y,
				width: candidate.widthMm,
				height: candidate.heightMm
			};
			if (!occupied.some((o) => probe.x < rectRight(o) + gap * .25 && rectRight(probe) + gap * .25 > o.x && probe.y < rectBottom(o) + gap * .25 && rectBottom(probe) + gap * .25 > o.y)) return {
				x,
				y
			};
			const next = occupied.filter((o) => probe.y < rectBottom(o) + gap * .25 && rectBottom(probe) + gap * .25 > o.y).map((o) => rectRight(o));
			x = Math.min(Math.max(...next.length ? next : [x]) + gap, maxX + gap);
		}
	}
	const last = existing[existing.length - 1];
	return {
		x: clamp((last?.xMm ?? 0) + 200, 0, Math.max(stage.widthMm - candidate.widthMm, 0)),
		y: clamp((last?.yMm ?? 0) + 200, 0, Math.max(stage.heightMm - candidate.heightMm, 0))
	};
}
function projectSummary(project, path, sizeBytes = 0) {
	return {
		path,
		id: project.meta.id,
		name: project.meta.name,
		author: project.meta.author,
		createdAt: project.meta.createdAt,
		updatedAt: project.meta.updatedAt,
		screenCount: project.screens.length,
		outputCount: project.outputs.length,
		stageWidthMm: project.stage.widthMm,
		stageHeightMm: project.stage.heightMm,
		schemaVersion: project.schemaVersion,
		sizeBytes,
		exists: true,
		missingAssets: project.stage.background.assetMissing ? 1 : 0
	};
}
function finite(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
/**
* Normalises any persisted project payload into the current schema.
*
* Unknown or malformed values fall back to safe defaults instead of throwing, so a
* partially corrupted project can still be opened and repaired by the operator.
*/
function migrateProject(raw) {
	const migrations = [];
	if (!raw || typeof raw !== "object") throw new Error("Project file is not a JSON object.");
	const candidate = raw;
	const version = finite(candidate.schemaVersion, 1);
	let source = candidate;
	if (version < 2) {
		migrations.push(`Migrated project from schema v${version} to v2 (metres -> millimetres, nativeWidth -> pixelWidth, mapping initialised).`);
		const legacyStage = candidate.stage ?? {};
		const screens = (candidate.screens ?? []).map((legacy, index) => {
			const widthMm = finite(legacy.widthM, 2) * 1e3;
			const heightMm = finite(legacy.heightM, 1) * 1e3;
			const pixelWidth = Math.max(1, Math.round(finite(legacy.nativeWidth, widthMm / 2.5)));
			const pixelHeight = Math.max(1, Math.round(finite(legacy.nativeHeight, heightMm / 2.5)));
			const screen = createScreen({
				id: legacy.id ?? newId("scr"),
				name: legacy.name ?? `Screen ${index + 1}`,
				widthMm,
				heightMm,
				pixelWidth,
				pixelHeight,
				xMm: finite(legacy.xM, 0) * 1e3,
				yMm: finite(legacy.yM, 0) * 1e3,
				colorIndex: index,
				pixelPitchMm: null
			});
			screen.rotationDeg = normalizeDegrees(finite(legacy.rotationDeg, 0));
			screen.color = typeof legacy.color === "string" ? legacy.color : screen.color;
			screen.visible = legacy.visible !== false;
			screen.locked = legacy.locked === true;
			screen.notes = typeof legacy.notes === "string" ? legacy.notes : "";
			screen.order = index;
			return screen;
		});
		source = {
			schemaVersion: 2,
			meta: candidate.meta,
			stage: createDefaultStage({
				name: legacyStage.name ?? "Main Stage",
				widthMm: finite(legacyStage.widthM, 12) * 1e3,
				heightMm: finite(legacyStage.heightM, 6) * 1e3,
				canvasPxPerMeter: finite(legacyStage.canvasPxPerMeter, 40),
				background: {
					...createDefaultBackground(),
					...legacyStage.background ?? {}
				}
			}),
			screens,
			groups: [],
			outputs: [createDefaultOutput()],
			settings: {
				autosaveEnabled: true,
				autosaveIntervalMs: 3e4,
				backupRetention: 10,
				exportDirectory: null
			}
		};
	}
	const stage = createDefaultStage(source.stage ?? {});
	stage.background = {
		...createDefaultBackground(),
		...source.stage?.background ?? {}
	};
	stage.widthMm = finite(stage.widthMm, 12e3);
	stage.heightMm = finite(stage.heightMm, 6e3);
	stage.canvasPxPerMeter = finite(stage.canvasPxPerMeter, 40);
	const outputs = (source.outputs ?? []).map((o) => ({
		id: o.id ?? newId("out"),
		name: o.name ?? "Output",
		width: Math.round(finite(o.width, 1920)),
		height: Math.round(finite(o.height, 1080)),
		enabled: o.enabled !== false,
		notes: o.notes ?? ""
	}));
	if (outputs.length === 0) outputs.push(createDefaultOutput());
	const screens = (source.screens ?? []).map((raw, index) => {
		const pixelWidth = Math.max(1, Math.round(finite(raw.pixelWidth, 800)));
		const pixelHeight = Math.max(1, Math.round(finite(raw.pixelHeight, 400)));
		const mapping = raw.mapping ?? {
			outputId: null,
			region: {
				x: 0,
				y: 0,
				width: pixelWidth,
				height: pixelHeight
			},
			autoRegion: true,
			exportVisible: true,
			scale: 1,
			offsetXPx: 0,
			offsetYPx: 0,
			notes: ""
		};
		return {
			id: raw.id ?? newId("scr"),
			name: raw.name ?? `Screen ${index + 1}`,
			type: raw.type ?? "led",
			color: raw.color ?? SCREEN_COLORS[index % SCREEN_COLORS.length],
			visible: raw.visible !== false,
			locked: raw.locked === true,
			notes: raw.notes ?? "",
			order: finite(raw.order, index),
			groupId: raw.groupId ?? null,
			xMm: finite(raw.xMm, 0),
			yMm: finite(raw.yMm, 0),
			widthMm: finite(raw.widthMm, 2e3),
			heightMm: finite(raw.heightMm, 1e3),
			rotationDeg: normalizeDegrees(finite(raw.rotationDeg, 0)),
			pixelWidth,
			pixelHeight,
			pixelPitchMm: typeof raw.pixelPitchMm === "number" && Number.isFinite(raw.pixelPitchMm) ? raw.pixelPitchMm : null,
			mapping: {
				outputId: mapping.outputId ?? null,
				region: {
					x: finite(mapping.region?.x, 0),
					y: finite(mapping.region?.y, 0),
					width: Math.max(1, Math.round(finite(mapping.region?.width, pixelWidth))),
					height: Math.max(1, Math.round(finite(mapping.region?.height, pixelHeight)))
				},
				autoRegion: mapping.autoRegion !== false,
				exportVisible: mapping.exportVisible !== false,
				scale: finite(mapping.scale, 1),
				offsetXPx: finite(mapping.offsetXPx, 0),
				offsetYPx: finite(mapping.offsetYPx, 0),
				notes: mapping.notes ?? ""
			}
		};
	});
	return {
		project: {
			schemaVersion: 2,
			meta: {
				id: source.meta?.id ?? newId("prj"),
				name: source.meta?.name ?? "Untitled Project",
				createdAt: source.meta?.createdAt ?? nowIso(),
				updatedAt: source.meta?.updatedAt ?? nowIso(),
				author: source.meta?.author ?? "",
				notes: source.meta?.notes ?? ""
			},
			stage,
			screens,
			groups: source.groups ?? [],
			outputs,
			settings: {
				autosaveEnabled: source.settings?.autosaveEnabled !== false,
				autosaveIntervalMs: finite(source.settings?.autosaveIntervalMs, 3e4),
				backupRetention: finite(source.settings?.backupRetention, 10),
				exportDirectory: source.settings?.exportDirectory ?? null
			}
		},
		migrations
	};
}
//#endregion
//#region src/shared/validation.ts
/**
* Validation limits.
*
* These are deliberate engineering limits that protect the application from values
* which would produce meaningless geometry or trigger enormous allocations. They are
* documented in the user manual ("Known limits").
*/
var LIMITS = {
	/** 1 mm .. 200 m per screen edge. */
	minDimensionMm: 1,
	maxDimensionMm: 2e5,
	/** Stage itself may be up to 500 m. */
	minStageMm: 100,
	maxStageMm: 5e5,
	/** ±1 km from the stage origin. */
	maxCoordinateMm: 1e6,
	/** 1 .. 32768 px per edge (matches the largest practical LED wall resolution). */
	minPixel: 1,
	maxPixel: 32768,
	/** Refuse any screen whose pixel count would exceed this (guards allocations). */
	maxPixelCount: 67108864,
	/** LED pitch in millimetres. */
	minPixelPitchMm: .05,
	maxPixelPitchMm: 200,
	/** Rotation is normalised to [0, 360). */
	minRotationDeg: -3600,
	maxRotationDeg: 3600,
	/** Output device resolution. */
	minOutputPixel: 16,
	maxOutputPixel: 32768,
	/** 1000 .. 32000 logical canvas pixels per metre. */
	minCanvasPxPerMeter: 1e3,
	maxCanvasPxPerMeter: 32e3,
	/** Background opacity is a fraction. */
	minOpacity: 0,
	maxOpacity: 1,
	/** Grid spacing in millimetres. */
	minGridSpacingMm: 1,
	maxGridSpacingMm: 1e5,
	/** Snap tolerance in view pixels. */
	minSnapTolerancePx: 0,
	maxSnapTolerancePx: 60,
	/** Autosave interval. */
	minAutosaveMs: 5e3,
	maxAutosaveMs: 36e5,
	minBackupRetention: 1,
	maxBackupRetention: 200,
	/** Project name length. */
	maxNameLength: 120,
	maxNotesLength: 4e3
};
var OK = {
	ok: true,
	errors: {}
};
function fail(errors) {
	return {
		ok: false,
		errors
	};
}
function isFiniteInt(value) {
	return Number.isInteger(value) && Number.isFinite(value);
}
function numError(label, value, min, max, unit = "") {
	if (!Number.isFinite(value)) return `${label} must be a finite number.`;
	if (Number.isNaN(value)) return `${label} must be a number.`;
	if (value < min || value > max) return `${label} must be between ${min}${unit} and ${max}${unit}.`;
	return null;
}
/**
* Validates a single screen. Every rule reports a message next to the offending
* field so the inspector can place it inline.
*/
function validateScreen(screen) {
	const errors = {};
	const name = screen.name?.trim() ?? "";
	if (name.length === 0) errors.name = "Screen name is required.";
	else if (name.length > LIMITS.maxNameLength) errors.name = `Screen name must be ${LIMITS.maxNameLength} characters or fewer.`;
	const dimErrors = [[
		"widthMm",
		"Width",
		screen.widthMm,
		LIMITS.maxDimensionMm
	], [
		"heightMm",
		"Height",
		screen.heightMm,
		LIMITS.maxDimensionMm
	]];
	for (const [field, label, value, max] of dimErrors) {
		const message = numError(label, value, LIMITS.minDimensionMm, max, " mm");
		if (message) errors[field] = message;
	}
	if (numError("X", screen.xMm, -LIMITS.maxCoordinateMm, LIMITS.maxCoordinateMm, " mm")) errors.xMm = `X must be a finite value within ±${LIMITS.maxCoordinateMm} mm.`;
	if (numError("Y", screen.yMm, -LIMITS.maxCoordinateMm, LIMITS.maxCoordinateMm, " mm")) errors.yMm = `Y must be a finite value within ±${LIMITS.maxCoordinateMm} mm.`;
	if (numError("Rotation", screen.rotationDeg, LIMITS.minRotationDeg, LIMITS.maxRotationDeg, "°")) errors.rotationDeg = `Rotation must be a finite value between ${LIMITS.minRotationDeg}° and ${LIMITS.maxRotationDeg}°.`;
	if (!isFiniteInt(screen.pixelWidth)) errors.pixelWidth = "Pixel width must be a whole number.";
	else if (screen.pixelWidth < LIMITS.minPixel || screen.pixelWidth > LIMITS.maxPixel) errors.pixelWidth = `Pixel width must be between ${LIMITS.minPixel} and ${LIMITS.maxPixel}.`;
	if (!isFiniteInt(screen.pixelHeight)) errors.pixelHeight = "Pixel height must be a whole number.";
	else if (screen.pixelHeight < LIMITS.minPixel || screen.pixelHeight > LIMITS.maxPixel) errors.pixelHeight = `Pixel height must be between ${LIMITS.minPixel} and ${LIMITS.maxPixel}.`;
	if (screen.pixelWidth > 0 && screen.pixelHeight > 0 && screen.pixelWidth * screen.pixelHeight > LIMITS.maxPixelCount) errors.pixelHeight = `Total pixel count exceeds ${LIMITS.maxPixelCount.toLocaleString()} px (${screen.pixelWidth} × ${screen.pixelHeight}).`;
	if (screen.pixelPitchMm !== null) {
		if (!Number.isFinite(screen.pixelPitchMm)) errors.pixelPitchMm = "Pixel pitch must be a finite number.";
		else if (screen.pixelPitchMm < LIMITS.minPixelPitchMm || screen.pixelPitchMm > LIMITS.maxPixelPitchMm) errors.pixelPitchMm = `Pixel pitch must be between ${LIMITS.minPixelPitchMm} mm and ${LIMITS.maxPixelPitchMm} mm.`;
	}
	if ((screen.notes?.length ?? 0) > LIMITS.maxNotesLength) errors.notes = `Notes must be ${LIMITS.maxNotesLength} characters or fewer.`;
	return Object.keys(errors).length ? fail(errors) : OK;
}
function isValidOutputSize(width, height) {
	return isFiniteInt(width) && isFiniteInt(height) && width >= LIMITS.minOutputPixel && width <= LIMITS.maxOutputPixel && height >= LIMITS.minOutputPixel && height <= LIMITS.maxOutputPixel && width * height <= LIMITS.maxPixelCount;
}
function validateOutput(output) {
	if (!output.name.trim()) return "Output name is required.";
	if (!isValidOutputSize(output.width, output.height)) return `Output resolution must be between ${LIMITS.minOutputPixel} and ${LIMITS.maxOutputPixel} px per edge.`;
	return null;
}
/** Whole-project sanity check, surfaced by Tools -> Validate Project. */
function validateProject(project) {
	const errors = [];
	const warnings = [];
	if (project.screens.length === 0) warnings.push("This project has no screens yet.");
	if (!Number.isFinite(project.stage.widthMm) || !Number.isFinite(project.stage.heightMm) || project.stage.widthMm < LIMITS.minStageMm || project.stage.heightMm < LIMITS.minStageMm) errors.push(`Stage dimensions must be at least ${LIMITS.minStageMm} mm and finite. Current: ${project.stage.widthMm} × ${project.stage.heightMm} mm.`);
	if (project.stage.widthMm > LIMITS.maxStageMm || project.stage.heightMm > LIMITS.maxStageMm) errors.push(`Stage dimensions may not exceed ${LIMITS.maxStageMm} mm.`);
	const ids = /* @__PURE__ */ new Set();
	for (const screen of project.screens) {
		if (ids.has(screen.id)) errors.push(`Duplicate screen identifier detected: ${screen.id}.`);
		ids.add(screen.id);
		const result = validateScreen(screen);
		if (!result.ok) {
			const fields = Object.entries(result.errors).map(([field, message]) => `${field}: ${message}`).join(" ");
			errors.push(`Screen "${screen.name || screen.id}" is invalid. ${fields}`);
		}
	}
	const outputIds = new Set(project.outputs.map((o) => o.id));
	for (const output of project.outputs) {
		const message = validateOutput(output);
		if (message) errors.push(`Output "${output.name}": ${message}`);
	}
	for (const screen of project.screens) {
		const outputId = screen.mapping.outputId;
		if (outputId && !outputIds.has(outputId)) errors.push(`Screen "${screen.name}" is assigned to a mapping output that no longer exists. Reassign it in Pixel Mapping.`);
	}
	if (project.stage.background.assetMissing) warnings.push("The stage background image could not be found on disk.");
	return {
		ok: errors.length === 0,
		errors,
		warnings
	};
}
//#endregion
//#region src/shared/shortcuts.ts
var SHORTCUT_ACTIONS = [
	{
		id: "file.new",
		label: "New Project",
		description: "Create a new CuePoint project.",
		default: "CmdOrCtrl+N",
		category: "File",
		owner: "main"
	},
	{
		id: "file.open",
		label: "Open Project",
		description: "Open an existing CuePoint project file.",
		default: "CmdOrCtrl+O",
		category: "File",
		owner: "main"
	},
	{
		id: "file.save",
		label: "Save",
		description: "Save the current project to disk.",
		default: "CmdOrCtrl+S",
		category: "File",
		owner: "main"
	},
	{
		id: "file.saveAs",
		label: "Save As",
		description: "Save the project to a new file.",
		default: "CmdOrCtrl+Shift+S",
		category: "File",
		owner: "main"
	},
	{
		id: "file.importBackground",
		label: "Import Background",
		description: "Load a stage photograph as the stage background.",
		default: "CmdOrCtrl+Shift+I",
		category: "File",
		owner: "main"
	},
	{
		id: "file.export",
		label: "Export Maps",
		description: "Export pixel maps, guides and data.",
		default: "CmdOrCtrl+E",
		category: "File",
		owner: "main"
	},
	{
		id: "file.projectProperties",
		label: "Project Properties",
		description: "Edit project name, author and stage dimensions.",
		default: "CmdOrCtrl+Alt+P",
		category: "File",
		owner: "main"
	},
	{
		id: "file.revealProject",
		label: "Reveal Project Folder",
		description: "Open the project folder in File Explorer.",
		default: "CmdOrCtrl+Alt+R",
		category: "File",
		owner: "main"
	},
	{
		id: "app.exit",
		label: "Exit",
		description: "Close CuePoint.",
		default: "Alt+F4",
		category: "File",
		owner: "main"
	},
	{
		id: "edit.undo",
		label: "Undo",
		description: "Undo the last stage change.",
		default: "CmdOrCtrl+Z",
		category: "Edit",
		owner: "renderer"
	},
	{
		id: "edit.redo",
		label: "Redo",
		description: "Redo the last undone change.",
		default: "CmdOrCtrl+Shift+Z",
		category: "Edit",
		owner: "renderer"
	},
	{
		id: "edit.cut",
		label: "Cut",
		description: "Cut the selected screens.",
		default: "CmdOrCtrl+X",
		category: "Edit",
		owner: "renderer"
	},
	{
		id: "edit.copy",
		label: "Copy",
		description: "Copy the selected screens.",
		default: "CmdOrCtrl+C",
		category: "Edit",
		owner: "renderer"
	},
	{
		id: "edit.paste",
		label: "Paste",
		description: "Paste screens from the clipboard.",
		default: "CmdOrCtrl+V",
		category: "Edit",
		owner: "renderer"
	},
	{
		id: "edit.duplicate",
		label: "Duplicate",
		description: "Duplicate the selected screens.",
		default: "CmdOrCtrl+D",
		category: "Edit",
		owner: "renderer"
	},
	{
		id: "edit.selectAll",
		label: "Select All",
		description: "Select every screen on the stage.",
		default: "CmdOrCtrl+A",
		category: "Edit",
		owner: "renderer"
	},
	{
		id: "edit.clearSelection",
		label: "Clear Selection",
		description: "Deselect all screens and cancel the active drag.",
		default: "Escape",
		category: "Edit",
		owner: "renderer"
	},
	{
		id: "edit.delete",
		label: "Delete",
		description: "Delete the selected screens (undoable).",
		default: "Delete",
		category: "Edit",
		owner: "renderer"
	},
	{
		id: "edit.preferences",
		label: "Settings",
		description: "Open CuePoint settings.",
		default: "CmdOrCtrl+,",
		category: "Edit",
		owner: "main"
	},
	{
		id: "view.zoomIn",
		label: "Zoom In",
		description: "Zoom the canvas in.",
		default: "CmdOrCtrl+=",
		category: "View",
		owner: "main"
	},
	{
		id: "view.zoomOut",
		label: "Zoom Out",
		description: "Zoom the canvas out.",
		default: "CmdOrCtrl+-",
		category: "View",
		owner: "main"
	},
	{
		id: "view.fitStage",
		label: "Fit Stage",
		description: "Zoom the canvas to show the complete stage.",
		default: "CmdOrCtrl+0",
		category: "View",
		owner: "main"
	},
	{
		id: "view.fitSelection",
		label: "Fit Selection",
		description: "Zoom the canvas to the selected screens.",
		default: "CmdOrCtrl+Shift+0",
		category: "View",
		owner: "main"
	},
	{
		id: "view.resetView",
		label: "Reset View",
		description: "Restore 100% zoom and the origin.",
		default: "CmdOrCtrl+Alt+0",
		category: "View",
		owner: "main"
	},
	{
		id: "view.toggleGrid",
		label: "Show Grid",
		description: "Show or hide the stage grid.",
		default: "CmdOrCtrl+G",
		category: "View",
		owner: "main"
	},
	{
		id: "view.toggleSnap",
		label: "Snap to Grid",
		description: "Enable or disable snapping.",
		default: "CmdOrCtrl+Shift+G",
		category: "View",
		owner: "main"
	},
	{
		id: "view.toggleGuides",
		label: "Show Guides",
		description: "Show or hide alignment guides.",
		default: "CmdOrCtrl+;",
		category: "View",
		owner: "main"
	},
	{
		id: "view.toggleLeftPanel",
		label: "Toggle Left Panel",
		description: "Show or hide the navigation panel.",
		default: "CmdOrCtrl+B",
		category: "View",
		owner: "main"
	},
	{
		id: "view.toggleInspector",
		label: "Toggle Inspector",
		description: "Show or hide the property inspector.",
		default: "CmdOrCtrl+Shift+B",
		category: "View",
		owner: "main"
	},
	{
		id: "view.fullscreen",
		label: "Fullscreen",
		description: "Toggle fullscreen window mode.",
		default: "F11",
		category: "View",
		owner: "main"
	},
	{
		id: "tools.home",
		label: "Home",
		description: "Open the Home workspace.",
		default: "Alt+1",
		category: "Tools",
		owner: "main"
	},
	{
		id: "tools.stageDesigner",
		label: "Stage Designer",
		description: "Open the Stage Designer workspace.",
		default: "Alt+2",
		category: "Tools",
		owner: "main"
	},
	{
		id: "tools.pixelMapping",
		label: "Pixel Mapping",
		description: "Open the Pixel Mapping workspace.",
		default: "Alt+3",
		category: "Tools",
		owner: "main"
	},
	{
		id: "tools.ndiStudio",
		label: "NDI Studio",
		description: "Open the NDI Studio workspace.",
		default: "Alt+4",
		category: "Tools",
		owner: "main"
	},
	{
		id: "tools.recording",
		label: "Recording",
		description: "Open the Recording workspace.",
		default: "Alt+5",
		category: "Tools",
		owner: "main"
	},
	{
		id: "tools.settings",
		label: "Settings",
		description: "Open Settings.",
		default: "Alt+6",
		category: "Tools",
		owner: "main"
	},
	{
		id: "tools.diagnostics",
		label: "Diagnostics",
		description: "Open the diagnostics dashboard.",
		default: "Alt+7",
		category: "Tools",
		owner: "main"
	},
	{
		id: "tools.help",
		label: "Help",
		description: "Open Help and documentation.",
		default: "Alt+8",
		category: "Tools",
		owner: "main"
	},
	{
		id: "tools.validateProject",
		label: "Validate Project",
		description: "Run project validation and show the report.",
		default: "F7",
		category: "Tools",
		owner: "main"
	},
	{
		id: "tools.validateMapping",
		label: "Validate Mapping",
		description: "Run mapping validation and show the report.",
		default: "Shift+F7",
		category: "Tools",
		owner: "main"
	},
	{
		id: "screen.add",
		label: "Add Screen",
		description: "Add a new LED screen to the stage.",
		default: "CmdOrCtrl+Shift+N",
		category: "Screens",
		owner: "main"
	},
	{
		id: "screen.rename",
		label: "Rename Screen",
		description: "Rename the selected screen.",
		default: "F2",
		category: "Screens",
		owner: "renderer"
	},
	{
		id: "screen.lock",
		label: "Lock Screen",
		description: "Prevent the selected screens from being moved, resized or rotated.",
		default: "CmdOrCtrl+L",
		category: "Screens",
		owner: "main"
	},
	{
		id: "screen.hide",
		label: "Hide Screen",
		description: "Hide the selected screens on the stage.",
		default: "CmdOrCtrl+Shift+H",
		category: "Screens",
		owner: "main"
	},
	{
		id: "screen.duplicate",
		label: "Duplicate Screen",
		description: "Duplicate the selected screens with new identifiers.",
		default: "CmdOrCtrl+Shift+D",
		category: "Screens",
		owner: "main"
	},
	{
		id: "ndi.refresh",
		label: "Refresh NDI Sources",
		description: "Re-scan the network for NDI sources.",
		default: "F5",
		category: "NDI",
		owner: "main"
	},
	{
		id: "ndi.connect",
		label: "Connect Selected Source",
		description: "Connect the highlighted NDI source.",
		default: "CmdOrCtrl+Enter",
		category: "NDI",
		owner: "main"
	},
	{
		id: "ndi.disconnectAll",
		label: "Disconnect All Sources",
		description: "Disconnect every NDI source without stopping others.",
		default: "CmdOrCtrl+Shift+Enter",
		category: "NDI",
		owner: "main"
	},
	{
		id: "recording.start",
		label: "Start Recording",
		description: "Begin capturing the selected target.",
		default: "F9",
		category: "Recording",
		owner: "main"
	},
	{
		id: "recording.stop",
		label: "Stop Recording",
		description: "Stop capture and finalise the recording file.",
		default: "Shift+F9",
		category: "Recording",
		owner: "main"
	},
	{
		id: "recording.openFolder",
		label: "Open Output Folder",
		description: "Open the recording output folder.",
		default: "CmdOrCtrl+Alt+O",
		category: "Recording",
		owner: "main"
	},
	{
		id: "help.manual",
		label: "User Manual",
		description: "Open the CuePoint user manual.",
		default: "F1",
		category: "Help",
		owner: "main"
	},
	{
		id: "help.shortcuts",
		label: "Keyboard Shortcuts",
		description: "Show the shortcut reference.",
		default: "Shift+F1",
		category: "Help",
		owner: "main"
	},
	{
		id: "help.troubleshooting",
		label: "Troubleshooting",
		description: "Open the troubleshooting guide.",
		default: "Shift+F2",
		category: "Help",
		owner: "main"
	},
	{
		id: "help.copyDiagnostics",
		label: "Copy Diagnostic Report",
		description: "Copy a full diagnostic report to the clipboard.",
		default: "CmdOrCtrl+Shift+C",
		category: "Help",
		owner: "main"
	},
	{
		id: "help.openLogs",
		label: "Open Logs Folder",
		description: "Open the CuePoint log folder.",
		default: "CmdOrCtrl+Shift+L",
		category: "Help",
		owner: "main"
	},
	{
		id: "help.about",
		label: "About CuePoint",
		description: "Show version and licence information.",
		default: "Shift+F3",
		category: "Help",
		owner: "main"
	}
];
var DEFAULT_SHORTCUTS = Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action.id, action.default]));
var SHORTCUT_BY_ID = Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action.id, action]));
function createDefaultSettings() {
	return {
		schemaVersion: 1,
		theme: "dark",
		accent: "#4c8dff",
		reduceMotion: false,
		defaultUnit: "m",
		autosaveEnabled: true,
		autosaveIntervalMs: 3e4,
		backupRetention: 10,
		projectDirectory: null,
		recentProjectLimit: 12,
		grid: {
			visible: true,
			spacingMm: 500,
			majorEvery: 4,
			subdivisions: 4,
			snapToGrid: true,
			snapToScreens: true,
			snapToStage: true,
			tolerancePx: 8,
			guidesVisible: true,
			rulersVisible: true
		},
		ndi: {
			previewFps: 30,
			colorFormat: "rgba",
			autoStartHelper: true,
			discoveryTimeoutMs: 5e3,
			bandwidth: "native",
			autoReconnect: true,
			frameQueueLimit: 2,
			dllPathOverride: null
		},
		recording: {
			target: "stage",
			screenId: null,
			ndiSourceId: null,
			width: 1920,
			height: 1080,
			fps: 30,
			container: "webm",
			bitrateMbps: 24,
			captureAudio: false,
			outputDirectory: null,
			fileNameTemplate: "CuePoint_{project}_{target}_{date}_{time}",
			transcodeToMp4: false
		},
		export: {
			directory: null,
			mapScalePercent: 100,
			includeGrid: true,
			includeLabels: true,
			includeBorders: true,
			csvDelimiter: ",",
			jsonIndent: 2,
			perScreenGuides: true,
			stageLayout: true
		},
		performance: {
			maxPreviewSources: 4,
			frameQueueLimit: 2,
			verboseDiagnostics: false,
			statsWindowMs: 2e3
		},
		advanced: {
			logLevel: "info",
			keepLogFiles: 10
		},
		shortcuts: { ...DEFAULT_SHORTCUTS }
	};
}
function bool(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}
function num(value, fallback, min, max) {
	return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}
function str(value, allowed, fallback) {
	return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
/**
* Merges persisted settings over the defaults, clamping anything out of range.
* Never throws: a corrupt settings file degrades to defaults instead of blocking launch.
*/
function normalizeSettings(raw) {
	const defaults = createDefaultSettings();
	if (!raw || typeof raw !== "object") return defaults;
	const input = raw;
	const shortcuts = { ...DEFAULT_SHORTCUTS };
	if (input.shortcuts && typeof input.shortcuts === "object") {
		for (const [key, value] of Object.entries(input.shortcuts)) if (typeof value === "string" && value.trim().length > 0) shortcuts[key] = value.trim();
	}
	return {
		schemaVersion: 1,
		theme: str(input.theme, [
			"dark",
			"light",
			"system"
		], defaults.theme),
		accent: typeof input.accent === "string" ? input.accent : defaults.accent,
		reduceMotion: bool(input.reduceMotion, defaults.reduceMotion),
		defaultUnit: str(input.defaultUnit, [
			"mm",
			"cm",
			"m",
			"in",
			"ft"
		], defaults.defaultUnit),
		autosaveEnabled: bool(input.autosaveEnabled, defaults.autosaveEnabled),
		autosaveIntervalMs: num(input.autosaveIntervalMs, defaults.autosaveIntervalMs, LIMITS.minAutosaveMs, LIMITS.maxAutosaveMs),
		backupRetention: Math.round(num(input.backupRetention, defaults.backupRetention, LIMITS.minBackupRetention, LIMITS.maxBackupRetention)),
		projectDirectory: typeof input.projectDirectory === "string" ? input.projectDirectory : null,
		recentProjectLimit: Math.round(num(input.recentProjectLimit, defaults.recentProjectLimit, 3, 50)),
		grid: {
			visible: bool(input.grid?.visible, defaults.grid.visible),
			spacingMm: num(input.grid?.spacingMm, defaults.grid.spacingMm, LIMITS.minGridSpacingMm, LIMITS.maxGridSpacingMm),
			majorEvery: Math.round(num(input.grid?.majorEvery, defaults.grid.majorEvery, 1, 20)),
			subdivisions: Math.round(num(input.grid?.subdivisions, defaults.grid.subdivisions, 1, 20)),
			snapToGrid: bool(input.grid?.snapToGrid, defaults.grid.snapToGrid),
			snapToScreens: bool(input.grid?.snapToScreens, defaults.grid.snapToScreens),
			snapToStage: bool(input.grid?.snapToStage, defaults.grid.snapToStage),
			tolerancePx: num(input.grid?.tolerancePx, defaults.grid.tolerancePx, LIMITS.minSnapTolerancePx, LIMITS.maxSnapTolerancePx),
			guidesVisible: bool(input.grid?.guidesVisible, defaults.grid.guidesVisible),
			rulersVisible: bool(input.grid?.rulersVisible, defaults.grid.rulersVisible)
		},
		ndi: {
			previewFps: Math.round(num(input.ndi?.previewFps, defaults.ndi.previewFps, 1, 120)),
			colorFormat: str(input.ndi?.colorFormat, [
				"rgba",
				"bgra",
				"uyvy"
			], defaults.ndi.colorFormat),
			autoStartHelper: bool(input.ndi?.autoStartHelper, defaults.ndi.autoStartHelper),
			discoveryTimeoutMs: Math.round(num(input.ndi?.discoveryTimeoutMs, defaults.ndi.discoveryTimeoutMs, 500, 6e4)),
			bandwidth: str(input.ndi?.bandwidth, ["native", "throughput"], defaults.ndi.bandwidth),
			autoReconnect: bool(input.ndi?.autoReconnect, defaults.ndi.autoReconnect),
			frameQueueLimit: Math.round(num(input.ndi?.frameQueueLimit, defaults.ndi.frameQueueLimit, 1, 8)),
			dllPathOverride: typeof input.ndi?.dllPathOverride === "string" && input.ndi.dllPathOverride.trim() ? input.ndi.dllPathOverride.trim() : null
		},
		recording: {
			target: str(input.recording?.target, [
				"stage",
				"screen",
				"ndi"
			], defaults.recording.target),
			screenId: typeof input.recording?.screenId === "string" ? input.recording.screenId : null,
			ndiSourceId: typeof input.recording?.ndiSourceId === "string" ? input.recording.ndiSourceId : null,
			width: Math.round(num(input.recording?.width, defaults.recording.width, 64, 8192)),
			height: Math.round(num(input.recording?.height, defaults.recording.height, 64, 8192)),
			fps: Math.round(num(input.recording?.fps, defaults.recording.fps, 1, 120)),
			container: str(input.recording?.container, ["webm", "mp4"], defaults.recording.container),
			bitrateMbps: num(input.recording?.bitrateMbps, defaults.recording.bitrateMbps, 1, 200),
			captureAudio: bool(input.recording?.captureAudio, defaults.recording.captureAudio),
			outputDirectory: typeof input.recording?.outputDirectory === "string" ? input.recording.outputDirectory : null,
			fileNameTemplate: typeof input.recording?.fileNameTemplate === "string" && input.recording.fileNameTemplate.trim().length > 0 ? input.recording.fileNameTemplate : defaults.recording.fileNameTemplate,
			transcodeToMp4: bool(input.recording?.transcodeToMp4, defaults.recording.transcodeToMp4)
		},
		export: {
			directory: typeof input.export?.directory === "string" ? input.export.directory : null,
			mapScalePercent: Math.round(num(input.export?.mapScalePercent, defaults.export.mapScalePercent, 5, 400)),
			includeGrid: bool(input.export?.includeGrid, defaults.export.includeGrid),
			includeLabels: bool(input.export?.includeLabels, defaults.export.includeLabels),
			includeBorders: bool(input.export?.includeBorders, defaults.export.includeBorders),
			csvDelimiter: str(input.export?.csvDelimiter, [
				",",
				";",
				"	"
			], defaults.export.csvDelimiter),
			jsonIndent: Math.round(num(input.export?.jsonIndent, defaults.export.jsonIndent, 0, 8)),
			perScreenGuides: bool(input.export?.perScreenGuides, defaults.export.perScreenGuides),
			stageLayout: bool(input.export?.stageLayout, defaults.export.stageLayout)
		},
		performance: {
			maxPreviewSources: Math.round(num(input.performance?.maxPreviewSources, defaults.performance.maxPreviewSources, 1, 16)),
			frameQueueLimit: Math.round(num(input.performance?.frameQueueLimit, defaults.performance.frameQueueLimit, 1, 16)),
			verboseDiagnostics: bool(input.performance?.verboseDiagnostics, defaults.performance.verboseDiagnostics),
			statsWindowMs: Math.round(num(input.performance?.statsWindowMs, defaults.performance.statsWindowMs, 250, 3e4))
		},
		advanced: {
			logLevel: str(input.advanced?.logLevel, [
				"error",
				"warn",
				"info",
				"debug"
			], defaults.advanced.logLevel),
			keepLogFiles: Math.round(num(input.advanced?.keepLogFiles, defaults.advanced.keepLogFiles, 1, 90))
		},
		shortcuts
	};
}
//#endregion
//#region src/main/services/errors.ts
/**
* Every failure that crosses the IPC boundary is normalised into an `IpcError`.
* The renderer only ever receives a `{ ok: false, error }` envelope, never a raw throw,
* because Electron only serialises `Error.message` and loses the rest.
*/
var AppError = class extends Error {
	code;
	hint;
	detail;
	constructor(code, message, options = {}) {
		super(message);
		this.name = "AppError";
		this.code = code;
		if (options.hint) this.hint = options.hint;
		if (options.detail) this.detail = options.detail;
	}
};
var FS_CODES = {
	EACCES: {
		code: "E_PERMISSION",
		hint: "Choose a folder you have write access to, then try again."
	},
	EPERM: {
		code: "E_PERMISSION",
		hint: "Close any program using the file and try again."
	},
	ENOSPC: {
		code: "E_DISK_FULL",
		hint: "Free up disk space and try again."
	},
	ENOENT: {
		code: "E_NOT_FOUND",
		hint: "The file or folder no longer exists. Locate it again."
	},
	EBUSY: {
		code: "E_IO",
		hint: "The file is in use by another program. Close it and retry."
	},
	EISDIR: {
		code: "E_IO",
		hint: "A folder was supplied where a file was expected."
	},
	ENOTDIR: {
		code: "E_IO",
		hint: "A file was supplied where a folder was expected."
	},
	EEXIST: {
		code: "E_IO",
		hint: "A file with that name already exists."
	},
	EMFILE: {
		code: "E_IO",
		hint: "Too many files are open. Restart CuePoint and try again."
	}
};
function toIpcError(error) {
	if (error instanceof AppError) return {
		code: error.code,
		message: error.message,
		...error.hint ? { hint: error.hint } : {},
		...error.detail ? { detail: error.detail } : {}
	};
	const err = error;
	const fsCode = err?.code && FS_CODES[err.code] ? FS_CODES[err.code] : null;
	if (fsCode) return {
		code: fsCode.code,
		message: friendlyFsMessage(err),
		hint: fsCode.hint,
		detail: `${err.code}: ${err.message ?? "unknown"}`
	};
	return {
		code: "E_INTERNAL",
		message: err?.message ? String(err.message) : "An unexpected internal error occurred.",
		hint: "Try the action again. If it keeps failing, open Help → Troubleshooting and copy the diagnostic report.",
		detail: typeof error === "object" && error !== null ? String(error.stack ?? "") : String(error)
	};
}
function friendlyFsMessage(err) {
	const target = err.path ? ` "${err.path}"` : "";
	switch (err.code) {
		case "EACCES":
		case "EPERM": return `CuePoint does not have permission to write to${target}.`;
		case "ENOSPC": return `There is not enough free disk space to write${target}.`;
		case "ENOENT": return `The file or folder${target} could not be found.`;
		case "EBUSY": return `The file${target} is in use by another program.`;
		default: return `A file system error occurred while accessing${target}.`;
	}
}
function ok(data) {
	return {
		ok: true,
		data
	};
}
/** Wraps a handler so it can never reject across the IPC boundary. */
async function guard(scope, fn) {
	try {
		return ok(await fn());
	} catch (error) {
		const ipcError = toIpcError(error);
		const logger = getLogger();
		if (ipcError.code === "E_INTERNAL") logger.error(scope, ipcError.message, ipcError.detail);
		else logger.warn(scope, `${ipcError.code}: ${ipcError.message}`, ipcError.detail);
		return {
			ok: false,
			error: ipcError
		};
	}
}
function assert(condition, message, code = "E_INVALID_INPUT") {
	if (!condition) throw new AppError(code, message);
}
function requireString(value, label, maxLength = 4096) {
	assert(typeof value === "string" && value.trim().length > 0, `${label} is required.`);
	const trimmed = value.trim();
	assert(trimmed.length <= maxLength, `${label} must be ${maxLength} characters or fewer.`);
	return trimmed;
}
//#endregion
//#region src/main/services/sqlite.ts
var sqlJsPromise = null;
/**
* Loads the SQLite engine (sql.js: SQLite compiled to WebAssembly).
*
* A WASM build is used deliberately instead of a native addon: CuePoint ships a
* Windows installer, and a native module would require an MSVC/Electron-ABI rebuild
* on every machine. sql.js is the real SQLite engine, so the on-disk files remain
* ordinary SQLite databases that any SQLite tool can open.
*/
async function loadSqlEngine(wasmPath) {
	if (!sqlJsPromise) sqlJsPromise = (0, sql_js.default)({ locateFile: () => wasmPath });
	try {
		return await sqlJsPromise;
	} catch (error) {
		sqlJsPromise = null;
		throw new AppError("E_DB", "The SQLite engine could not be initialised.", {
			hint: "Reinstall CuePoint; the packaged sql.js payload appears to be missing or damaged.",
			detail: String(error)
		});
	}
}
/**
* Thin, typed wrapper around a sql.js database that owns its file.
* Writes are explicit (`persist`) and atomic (temp file + rename).
*/
var SqliteDb = class SqliteDb {
	filePath;
	db;
	writable;
	dirty = false;
	persistTimer = null;
	persistChain = Promise.resolve();
	closed = false;
	constructor(filePath, db, writable) {
		this.filePath = filePath;
		this.db = db;
		this.writable = writable;
	}
	static async open(filePath, options) {
		const SQL = await loadSqlEngine(options.wasmPath);
		const writable = options.writable !== false;
		await (0, node_fs_promises.mkdir)(node_path.default.dirname(filePath), { recursive: true });
		let data;
		try {
			data = new Uint8Array(await (0, node_fs_promises.readFile)(filePath));
		} catch (error) {
			if (error.code !== "ENOENT") throw new AppError("E_DB", `The database "${node_path.default.basename(filePath)}" could not be read.`, {
				hint: "Restore the file from a recovery snapshot, or restore your backup copy.",
				detail: String(error)
			});
		}
		let db;
		try {
			db = data && data.length > 0 ? new SQL.Database(data) : new SQL.Database();
		} catch (error) {
			throw new AppError("E_DB", `The database "${node_path.default.basename(filePath)}" is not a valid SQLite file.`, {
				hint: "Open a recovery snapshot instead (Home → Recover Project).",
				detail: String(error)
			});
		}
		const instance = new SqliteDb(filePath, db, writable);
		if (options.schema) instance.exec(options.schema);
		if (!data) instance.dirty = writable;
		return instance;
	}
	get sizeBytesFile() {
		return this.filePath;
	}
	exec(sql) {
		this.db.exec(sql);
		this.dirty = true;
	}
	run(sql, params = []) {
		const stmt = this.db.prepare(sql);
		try {
			stmt.bind(params);
			stmt.step();
		} finally {
			stmt.free();
		}
		this.dirty = true;
	}
	runMany(statements) {
		for (const statement of statements) this.run(statement.sql, statement.params ?? []);
	}
	query(sql, params = []) {
		const stmt = this.db.prepare(sql);
		const rows = [];
		try {
			stmt.bind(params);
			while (stmt.step()) rows.push(stmt.getAsObject());
		} finally {
			stmt.free();
		}
		return rows;
	}
	one(sql, params = []) {
		return this.query(sql, params)[0] ?? null;
	}
	scalar(sql, params = []) {
		const row = this.one(sql, params);
		if (!row) return null;
		return Object.values(row)[0] ?? null;
	}
	/** Executes `fn` inside a transaction, rolling back on any error. */
	transaction(fn) {
		this.db.exec("BEGIN");
		try {
			const result = fn();
			this.db.exec("COMMIT");
			this.dirty = true;
			return result;
		} catch (error) {
			try {
				this.db.exec("ROLLBACK");
			} catch {}
			throw error;
		}
	}
	get isDirty() {
		return this.dirty;
	}
	get isWritable() {
		return this.writable;
	}
	async bytes() {
		return this.db.export();
	}
	/** Writes the database atomically. `backup` keeps a copy of the previous file. */
	async persist(options = {}) {
		if (!this.writable) throw new AppError("E_DB", "This database was opened read-only.");
		const run = async () => {
			const payload = this.db.export();
			const temp = `${this.filePath}.tmp`;
			await (0, node_fs_promises.writeFile)(temp, payload);
			if (options.backup) try {
				await (0, node_fs_promises.stat)(this.filePath);
				await (0, node_fs_promises.copyFile)(this.filePath, options.backupPath ?? `${this.filePath}.bak`);
			} catch {}
			await (0, node_fs_promises.rename)(temp, this.filePath);
			this.dirty = false;
			return payload.length;
		};
		const chained = this.persistChain.then(run, run);
		this.persistChain = chained;
		return chained;
	}
	/** Coalesces rapid writes into a single file write. */
	schedulePersist(delayMs = 250) {
		if (!this.writable) return;
		if (this.persistTimer) clearTimeout(this.persistTimer);
		this.persistTimer = setTimeout(() => {
			this.persistTimer = null;
			this.persist().catch(() => void 0);
		}, delayMs);
	}
	async close() {
		if (this.closed) return;
		this.closed = true;
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		if (this.writable && this.dirty) await this.persist().catch(() => void 0);
		this.db.close();
	}
	async fileBytes() {
		try {
			return (await (0, node_fs_promises.stat)(this.filePath)).size;
		} catch {
			return 0;
		}
	}
	async deleteFile() {
		await (0, node_fs_promises.unlink)(this.filePath).catch(() => void 0);
	}
};
//#endregion
//#region src/main/services/projectStore.ts
/** Project file extension. The file itself is an ordinary SQLite database. */
var PROJECT_EXTENSION = "cuepoint";
var LIBRARY_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS library_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recent_projects (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recovery_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  snapshot_path TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  screen_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  target TEXT NOT NULL,
  label TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  fps INTEGER NOT NULL,
  container TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  state TEXT NOT NULL,
  error TEXT,
  verification_json TEXT
);
`;
var PROJECT_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_meta (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS stage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  width_mm REAL NOT NULL,
  height_mm REAL NOT NULL,
  canvas_px_per_meter REAL NOT NULL,
  default_unit TEXT NOT NULL,
  grid_visible INTEGER NOT NULL,
  grid_spacing_mm REAL NOT NULL,
  grid_major_every INTEGER NOT NULL,
  grid_subdivisions INTEGER NOT NULL,
  snap_to_grid INTEGER NOT NULL,
  snap_to_screens INTEGER NOT NULL,
  snap_to_stage INTEGER NOT NULL,
  snap_tolerance_px REAL NOT NULL,
  guides_visible INTEGER NOT NULL,
  rulers_visible INTEGER NOT NULL,
  background_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS screens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  color TEXT NOT NULL,
  visible INTEGER NOT NULL,
  locked INTEGER NOT NULL,
  notes TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  group_id TEXT,
  x_mm REAL NOT NULL,
  y_mm REAL NOT NULL,
  width_mm REAL NOT NULL,
  height_mm REAL NOT NULL,
  rotation_deg REAL NOT NULL,
  pixel_width INTEGER NOT NULL,
  pixel_height INTEGER NOT NULL,
  pixel_pitch_mm REAL,
  map_output_id TEXT,
  map_x REAL NOT NULL,
  map_y REAL NOT NULL,
  map_width REAL NOT NULL,
  map_height REAL NOT NULL,
  map_auto_region INTEGER NOT NULL,
  map_export_visible INTEGER NOT NULL,
  map_scale REAL NOT NULL,
  map_offset_x REAL NOT NULL,
  map_offset_y REAL NOT NULL,
  map_notes TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS screens_order_idx ON screens (sort_order);
CREATE TABLE IF NOT EXISTS screen_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  visible INTEGER NOT NULL,
  locked INTEGER NOT NULL,
  collapsed INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS outputs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  notes TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  autosave_enabled INTEGER NOT NULL,
  autosave_interval_ms INTEGER NOT NULL,
  backup_retention INTEGER NOT NULL,
  export_directory TEXT
);
`;
function toInt(value, fallback = 0) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function toText(value, fallback = "") {
	return typeof value === "string" ? value : fallback;
}
function boolToInt(value) {
	return value ? 1 : 0;
}
/**
* Owns everything persistent: the library database (settings, recent projects,
* recording history, recovery snapshots) and one SQLite database per project.
*/
var ProjectStore = class {
	paths;
	logger;
	events;
	library = null;
	settings = createDefaultSettings();
	state = {
		project: createDefaultProject({ name: "Untitled Project" }),
		projectPath: null,
		dirty: false,
		lastSavedAt: null,
		autosaveAt: null
	};
	autosaveTimer = null;
	lastAutosaveAttempt = 0;
	constructor(paths, logger, events = {}) {
		this.paths = paths;
		this.logger = logger;
		this.events = events;
	}
	async init() {
		for (const dir of [
			this.paths.userData,
			this.paths.logs,
			this.paths.projects,
			this.paths.exports,
			this.paths.recordings,
			this.paths.assets,
			this.paths.tmp
		]) await (0, node_fs_promises.mkdir)(dir, { recursive: true });
		this.library = await SqliteDb.open(this.paths.library, {
			wasmPath: resolveSqlJsWasm(this.paths),
			schema: LIBRARY_SCHEMA,
			writable: true
		});
		const raw = this.library.one("SELECT value FROM library_meta WHERE key = ?", ["app_settings"]);
		if (raw?.value) try {
			this.settings = normalizeSettings(JSON.parse(raw.value));
		} catch (error) {
			this.logger.warn("settings", "Settings file was unreadable; defaults restored.", String(error));
			this.settings = createDefaultSettings();
		}
		if (!this.library.one("SELECT version FROM schema_version WHERE rowid = 1")) this.library.run("INSERT INTO schema_version (version) VALUES (?)", [1]);
		if (this.library.isDirty) await this.library.persist();
		this.startAutosaveTimer();
		this.logger.info("store", "Library database ready.", this.paths.library);
	}
	async close() {
		this.stopAutosaveTimer();
		await this.library?.close();
		this.library = null;
	}
	getPaths() {
		return this.paths;
	}
	getSettings() {
		return structuredClone(this.settings);
	}
	async saveSettings(patch) {
		const merged = normalizeSettings({
			...this.settings,
			...patch,
			shortcuts: {
				...this.settings.shortcuts,
				...patch.shortcuts ?? {}
			}
		});
		this.settings = merged;
		this.library?.run("INSERT INTO library_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["app_settings", JSON.stringify(merged)]);
		await this.library?.persist();
		this.restartAutosaveTimerIfNeeded();
		return merged;
	}
	async setSetting(key, value) {
		return this.saveSettings({ [key]: value });
	}
	async recentProjects() {
		if (!this.library) return [];
		return this.library.query("SELECT path, name, opened_at, pinned FROM recent_projects ORDER BY pinned DESC, opened_at DESC LIMIT ?", [Math.max(3, this.settings.recentProjectLimit * 3)]).map((row) => ({
			path: row.path,
			name: row.name,
			openedAt: row.opened_at,
			pinned: row.pinned === 1,
			exists: (0, node_fs.existsSync)(row.path)
		}));
	}
	async rememberProject(projectPath, name) {
		if (!this.library) return;
		const rows = this.library.query("SELECT COUNT(*) AS c FROM recent_projects");
		this.library.run("INSERT INTO recent_projects (path, name, opened_at, pinned) VALUES (?, ?, ?, 0) ON CONFLICT(path) DO UPDATE SET name = excluded.name, opened_at = excluded.opened_at", [
			projectPath,
			name,
			nowIso()
		]);
		await this.library.persist();
		const limit = Math.max(3, this.settings.recentProjectLimit);
		if ((rows[0]?.c ?? 0) > limit) {
			this.library.run(`DELETE FROM recent_projects WHERE pinned = 0 AND path NOT IN (
           SELECT path FROM recent_projects ORDER BY pinned DESC, opened_at DESC LIMIT ?
         )`, [limit]);
			await this.library.persist();
		}
	}
	async forgetRecent(projectPath) {
		this.library?.run("DELETE FROM recent_projects WHERE path = ?", [projectPath]);
		await this.library?.persist();
	}
	async pinRecent(projectPath, pinned) {
		this.library?.run("UPDATE recent_projects SET pinned = ? WHERE path = ?", [boolToInt(pinned), projectPath]);
		await this.library?.persist();
	}
	getCurrent() {
		return this.state;
	}
	getProject() {
		return this.state.project;
	}
	getProjectPath() {
		return this.state.projectPath;
	}
	isDirty() {
		return this.state.dirty;
	}
	/** Replaces the in-memory project (renderer is authoritative for edits). */
	setProject(project, options = {}) {
		const normalized = {
			...project,
			schemaVersion: 2,
			meta: {
				...project.meta,
				updatedAt: nowIso()
			}
		};
		this.state.project = normalized;
		if (options.dirty !== false) {
			this.state.dirty = true;
			this.emitDirty();
		}
	}
	markClean(projectPath) {
		this.state.dirty = false;
		if (projectPath) this.state.projectPath = projectPath;
		this.emitDirty();
	}
	isProjectOpen() {
		return this.state.projectPath !== null;
	}
	async writeProjectFile(target, project) {
		const db = await SqliteDb.open(target, {
			wasmPath: resolveSqlJsWasm(this.paths),
			schema: PROJECT_SCHEMA
		});
		try {
			writeProjectInto(db, project);
			db.run("DELETE FROM schema_version");
			db.run("INSERT INTO schema_version (version) VALUES (?)", [2]);
			return await db.persist();
		} finally {
			await db.close();
		}
	}
	async createProject(request) {
		const directory = request.directory || this.settings.projectDirectory || this.paths.projects;
		await (0, node_fs_promises.mkdir)(directory, { recursive: true });
		const safeName = sanitiseFileName(request.name);
		const target = uniquePath(node_path.default.join(directory, `${safeName}.${PROJECT_EXTENSION}`));
		const outputs = request.outputs?.length ? request.outputs.map((output) => createDefaultOutput({
			name: output.name,
			width: output.width,
			height: output.height
		})) : void 0;
		const project = createDefaultProject({
			name: request.name,
			author: request.author ?? "",
			stageWidthMm: request.stageWidthMm,
			stageHeightMm: request.stageHeightMm,
			defaultUnit: request.defaultUnit,
			backgroundAssetPath: request.backgroundAssetPath ?? null,
			initialScreenCount: request.initialScreenCount ?? 0,
			...outputs ? { outputs } : {}
		});
		const bytes = await this.writeProjectFile(target, project);
		this.state = {
			project,
			projectPath: target,
			dirty: false,
			lastSavedAt: nowIso(),
			autosaveAt: null
		};
		await this.library?.run("INSERT INTO library_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["last_project", target]);
		await this.library?.persist();
		await this.rememberProject(target, project.meta.name);
		this.emitDirty();
		this.logger.info("store", `Created project "${project.meta.name}".`, `${target} (${bytes} bytes)`);
		return {
			path: target,
			directory: node_path.default.dirname(target),
			migrations: [],
			missingAssets: [],
			backupPath: null
		};
	}
	async openProject(projectPath) {
		const resolved = node_path.default.resolve(projectPath);
		if (!(0, node_fs.existsSync)(resolved)) throw new AppError("E_NOT_FOUND", `The project file "${resolved}" could not be found.`, { hint: "Use Home → Recent Projects to locate it, or open a recovery snapshot." });
		const db = await SqliteDb.open(resolved, {
			wasmPath: resolveSqlJsWasm(this.paths),
			schema: PROJECT_SCHEMA,
			writable: false
		});
		let raw;
		try {
			raw = readProjectFrom(db);
		} finally {
			await db.close();
		}
		const { project, migrations } = migrateProject(raw);
		const missingAssets = this.findMissingAssets(project);
		project.stage.background.assetMissing = missingAssets.length > 0;
		this.state = {
			project,
			projectPath: resolved,
			dirty: false,
			lastSavedAt: nowIso(),
			autosaveAt: null
		};
		this.lastAutosaveAttempt = Date.now();
		await this.rememberProject(resolved, project.meta.name);
		this.library?.run("INSERT INTO library_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["last_project", resolved]);
		await this.library?.persist();
		this.emitDirty();
		if (migrations.length) {
			this.logger.info("store", "Project migrated.", migrations.join(" "));
			this.state.dirty = true;
			this.emitDirty();
		}
		if (missingAssets.length) this.events.onWarning?.(`${missingAssets.length} linked asset(s) could not be found.`, missingAssets.join("\n"));
		const bytes = await (0, node_fs_promises.stat)(resolved).then((s) => s.size).catch(() => 0);
		return {
			path: resolved,
			directory: node_path.default.dirname(resolved),
			migrations,
			missingAssets,
			backupPath: null,
			project,
			bytes
		};
	}
	/** Saves the current project. `backup` keeps a rolling copy of the previous file. */
	async saveCurrent(reason = "manual") {
		if (!this.state.projectPath) return null;
		const target = this.state.projectPath;
		const validation = validateProject(this.state.project);
		if (!validation.ok) this.logger.warn("store", `Project saved with ${validation.errors.length} validation error(s).`, validation.errors.join(" | "));
		const backupPath = `${target}.bak`;
		let bytes = 0;
		const db = await SqliteDb.open(target, {
			wasmPath: resolveSqlJsWasm(this.paths),
			schema: PROJECT_SCHEMA
		});
		try {
			writeProjectInto(db, this.state.project);
			db.run("DELETE FROM schema_version");
			db.run("INSERT INTO schema_version (version) VALUES (?)", [2]);
			bytes = await db.persist({
				backup: true,
				backupPath
			});
		} catch (error) {
			if (error.code === "ENOSPC") throw new AppError("E_DISK_FULL", "The project could not be saved because the disk is full.", { hint: "Free up disk space, then choose File → Save again. Your changes are still in memory." });
			throw error;
		} finally {
			await db.close();
		}
		const savedAt = nowIso();
		this.state.lastSavedAt = savedAt;
		this.state.dirty = false;
		if (reason === "autosave") this.state.autosaveAt = savedAt;
		this.lastAutosaveAttempt = Date.now();
		await this.rememberProject(target, this.state.project.meta.name);
		if (reason !== "manual") await this.createSnapshot(reason === "autosave" ? "autosave" : "manual", target);
		this.emitDirty();
		const result = {
			path: target,
			bytes,
			savedAt,
			backupPath: (0, node_fs.existsSync)(backupPath) ? backupPath : null,
			screenCount: this.state.project.screens.length
		};
		this.events.onProjectSaved?.(result);
		return result;
	}
	async saveAs(directory, name) {
		const dir = directory || (this.state.projectPath ? node_path.default.dirname(this.state.projectPath) : this.paths.projects);
		await (0, node_fs_promises.mkdir)(dir, { recursive: true });
		const projectName = name ?? this.state.project.meta.name;
		const target = uniquePath(node_path.default.join(dir, `${sanitiseFileName(projectName)}.${PROJECT_EXTENSION}`));
		if (this.state.projectPath && (0, node_fs.existsSync)(this.state.projectPath)) await (0, node_fs_promises.copyFile)(this.state.projectPath, target).catch(() => void 0);
		this.state.projectPath = target;
		this.state.project.meta.name = projectName;
		const result = await this.saveCurrent("manual");
		if (!result) throw new AppError("E_IO", "Save As failed: no target path was resolved.");
		this.logger.info("store", `Project saved as "${projectName}".`, target);
		return result;
	}
	async renameProject(newName) {
		const trimmed = newName.trim();
		if (!trimmed) throw new AppError("E_INVALID_INPUT", "Project name cannot be empty.");
		this.state.project.meta.name = trimmed;
		this.state.project.meta.updatedAt = nowIso();
		this.state.dirty = true;
		this.emitDirty();
		if (this.state.projectPath) await this.rememberProject(this.state.projectPath, trimmed);
		return this.state.project;
	}
	async duplicateProject(sourcePath, newName) {
		const opened = await this.openProject(sourcePath);
		const project = opened.project;
		project.meta.id = `${project.meta.id}-copy-${Date.now().toString(36)}`;
		project.meta.name = newName?.trim() || `${project.meta.name} copy`;
		project.meta.createdAt = nowIso();
		const directory = node_path.default.dirname(sourcePath);
		const target = uniquePath(node_path.default.join(directory, `${sanitiseFileName(project.meta.name)}.${PROJECT_EXTENSION}`));
		await this.writeProjectFile(target, project);
		return {
			...opened,
			path: target,
			project
		};
	}
	get recoveryDirectory() {
		return node_path.default.join(this.paths.userData, "recovery");
	}
	async createSnapshot(reason, projectPath) {
		const sourcePath = projectPath ?? this.state.projectPath;
		if (!sourcePath || !this.library) return null;
		if (!(0, node_fs.existsSync)(sourcePath)) return null;
		await (0, node_fs_promises.mkdir)(this.recoveryDirectory, { recursive: true });
		const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
		const base = node_path.default.basename(sourcePath, `.${PROJECT_EXTENSION}`);
		const snapshotPath = node_path.default.join(this.recoveryDirectory, `${base}_${reason}_${stamp}.${PROJECT_EXTENSION}`);
		await (0, node_fs_promises.copyFile)(sourcePath, snapshotPath);
		const bytes = (await (0, node_fs_promises.stat)(snapshotPath)).size;
		this.library.run(`INSERT INTO recovery_snapshots (project_path, snapshot_path, name, created_at, reason, bytes, screen_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [
			sourcePath,
			snapshotPath,
			this.state.project.meta.name,
			nowIso(),
			reason,
			bytes,
			this.state.project.screens.length
		]);
		await this.library.persist();
		const retention = Math.max(1, this.settings.backupRetention);
		const rows = this.library.query("SELECT id, snapshot_path FROM recovery_snapshots WHERE project_path = ? ORDER BY created_at DESC", [sourcePath]);
		for (const row of rows.slice(retention)) {
			await (0, node_fs_promises.unlink)(row.snapshot_path).catch(() => void 0);
			this.library.run("DELETE FROM recovery_snapshots WHERE id = ?", [row.id]);
		}
		if (rows.length > retention) await this.library.persist();
		return {
			id: 0,
			path: snapshotPath,
			projectPath: sourcePath,
			name: this.state.project.meta.name,
			createdAt: nowIso(),
			reason,
			bytes,
			screenCount: this.state.project.screens.length
		};
	}
	async snapshots(projectPath) {
		if (!this.library) return [];
		return this.library.query(projectPath ? "SELECT * FROM recovery_snapshots WHERE project_path = ? ORDER BY created_at DESC" : "SELECT * FROM recovery_snapshots ORDER BY created_at DESC LIMIT 200", projectPath ? [projectPath] : []).filter((row) => (0, node_fs.existsSync)(row.snapshot_path)).map((row) => ({
			id: row.id,
			path: row.snapshot_path,
			projectPath: row.project_path,
			name: row.name,
			createdAt: row.created_at,
			reason: row.reason ?? "manual",
			bytes: row.bytes,
			screenCount: row.screen_count
		}));
	}
	async deleteSnapshot(id) {
		if (!this.library) return false;
		const row = this.library.one("SELECT snapshot_path FROM recovery_snapshots WHERE id = ?", [id]);
		if (!row) return false;
		await (0, node_fs_promises.unlink)(row.snapshot_path).catch(() => void 0);
		this.library.run("DELETE FROM recovery_snapshots WHERE id = ?", [id]);
		await this.library.persist();
		return true;
	}
	recordingEntries() {
		if (!this.library) return [];
		return this.library.query("SELECT * FROM recordings ORDER BY started_at DESC LIMIT 200").map((row) => ({
			id: row.id,
			filePath: row.file_path,
			target: row.target,
			label: row.label,
			width: row.width,
			height: row.height,
			fps: row.fps,
			container: row.container,
			startedAt: row.started_at,
			finishedAt: row.finished_at,
			durationMs: row.duration_ms,
			sizeBytes: row.size_bytes,
			state: row.state,
			error: row.error,
			verified: row.verification_json ? JSON.parse(row.verification_json) : null
		}));
	}
	async upsertRecordingEntry(entry) {
		this.library?.run(`INSERT INTO recordings (id, file_path, target, label, width, height, fps, container, started_at, finished_at, duration_ms, size_bytes, state, error, verification_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET file_path = excluded.file_path, target = excluded.target, label = excluded.label,
         width = excluded.width, height = excluded.height, fps = excluded.fps, container = excluded.container,
         finished_at = excluded.finished_at, duration_ms = excluded.duration_ms, size_bytes = excluded.size_bytes,
         state = excluded.state, error = excluded.error, verification_json = excluded.verification_json`, [
			entry.id,
			entry.filePath,
			entry.target,
			entry.label,
			entry.width,
			entry.height,
			entry.fps,
			entry.container,
			entry.startedAt,
			entry.finishedAt,
			Math.round(entry.durationMs),
			Math.round(entry.sizeBytes),
			entry.state,
			entry.error,
			entry.verified ? JSON.stringify(entry.verified) : null
		]);
		await this.library?.persist();
	}
	async deleteRecordingEntry(id) {
		if (!this.library) return false;
		this.library.run("DELETE FROM recordings WHERE id = ?", [id]);
		await this.library.persist();
		return true;
	}
	startAutosaveTimer() {
		this.stopAutosaveTimer();
		if (!this.settings.autosaveEnabled) return;
		const interval = Math.max(5e3, this.settings.autosaveIntervalMs);
		this.autosaveTimer = setInterval(() => {
			this.runAutosave();
		}, interval);
		this.autosaveTimer.unref?.();
	}
	stopAutosaveTimer() {
		if (this.autosaveTimer) clearInterval(this.autosaveTimer);
		this.autosaveTimer = null;
	}
	restartAutosaveTimerIfNeeded() {
		this.startAutosaveTimer();
	}
	/**
	* Autosave runs entirely in the main process against its own copy of the project,
	* so it never blocks the renderer canvas. Requires an open project *and* changes.
	*/
	async runAutosave() {
		if (!this.settings.autosaveEnabled) return null;
		if (!this.state.projectPath || !this.state.dirty) return null;
		if (Date.now() - this.lastAutosaveAttempt < 2e3) return null;
		try {
			const result = await this.saveCurrent("autosave");
			this.logger.debug("store", "Autosave completed.", `${result?.bytes ?? 0} bytes`);
			return result;
		} catch (error) {
			this.logger.error("store", "Autosave failed.", String(error));
			this.events.onWarning?.("Autosave failed. Your project is still open and unsaved changes are preserved in memory.", String(error));
			return null;
		}
	}
	emitDirty() {
		this.events.onDirtyState?.({
			dirty: this.state.dirty,
			savedAt: this.state.lastSavedAt,
			autosaveAt: this.state.autosaveAt,
			path: this.state.projectPath
		});
	}
	findMissingAssets(project) {
		const missing = [];
		const background = project.stage.background.assetPath;
		if (background && !(0, node_fs.existsSync)(background)) missing.push(background);
		return missing;
	}
	summary() {
		if (!this.state.projectPath) return null;
		const summary = projectSummary(this.state.project, this.state.projectPath, 0);
		summary.exists = (0, node_fs.existsSync)(this.state.projectPath);
		summary.missingAssets = this.findMissingAssets(this.state.project).length;
		return summary;
	}
	async libraryStats() {
		const bytes = this.library ? await this.library.fileBytes() : 0;
		const recent = this.library?.scalar("SELECT COUNT(*) FROM recent_projects") ?? 0;
		const snapshots = this.library?.scalar("SELECT COUNT(*) FROM recovery_snapshots") ?? 0;
		return {
			bytes,
			recent: Number(recent),
			snapshots: Number(snapshots)
		};
	}
	async writeTextExport(directory, fileName, contents) {
		await (0, node_fs_promises.mkdir)(directory, { recursive: true });
		const target = node_path.default.join(directory, fileName);
		await (0, node_fs_promises.writeFile)(target, contents, "utf8");
		return target;
	}
	async cleanupTemporaryFiles() {
		try {
			const files = await (0, node_fs_promises.readdir)(this.paths.tmp);
			for (const file of files) await (0, node_fs_promises.unlink)(node_path.default.join(this.paths.tmp, file)).catch(() => void 0);
		} catch {}
	}
};
function writeProjectInto(db, project) {
	db.transaction(() => {
		db.run("DELETE FROM screens");
		db.run("DELETE FROM screen_groups");
		db.run("DELETE FROM outputs");
		db.run("DELETE FROM stage");
		db.run("DELETE FROM project_meta");
		db.run("DELETE FROM project_settings");
		db.run("INSERT INTO project_meta (id, name, author, created_at, updated_at, notes) VALUES (?, ?, ?, ?, ?, ?)", [
			project.meta.id,
			project.meta.name,
			project.meta.author,
			project.meta.createdAt,
			project.meta.updatedAt,
			project.meta.notes
		]);
		db.run(`INSERT INTO stage (id, name, width_mm, height_mm, canvas_px_per_meter, default_unit, grid_visible,
        grid_spacing_mm, grid_major_every, grid_subdivisions, snap_to_grid, snap_to_screens, snap_to_stage,
        snap_tolerance_px, guides_visible, rulers_visible, background_json)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
			project.stage.name,
			project.stage.widthMm,
			project.stage.heightMm,
			project.stage.canvasPxPerMeter,
			project.stage.defaultUnit,
			boolToInt(project.stage.gridVisible),
			project.stage.gridSpacingMm,
			project.stage.gridMajorEvery,
			project.stage.gridSubdivisions,
			boolToInt(project.stage.snapToGrid),
			boolToInt(project.stage.snapToScreens),
			boolToInt(project.stage.snapToStage),
			project.stage.snapTolerancePx,
			boolToInt(project.stage.guidesVisible),
			boolToInt(project.stage.rulersVisible),
			JSON.stringify(project.stage.background)
		]);
		for (const screen of project.screens) db.run(`INSERT INTO screens (id, name, type, color, visible, locked, notes, sort_order, group_id, x_mm, y_mm,
          width_mm, height_mm, rotation_deg, pixel_width, pixel_height, pixel_pitch_mm, map_output_id, map_x, map_y,
          map_width, map_height, map_auto_region, map_export_visible, map_scale, map_offset_x, map_offset_y, map_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
			screen.id,
			screen.name,
			screen.type,
			screen.color,
			boolToInt(screen.visible),
			boolToInt(screen.locked),
			screen.notes,
			screen.order,
			screen.groupId,
			screen.xMm,
			screen.yMm,
			screen.widthMm,
			screen.heightMm,
			screen.rotationDeg,
			Math.round(screen.pixelWidth),
			Math.round(screen.pixelHeight),
			screen.pixelPitchMm,
			screen.mapping.outputId,
			screen.mapping.region.x,
			screen.mapping.region.y,
			screen.mapping.region.width,
			screen.mapping.region.height,
			boolToInt(screen.mapping.autoRegion),
			boolToInt(screen.mapping.exportVisible),
			screen.mapping.scale,
			screen.mapping.offsetXPx,
			screen.mapping.offsetYPx,
			screen.mapping.notes
		]);
		for (const group of project.groups) db.run("INSERT INTO screen_groups (id, name, color, visible, locked, collapsed) VALUES (?, ?, ?, ?, ?, ?)", [
			group.id,
			group.name,
			group.color,
			boolToInt(group.visible),
			boolToInt(group.locked),
			boolToInt(group.collapsed)
		]);
		for (const output of project.outputs) db.run("INSERT INTO outputs (id, name, width, height, enabled, notes) VALUES (?, ?, ?, ?, ?, ?)", [
			output.id,
			output.name,
			Math.round(output.width),
			Math.round(output.height),
			boolToInt(output.enabled),
			output.notes
		]);
		db.run("INSERT INTO project_settings (id, autosave_enabled, autosave_interval_ms, backup_retention, export_directory) VALUES (1, ?, ?, ?, ?)", [
			boolToInt(project.settings.autosaveEnabled),
			project.settings.autosaveIntervalMs,
			project.settings.backupRetention,
			project.settings.exportDirectory
		]);
	});
}
/** Reads a project database into a plain payload for `migrateProject`. */
function readProjectFrom(db) {
	const meta = db.one("SELECT * FROM project_meta LIMIT 1");
	const stage = db.one("SELECT * FROM stage WHERE id = 1");
	const screenRows = db.query("SELECT * FROM screens ORDER BY sort_order ASC");
	const groupRows = db.query("SELECT * FROM screen_groups");
	const outputRows = db.query("SELECT * FROM outputs");
	const settingsRows = db.query("SELECT * FROM project_settings WHERE id = 1");
	const version = db.scalar("SELECT version FROM schema_version LIMIT 1");
	const screens = screenRows.map((row) => ({
		id: row.id,
		name: row.name,
		type: row.type,
		color: row.color,
		visible: row.visible === 1,
		locked: row.locked === 1,
		notes: toText(row.notes),
		order: toInt(row.sort_order),
		groupId: row.group_id ?? null,
		xMm: toInt(row.x_mm),
		yMm: toInt(row.y_mm),
		widthMm: toInt(row.width_mm, 2e3),
		heightMm: toInt(row.height_mm, 1e3),
		rotationDeg: toInt(row.rotation_deg),
		pixelWidth: Math.round(toInt(row.pixel_width, 800)),
		pixelHeight: Math.round(toInt(row.pixel_height, 400)),
		pixelPitchMm: typeof row.pixel_pitch_mm === "number" ? row.pixel_pitch_mm : null,
		mapping: {
			outputId: row.map_output_id ?? null,
			region: {
				x: toInt(row.map_x),
				y: toInt(row.map_y),
				width: toInt(row.map_width, 800),
				height: toInt(row.map_height, 400)
			},
			autoRegion: row.map_auto_region === 1,
			exportVisible: row.map_export_visible === 1,
			scale: toInt(row.map_scale, 1),
			offsetXPx: toInt(row.map_offset_x),
			offsetYPx: toInt(row.map_offset_y),
			notes: toText(row.map_notes)
		}
	}));
	const settings = settingsRows[0];
	return {
		schemaVersion: typeof version === "number" ? version : 1,
		meta: meta ? {
			id: toText(meta.id),
			name: toText(meta.name, "Untitled Project"),
			author: toText(meta.author),
			createdAt: toText(meta.created_at, nowIso()),
			updatedAt: toText(meta.updated_at, nowIso()),
			notes: toText(meta.notes)
		} : void 0,
		stage: stage ? {
			name: toText(stage.name, "Main Stage"),
			widthMm: toInt(stage.width_mm, 12e3),
			heightMm: toInt(stage.height_mm, 6e3),
			canvasPxPerMeter: toInt(stage.canvas_px_per_meter, 40),
			defaultUnit: toText(stage.default_unit, "m"),
			gridVisible: toInt(stage.grid_visible, 1) === 1,
			gridSpacingMm: toInt(stage.grid_spacing_mm, 500),
			gridMajorEvery: toInt(stage.grid_major_every, 4),
			gridSubdivisions: toInt(stage.grid_subdivisions, 4),
			snapToGrid: toInt(stage.snap_to_grid, 1) === 1,
			snapToScreens: toInt(stage.snap_to_screens, 1) === 1,
			snapToStage: toInt(stage.snap_to_stage, 1) === 1,
			snapTolerancePx: toInt(stage.snap_tolerance_px, 8),
			guidesVisible: toInt(stage.guides_visible, 1) === 1,
			rulersVisible: toInt(stage.rulers_visible, 1) === 1,
			background: safeJsonParse(toText(stage.background_json, "{}"), {})
		} : void 0,
		screens,
		groups: groupRows.map((row) => ({
			id: toText(row.id),
			name: toText(row.name),
			color: toText(row.color, "#4c8dff"),
			visible: toInt(row.visible, 1) === 1,
			locked: toInt(row.locked) === 1,
			collapsed: toInt(row.collapsed) === 1
		})),
		outputs: outputRows.map((row) => ({
			id: toText(row.id),
			name: toText(row.name, "Output"),
			width: Math.round(toInt(row.width, 1920)),
			height: Math.round(toInt(row.height, 1080)),
			enabled: toInt(row.enabled, 1) === 1,
			notes: toText(row.notes)
		})),
		settings: settings ? {
			autosaveEnabled: toInt(settings.autosave_enabled, 1) === 1,
			autosaveIntervalMs: toInt(settings.autosave_interval_ms, 3e4),
			backupRetention: toInt(settings.backup_retention, 10),
			exportDirectory: typeof settings.export_directory === "string" ? settings.export_directory : null
		} : void 0
	};
}
function safeJsonParse(value, fallback) {
	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
}
function sanitiseFileName(name) {
	return name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").replace(/\.+$/, "").slice(0, 80) || "Untitled Project";
}
function uniquePath(candidate) {
	if (!(0, node_fs.existsSync)(candidate)) return candidate;
	const dir = node_path.default.dirname(candidate);
	const ext = node_path.default.extname(candidate);
	const base = node_path.default.basename(candidate, ext);
	for (let i = 2; i < 500; i += 1) {
		const next = node_path.default.join(dir, `${base} (${i})${ext}`);
		if (!(0, node_fs.existsSync)(next)) return next;
	}
	return node_path.default.join(dir, `${base}-${Date.now()}${ext}`);
}
//#endregion
//#region src/shared/mapping.ts
function effectiveRegion(mapping) {
	const scale = Number.isFinite(mapping.scale) && mapping.scale > 0 ? mapping.scale : 1;
	return {
		x: mapping.region.x + (Number.isFinite(mapping.offsetXPx) ? mapping.offsetXPx : 0),
		y: mapping.region.y + (Number.isFinite(mapping.offsetYPx) ? mapping.offsetYPx : 0),
		width: Math.max(1, mapping.region.width * scale),
		height: Math.max(1, mapping.region.height * scale)
	};
}
function roundRegion(region) {
	return {
		x: Math.round(region.x),
		y: Math.round(region.y),
		width: Math.max(1, Math.round(region.width)),
		height: Math.max(1, Math.round(region.height))
	};
}
function blockForScreen(screen) {
	if (!screen.mapping.outputId) return null;
	return {
		screenId: screen.id,
		name: screen.name,
		color: screen.color,
		rect: roundRegion(effectiveRegion(screen.mapping)),
		native: {
			width: screen.pixelWidth,
			height: screen.pixelHeight
		},
		scaled: screen.mapping.region.width !== screen.pixelWidth || screen.mapping.region.height !== screen.pixelHeight || screen.mapping.scale !== 1,
		exportVisible: screen.mapping.exportVisible,
		screenVisible: screen.visible,
		locked: screen.locked
	};
}
/** Counts distinct pixels covered by a set of rects, clamped to the output bounds. */
function coveredPixelCount(rects, output) {
	const clamped = rects.map((rect) => intersectionRect(rect, {
		x: 0,
		y: 0,
		width: output.width,
		height: output.height
	})).filter((rect) => rect !== null);
	if (clamped.length === 0) return 0;
	if (clamped.length > 512) {
		const union = unionRects(clamped);
		return union ? Math.round(rectArea(union)) : 0;
	}
	const xs = /* @__PURE__ */ new Set();
	for (const rect of clamped) {
		xs.add(rect.x);
		xs.add(rectRight(rect));
	}
	const columns = [...xs].sort((a, b) => a - b);
	let total = 0;
	for (let i = 0; i < columns.length - 1; i += 1) {
		const x0 = columns[i];
		const x1 = columns[i + 1];
		if (x1 <= x0) continue;
		const spans = clamped.filter((rect) => rect.x <= x0 && rectRight(rect) >= x1).map((rect) => [rect.y, rectBottom(rect)]).sort((a, b) => a[0] - b[0]);
		let coveredY = 0;
		let currentStart = NaN;
		let currentEnd = NaN;
		for (const [start, end] of spans) if (Number.isNaN(currentStart)) {
			currentStart = start;
			currentEnd = end;
		} else if (start <= currentEnd) currentEnd = Math.max(currentEnd, end);
		else {
			coveredY += currentEnd - currentStart;
			currentStart = start;
			currentEnd = end;
		}
		if (!Number.isNaN(currentStart)) coveredY += currentEnd - currentStart;
		total += coveredY * (x1 - x0);
	}
	return Math.round(total);
}
function buildMappingPlan(project) {
	const issues = [];
	const byOutput = /* @__PURE__ */ new Map();
	const unassigned = [];
	const outputIds = new Set(project.outputs.map((o) => o.id));
	for (const screen of project.screens) {
		const outputId = screen.mapping.outputId;
		if (!outputId) {
			unassigned.push(screen);
			continue;
		}
		if (!outputIds.has(outputId)) {
			issues.push({
				level: "error",
				code: "missing-output",
				message: `"${screen.name}" is assigned to an output that no longer exists. Reassign it to a valid output.`,
				screenId: screen.id
			});
			continue;
		}
		const block = blockForScreen(screen);
		if (!block) continue;
		const list = byOutput.get(outputId) ?? [];
		list.push(block);
		byOutput.set(outputId, list);
		if (block.rect.width < 1 || block.rect.height < 1) issues.push({
			level: "error",
			code: "invalid-region",
			message: `"${screen.name}" has an invalid mapping region (${block.rect.width} × ${block.rect.height} px).`,
			screenId: screen.id,
			outputId
		});
		if (block.scaled) issues.push({
			level: "info",
			code: "resolution-mismatch",
			message: `"${screen.name}" is mapped at ${block.rect.width} × ${block.rect.height} px but its native resolution is ${screen.pixelWidth} × ${screen.pixelHeight} px. The output will need scaling.`,
			screenId: screen.id,
			outputId
		});
		if (!screen.visible) issues.push({
			level: "info",
			code: "hidden",
			message: `"${screen.name}" is hidden on the stage but still mapped to an output.`,
			screenId: screen.id,
			outputId
		});
		if (!screen.mapping.exportVisible) issues.push({
			level: "info",
			code: "hidden",
			message: `"${screen.name}" is excluded from exported maps.`,
			screenId: screen.id,
			outputId
		});
	}
	const outputs = project.outputs.map((output) => {
		const blocks = (byOutput.get(output.id) ?? []).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
		if (!isValidOutputSize(output.width, output.height)) issues.push({
			level: "error",
			code: "invalid-region",
			message: `Output "${output.name}" has an invalid resolution (${output.width} × ${output.height} px).`,
			outputId: output.id
		});
		if (!output.enabled) issues.push({
			level: "warning",
			code: "output-disabled",
			message: `Output "${output.name}" is disabled but still has ${blocks.length} mapped screen(s).`,
			outputId: output.id
		});
		for (const block of blocks) if (block.rect.x < 0 || block.rect.y < 0 || rectRight(block.rect) > output.width || rectBottom(block.rect) > output.height) issues.push({
			level: "error",
			code: "out-of-bounds",
			message: `"${block.name}" maps to x ${block.rect.x}..${rectRight(block.rect)}, y ${block.rect.y}..${rectBottom(block.rect)} which extends outside output "${output.name}" (${output.width} × ${output.height}).`,
			screenId: block.screenId,
			outputId: output.id
		});
		for (let i = 0; i < blocks.length; i += 1) for (let j = i + 1; j < blocks.length; j += 1) {
			const a = blocks[i];
			const b = blocks[j];
			const intersect = intersectionRect(a.rect, b.rect);
			if (!intersect) continue;
			if (a.rect.x === b.rect.x && a.rect.y === b.rect.y && a.rect.width === b.rect.width && a.rect.height === b.rect.height) issues.push({
				level: "error",
				code: "duplicate-region",
				message: `"${a.name}" and "${b.name}" occupy the exact same ${a.rect.width} × ${a.rect.height} px region on output "${output.name}". Assign one of them a different region.`,
				screenId: b.screenId,
				outputId: output.id
			});
			else issues.push({
				level: "warning",
				code: "overlap",
				message: `"${a.name}" and "${b.name}" overlap by ${Math.round(intersect.width)} × ${Math.round(intersect.height)} px on output "${output.name}". This is valid if the overlap is intentional (e.g. blended panels), otherwise adjust the regions.`,
				screenId: b.screenId,
				outputId: output.id
			});
		}
		const mappedPixels = blocks.filter((b) => b.exportVisible).reduce((sum, b) => sum + Math.round(rectArea(b.rect)), 0);
		const coveredPixels = coveredPixelCount(blocks.filter((b) => b.exportVisible).map((b) => b.rect), output);
		const total = Math.max(1, output.width * output.height);
		return {
			output,
			blocks,
			mappedPixels,
			coveredPixels,
			coveragePercent: Math.round(coveredPixels / total * 1e3) / 10,
			unusedPixels: Math.max(0, total - coveredPixels)
		};
	});
	for (const screen of unassigned) issues.push({
		level: "info",
		code: "unassigned",
		message: `"${screen.name}" is not assigned to any output yet.`,
		screenId: screen.id
	});
	const order = {
		error: 0,
		warning: 1,
		info: 2
	};
	issues.sort((a, b) => order[a.level] - order[b.level]);
	return {
		outputs,
		unassigned,
		issues,
		totals: {
			screens: project.screens.length,
			mappedScreens: project.screens.length - unassigned.length,
			outputs: project.outputs.length,
			mappedPixels: outputs.reduce((sum, o) => sum + o.mappedPixels, 0),
			totalOutputPixels: outputs.reduce((sum, o) => sum + o.output.width * o.output.height, 0)
		}
	};
}
function issuesByLevel(plan) {
	return plan.issues.reduce((acc, issue) => {
		acc[issue.level] += 1;
		return acc;
	}, {
		error: 0,
		warning: 0,
		info: 0
	});
}
/**
* Combined pixel map: every output is drawn as a horizontal band, stacked top to
* bottom in output order. The image is `max(output width)` wide and
* `sum(output heights) + gaps` tall. Outputs are left-aligned inside their band.
*/
function buildCombinedMapPlan(project, plan, options = {}) {
	const mappingPlan = plan ?? buildMappingPlan(project);
	const gap = Math.max(0, Math.round(options.gapPx ?? 0));
	const width = Math.max(1, ...mappingPlan.outputs.map((o) => o.output.width));
	const bands = [];
	const blocks = [];
	let cursor = 0;
	for (const outputPlan of mappingPlan.outputs) {
		const band = {
			outputId: outputPlan.output.id,
			outputName: outputPlan.output.name,
			y: cursor,
			height: outputPlan.output.height,
			width: outputPlan.output.width
		};
		bands.push(band);
		for (const block of outputPlan.blocks) {
			if (!block.exportVisible) continue;
			blocks.push({
				...block,
				outputId: outputPlan.output.id,
				offsetY: cursor,
				offsetX: 0
			});
		}
		cursor += outputPlan.output.height + gap;
	}
	return {
		width,
		height: Math.max(1, cursor - (bands.length ? gap : 0)),
		bands,
		blocks
	};
}
function buildStageLayoutPlan(project, marginMm = 0) {
	const stageRect = {
		x: 0,
		y: 0,
		width: project.stage.widthMm,
		height: project.stage.heightMm
	};
	const blocks = project.screens.map((screen) => {
		const rect = {
			x: screen.xMm,
			y: screen.yMm,
			width: screen.widthMm,
			height: screen.heightMm
		};
		return {
			screenId: screen.id,
			name: screen.name,
			color: screen.color,
			rect,
			rotationDeg: screen.rotationDeg,
			bounds: rotatedBounds(rect, screen.rotationDeg),
			pixelWidth: screen.pixelWidth,
			pixelHeight: screen.pixelHeight
		};
	});
	const withMargin = project.screens.length ? unionRects([stageRect, ...blocks.map((b) => b.bounds)]) ?? stageRect : stageRect;
	return {
		bounds: {
			x: withMargin.x - marginMm,
			y: withMargin.y - marginMm,
			width: withMargin.width + marginMm * 2,
			height: withMargin.height + marginMm * 2
		},
		blocks
	};
}
var RAW = {
	" ": "0,0,0,0,0,0,0",
	"0": "14,17,19,21,25,17,14",
	"1": "4,12,4,4,4,4,14",
	"2": "14,17,1,2,4,8,31",
	"3": "31,2,4,2,1,17,14",
	"4": "2,6,10,18,31,2,2",
	"5": "31,16,30,1,1,17,14",
	"6": "6,8,16,30,17,17,14",
	"7": "31,1,2,4,8,8,8",
	"8": "14,17,17,14,17,17,14",
	"9": "14,17,17,15,1,2,12",
	A: "14,17,17,31,17,17,17",
	B: "30,17,17,30,17,17,30",
	C: "14,17,16,16,16,17,14",
	D: "30,17,17,17,17,17,30",
	E: "31,16,16,30,16,16,31",
	F: "31,16,16,30,16,16,16",
	G: "14,17,16,23,17,17,15",
	H: "17,17,17,31,17,17,17",
	I: "14,4,4,4,4,4,14",
	J: "7,2,2,2,2,18,12",
	K: "17,18,20,24,20,18,17",
	L: "16,16,16,16,16,16,31",
	M: "17,27,21,21,17,17,17",
	N: "17,25,21,19,17,17,17",
	O: "14,17,17,17,17,17,14",
	P: "30,17,17,30,16,16,16",
	Q: "14,17,17,17,21,18,13",
	R: "30,17,17,30,20,18,17",
	S: "15,16,16,14,1,1,30",
	T: "31,4,4,4,4,4,4",
	U: "17,17,17,17,17,17,14",
	V: "17,17,17,17,17,10,4",
	W: "17,17,17,21,21,27,17",
	X: "17,17,10,4,10,17,17",
	Y: "17,17,10,4,4,4,4",
	Z: "31,1,2,4,8,16,31",
	"-": "0,0,0,31,0,0,0",
	".": "0,0,0,0,0,12,12",
	",": "0,0,0,0,12,12,8",
	":": "0,12,12,0,12,12,0",
	"/": "1,2,2,4,8,8,16",
	"%": "17,18,4,4,8,9,17",
	"(": "2,4,8,8,8,4,2",
	")": "8,4,2,2,2,4,8",
	"+": "0,4,4,31,4,4,0",
	"=": "0,0,31,0,31,0,0",
	"#": "10,10,31,10,31,10,10",
	"<": "2,4,8,16,8,4,2",
	">": "8,4,2,1,2,4,8",
	_: "0,0,0,0,0,0,31",
	"?": "14,17,1,2,4,0,4",
	"!": "4,4,4,4,4,0,4",
	"&": "12,18,20,8,21,18,13",
	"*": "0,10,4,31,4,10,0",
	"°": "6,9,9,6,0,0,0",
	"×": "0,0,17,10,4,10,17",
	"\"": "10,10,0,0,0,0,0",
	"'": "4,4,0,0,0,0,0",
	"@": "14,17,23,21,23,16,14"
};
var GLYPHS = /* @__PURE__ */ new Map();
for (const [char, encoded] of Object.entries(RAW)) GLYPHS.set(char, encoded.split(",").map(Number));
function glyphFor(char) {
	return GLYPHS.get(char) ?? GLYPHS.get("?");
}
/** Normalises arbitrary text into characters the font can render. */
function sanitizeForFont(text) {
	const upper = text.toUpperCase();
	let out = "";
	for (const char of upper) out += GLYPHS.has(char) ? char : "?";
	return out;
}
/** Pixel size of `text` at the given integer scale and letter spacing. */
function measureText(text, scale = 1, letterSpacing = 1) {
	const chars = sanitizeForFont(text).length;
	if (chars === 0) return {
		width: 0,
		height: 7 * scale
	};
	return {
		width: chars * 5 * scale + (chars - 1) * letterSpacing * scale,
		height: 7 * scale
	};
}
/** Truncates text with a trailing "..." so it fits inside `maxWidth` pixels. */
function fitText(text, maxWidth, scale = 1, letterSpacing = 1) {
	const clean = sanitizeForFont(text);
	if (measureText(clean, scale, letterSpacing).width <= maxWidth) return clean;
	const ellipsis = "...";
	const ellipsisWidth = measureText(ellipsis, scale, letterSpacing).width;
	let candidate = clean;
	while (candidate.length > 0) {
		candidate = candidate.slice(0, -1);
		if (measureText(candidate, scale, letterSpacing).width + ellipsisWidth <= maxWidth) return `${candidate}${ellipsis}`;
	}
	return "";
}
//#endregion
//#region src/shared/raster/draw.ts
function rgba(r, g, b, a = 255) {
	return {
		r,
		g,
		b,
		a
	};
}
var BLACK = rgba(0, 0, 0, 255);
var WHITE = rgba(255, 255, 255, 255);
/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgb()/rgba()`-style input. */
function parseColor(input, alpha = 255) {
	const value = input.trim();
	const hex = value.startsWith("#") ? value.slice(1) : value;
	if (/^[0-9a-f]{3}$/i.test(hex)) return rgba(parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), alpha);
	if (/^[0-9a-f]{6}$/i.test(hex)) return rgba(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), alpha);
	if (/^[0-9a-f]{8}$/i.test(hex)) return rgba(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(6, 8), 16));
	return rgba(128, 128, 128, alpha);
}
function createImage(width, height, background) {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	const data = new Uint8ClampedArray(w * h * 4);
	if (background) for (let i = 0; i < w * h; i += 1) {
		data[i * 4] = background.r;
		data[i * 4 + 1] = background.g;
		data[i * 4 + 2] = background.b;
		data[i * 4 + 3] = background.a;
	}
	return {
		width: w,
		height: h,
		data
	};
}
function setPixel(image, x, y, color) {
	const px = Math.round(x);
	const py = Math.round(y);
	if (px < 0 || py < 0 || px >= image.width || py >= image.height) return;
	const i = (py * image.width + px) * 4;
	if (color.a >= 255) {
		image.data[i] = color.r;
		image.data[i + 1] = color.g;
		image.data[i + 2] = color.b;
		image.data[i + 3] = 255;
		return;
	}
	const srcA = color.a / 255;
	const dstA = image.data[i + 3] / 255;
	const outA = srcA + dstA * (1 - srcA);
	if (outA <= 0) {
		image.data[i + 3] = 0;
		return;
	}
	image.data[i] = (color.r * srcA + image.data[i] * dstA * (1 - srcA)) / outA;
	image.data[i + 1] = (color.g * srcA + image.data[i + 1] * dstA * (1 - srcA)) / outA;
	image.data[i + 2] = (color.b * srcA + image.data[i + 2] * dstA * (1 - srcA)) / outA;
	image.data[i + 3] = outA * 255;
}
function fillRect(image, rect, color) {
	const x0 = Math.max(0, Math.round(rect.x));
	const y0 = Math.max(0, Math.round(rect.y));
	const x1 = Math.min(image.width, Math.round(rect.x + rect.width));
	const y1 = Math.min(image.height, Math.round(rect.y + rect.height));
	for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) setPixel(image, x, y, color);
}
function strokeRect(image, rect, color, thickness = 1) {
	const t = Math.max(1, Math.round(thickness));
	const x = Math.round(rect.x);
	const y = Math.round(rect.y);
	const w = Math.round(rect.width);
	const h = Math.round(rect.height);
	fillRect(image, {
		x,
		y,
		width: w,
		height: t
	}, color);
	fillRect(image, {
		x,
		y: y + h - t,
		width: w,
		height: t
	}, color);
	fillRect(image, {
		x,
		y,
		width: t,
		height: h
	}, color);
	fillRect(image, {
		x: x + w - t,
		y,
		width: t,
		height: h
	}, color);
}
/** Bresenham line with optional thickness (drawn as small squares). */
function drawLine(image, x0, y0, x1, y1, color, thickness = 1) {
	let sx = Math.round(x0);
	let sy = Math.round(y0);
	const ex = Math.round(x1);
	const ey = Math.round(y1);
	const dx = Math.abs(ex - sx);
	const dy = Math.abs(ey - sy);
	const stepX = sx < ex ? 1 : -1;
	const stepY = sy < ey ? 1 : -1;
	let err = dx - dy;
	const t = Math.max(1, Math.round(thickness));
	const half = Math.floor(t / 2);
	let guard = 0;
	const maxSteps = dx + dy + 4;
	while (guard <= maxSteps) {
		guard += 1;
		if (t === 1) setPixel(image, sx, sy, color);
		else fillRect(image, {
			x: sx - half,
			y: sy - half,
			width: t,
			height: t
		}, color);
		if (sx === ex && sy === ey) break;
		const e2 = 2 * err;
		if (e2 > -dy) {
			err -= dy;
			sx += stepX;
		}
		if (e2 < dx) {
			err += dx;
			sy += stepY;
		}
	}
}
function drawDashedLine(image, x0, y0, x1, y1, color, dash = 4, gap = 4, thickness = 1) {
	const length = Math.hypot(x1 - x0, y1 - y0);
	if (length === 0) return;
	const ux = (x1 - x0) / length;
	const uy = (y1 - y0) / length;
	let cursor = 0;
	while (cursor < length) {
		const end = Math.min(cursor + dash, length);
		drawLine(image, x0 + ux * cursor, y0 + uy * cursor, x0 + ux * end, y0 + uy * end, color, thickness);
		cursor = end + gap;
	}
}
function fillPolygon(image, points, color) {
	if (points.length < 3) return;
	const ys = points.map((p) => p.y);
	const minY = Math.max(0, Math.floor(Math.min(...ys)));
	const maxY = Math.min(image.height - 1, Math.ceil(Math.max(...ys)));
	for (let y = minY; y <= maxY; y += 1) {
		const crossings = [];
		for (let i = 0; i < points.length; i += 1) {
			const a = points[i];
			const b = points[(i + 1) % points.length];
			if (a.y === b.y) continue;
			const yMin = Math.min(a.y, b.y);
			const yMax = Math.max(a.y, b.y);
			if (y + .5 < yMin || y + .5 > yMax) continue;
			const t = (y + .5 - a.y) / (b.y - a.y);
			crossings.push(a.x + t * (b.x - a.x));
		}
		crossings.sort((p, q) => p - q);
		for (let i = 0; i + 1 < crossings.length; i += 2) {
			const x0 = Math.round(crossings[i]);
			const x1 = Math.round(crossings[i + 1]);
			for (let x = x0; x <= x1; x += 1) setPixel(image, x, y, color);
		}
	}
}
/** Filled rotated rectangle, used for rotated screens in layout exports. */
function fillRotatedRect(image, rect, rotationDeg, color) {
	if (rotationDeg % 360 === 0) {
		fillRect(image, rect, color);
		return;
	}
	const cx = rect.x + rect.width / 2;
	const cy = rect.y + rect.height / 2;
	const rad = rotationDeg * Math.PI / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	fillPolygon(image, [
		{
			x: rect.x,
			y: rect.y
		},
		{
			x: rect.x + rect.width,
			y: rect.y
		},
		{
			x: rect.x + rect.width,
			y: rect.y + rect.height
		},
		{
			x: rect.x,
			y: rect.y + rect.height
		}
	].map((p) => ({
		x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
		y: cy + (p.x - cx) * sin + (p.y - cy) * cos
	})), color);
}
function drawRotatedRectOutline(image, rect, rotationDeg, color, thickness = 1) {
	const cx = rect.x + rect.width / 2;
	const cy = rect.y + rect.height / 2;
	const rad = rotationDeg * Math.PI / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const corners = [
		{
			x: rect.x,
			y: rect.y
		},
		{
			x: rect.x + rect.width,
			y: rect.y
		},
		{
			x: rect.x + rect.width,
			y: rect.y + rect.height
		},
		{
			x: rect.x,
			y: rect.y + rect.height
		}
	].map((p) => ({
		x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
		y: cy + (p.x - cx) * sin + (p.y - cy) * cos
	}));
	for (let i = 0; i < 4; i += 1) {
		const a = corners[i];
		const b = corners[(i + 1) % 4];
		drawLine(image, a.x, a.y, b.x, b.y, color, thickness);
	}
}
/** Draws text with the bundled 5x7 font. `y` is the top of the glyph row. */
function drawText(image, text, x, y, color, scale = 1, letterSpacing = 1) {
	const chars = sanitizeForFont(text);
	const s = Math.max(1, Math.round(scale));
	let cursor = Math.round(x);
	const top = Math.round(y);
	for (const char of chars) {
		const rows = glyphFor(char);
		for (let row = 0; row < 7; row += 1) {
			const bits = rows[row] ?? 0;
			for (let col = 0; col < 5; col += 1) {
				if (!(bits >> 4 - col & 1)) continue;
				fillRect(image, {
					x: cursor + col * s,
					y: top + row * s,
					width: s,
					height: s
				}, color);
			}
		}
		cursor += 5 * s + letterSpacing * s;
	}
}
/** Nearest-neighbour / box downscale used to build previews of large maps. */
function resampleImage(image, targetWidth, targetHeight) {
	const w = Math.max(1, Math.round(targetWidth));
	const h = Math.max(1, Math.round(targetHeight));
	const out = createImage(w, h);
	const sx = image.width / w;
	const sy = image.height / h;
	for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
		const srcX = Math.min(image.width - 1, Math.floor(x * sx));
		const i = (Math.min(image.height - 1, Math.floor(y * sy)) * image.width + srcX) * 4;
		const o = (y * w + x) * 4;
		out.data[o] = image.data[i];
		out.data[o + 1] = image.data[i + 1];
		out.data[o + 2] = image.data[i + 2];
		out.data[o + 3] = image.data[i + 3];
	}
	return out;
}
function lighten(color, amount) {
	const t = Math.max(0, Math.min(1, amount));
	return rgba(Math.round(color.r + (255 - color.r) * t), Math.round(color.g + (255 - color.g) * t), Math.round(color.b + (255 - color.b) * t), color.a);
}
function withAlpha(color, alpha) {
	return {
		...color,
		a: Math.max(0, Math.min(255, Math.round(alpha)))
	};
}
//#endregion
//#region src/shared/raster/render.ts
var DEFAULTS = {
	showLabels: true,
	showGrid: true,
	gridStepPx: 100,
	showBorders: true,
	background: BLACK,
	labelScale: 2,
	dimExcluded: true
};
function resolveOptions(options) {
	return {
		...DEFAULTS,
		...options
	};
}
function drawGrid(image, step, color) {
	if (step <= 1) return;
	for (let x = step; x < image.width; x += step) drawDashedLine(image, x, 0, x, image.height, color, 6, 6, 1);
	for (let y = step; y < image.height; y += step) drawDashedLine(image, 0, y, image.width, y, color, 6, 6, 1);
}
function drawBlock(image, block, offsetX, offsetY, options) {
	const rect = {
		x: block.rect.x + offsetX,
		y: block.rect.y + offsetY,
		width: block.rect.width,
		height: block.rect.height
	};
	const base = parseColor(block.color);
	const included = block.exportVisible;
	fillRect(image, rect, withAlpha(base, 58 * (included || !options.dimExcluded ? 1 : .35)));
	if (options.showBorders) strokeRect(image, rect, withAlpha(base, included ? 255 : 110), 2);
	if (!options.showLabels) return;
	const inner = {
		x: rect.x + 6,
		y: rect.y + 6,
		width: rect.width - 12,
		height: rect.height - 12
	};
	if (inner.width < 24 || inner.height < 10) return;
	const scale = Math.max(1, Math.round(options.labelScale * (rect.width >= 320 ? 2 : 1)));
	const name = fitText(block.name, inner.width, scale, 1);
	if (name) drawText(image, name, inner.x, inner.y, withAlpha(WHITE, included ? 255 : 150), scale);
	const detail = `${block.native.width}x${block.native.height}`;
	const detailScale = Math.max(1, scale - 1);
	const detailHeight = measureText(detail, detailScale, 1).height;
	if (inner.height >= 10 + scale * 8 + detailHeight + 4) drawText(image, fitText(detail, inner.width, detailScale, 1), inner.x, inner.y + scale * 8 + 4, withAlpha(WHITE, included ? 200 : 120), detailScale);
}
/** Renders one output device as a full-resolution pixel map. */
function renderOutputMap(outputPlan, options = {}) {
	const opts = resolveOptions(options);
	const output = outputPlan.output;
	const image = createImage(output.width, output.height, opts.background);
	if (opts.showGrid) drawGrid(image, opts.gridStepPx, withAlpha(WHITE, 26));
	for (const block of outputPlan.blocks) drawBlock(image, block, 0, 0, opts);
	return image;
}
/**
* Renders the combined pixel map: every output as a stacked band.
* Image size is `max(output widths) x sum(output heights + gaps)`.
*/
function renderCombinedMap(plan, options = {}) {
	const opts = resolveOptions(options);
	const image = createImage(plan.width, plan.height, opts.background);
	for (const band of plan.bands) {
		const bandRect = {
			x: 0,
			y: band.y,
			width: band.width,
			height: band.height
		};
		if (opts.showGrid) {
			for (let x = opts.gridStepPx; x < band.width; x += opts.gridStepPx) drawDashedLine(image, x, band.y, x, band.y + band.height, withAlpha(WHITE, 22), 6, 6, 1);
			for (let y = opts.gridStepPx; y < band.height; y += opts.gridStepPx) drawDashedLine(image, 0, band.y + y, band.width, band.y + y, withAlpha(WHITE, 22), 6, 6, 1);
		}
		strokeRect(image, bandRect, withAlpha(WHITE, 48), 1);
		const label = fitText(band.outputName, Math.max(40, band.width - 16), 2, 1);
		if (label) {
			const metrics = measureText(label, 2, 1);
			fillRect(image, {
				x: 6,
				y: band.y + 6,
				width: metrics.width + 10,
				height: metrics.height + 8
			}, withAlpha(BLACK, 190));
			drawText(image, label, 11, band.y + 10, WHITE, 2);
		}
	}
	for (const block of plan.blocks) drawBlock(image, block, block.offsetX, block.offsetY, opts);
	if (plan.bands.length > 1) for (const band of plan.bands.slice(1)) fillRect(image, {
		x: 0,
		y: band.y - 1,
		width: image.width,
		height: 2
	}, withAlpha(WHITE, 90));
	return image;
}
/**
* Native-resolution content guide for one screen.
*
* Produced at exactly `screen.pixelWidth x screen.pixelHeight`, independent of the
* mapping region, so a content author can build artwork at the true native size.
*/
function renderScreenGuide(project, screen, options = {}) {
	const width = Math.max(1, Math.round(screen.pixelWidth));
	const height = Math.max(1, Math.round(screen.pixelHeight));
	const image = createImage(width, height, options.background ?? BLACK);
	const accent = lighten(parseColor(screen.color), .15);
	const guide = withAlpha(WHITE, 120);
	if (options.showGrid) drawGrid(image, options.gridStepPx ?? Math.max(50, Math.round(Math.min(width, height) / 12)), withAlpha(WHITE, 18));
	strokeRect(image, {
		x: 0,
		y: 0,
		width,
		height
	}, withAlpha(WHITE, 200), 2);
	if (options.showSafeArea) {
		const pct = Math.max(0, Math.min(45, options.safeAreaPercent ?? 10)) / 100;
		const inset = {
			x: Math.round(width * pct),
			y: Math.round(height * pct),
			width: Math.round(width * (1 - pct * 2)),
			height: Math.round(height * (1 - pct * 2))
		};
		drawDashedLine(image, inset.x, inset.y, inset.x + inset.width, inset.y, guide, 8, 6, 1);
		drawDashedLine(image, inset.x + inset.width, inset.y, inset.x + inset.width, inset.y + inset.height, guide, 8, 6, 1);
		drawDashedLine(image, inset.x + inset.width, inset.y + inset.height, inset.x, inset.y + inset.height, guide, 8, 6, 1);
		drawDashedLine(image, inset.x, inset.y + inset.height, inset.x, inset.y, guide, 8, 6, 1);
	}
	if (options.showCenterCross !== false) {
		const cx = Math.floor(width / 2);
		const cy = Math.floor(height / 2);
		const arm = Math.max(12, Math.round(Math.min(width, height) * .04));
		drawDashedLine(image, cx - arm, cy, cx + arm, cy, withAlpha(accent, 200), 6, 4, 1);
		drawDashedLine(image, cx, cy - arm, cx, cy + arm, withAlpha(accent, 200), 6, 4, 1);
	}
	if (options.showCornerMarks !== false) {
		const len = Math.max(16, Math.round(Math.min(width, height) * .06));
		const t = Math.max(2, Math.round(Math.min(width, height) / 400));
		const marks = [
			[
				0,
				0,
				len,
				len
			],
			[
				width,
				0,
				-len,
				len
			],
			[
				width,
				height,
				-len,
				-len
			],
			[
				0,
				height,
				len,
				-len
			]
		];
		for (const [x, y, dx, dy] of marks) {
			drawDashedLine(image, x, y, x + dx, y, accent, 4, 3, t);
			drawDashedLine(image, x, y, x, y + dy, accent, 4, 3, t);
		}
	}
	if (options.showInfoPanel !== false) {
		const scale = Math.max(1, Math.round(Math.min(width, height) / 400));
		const lines = [
			screen.name,
			`${screen.pixelWidth} x ${screen.pixelHeight} ${screen.pixelPitchMm ? `· P${screen.pixelPitchMm}` : ""}`.trim(),
			`${(screen.widthMm / 1e3).toFixed(3)} m x ${(screen.heightMm / 1e3).toFixed(3)} m`,
			options.subtitle ?? `PROJECT ${project.meta.name}`
		].filter((line) => line.length > 0);
		const lineHeight = 8 * scale + 3 * scale;
		const panelWidth = Math.max(...lines.map((line) => measureText(line, scale, 1).width)) + 16;
		const panelHeight = lines.length * lineHeight + 10;
		if (panelWidth < width - 8 && panelHeight < height - 8) {
			fillRect(image, {
				x: 6,
				y: 6,
				width: panelWidth,
				height: panelHeight
			}, withAlpha(BLACK, 200));
			strokeRect(image, {
				x: 6,
				y: 6,
				width: panelWidth,
				height: panelHeight
			}, withAlpha(accent, 160), 1);
			lines.forEach((line, index) => {
				drawText(image, fitText(line, panelWidth - 12, scale, 1), 12, 11 + index * lineHeight, index === 0 ? WHITE : withAlpha(WHITE, 190), scale, 1);
			});
		}
	}
	return image;
}
/**
* Physical stage layout export (top view). Rendered from stored millimetres at a
* fixed px-per-metre scale, so the viewport has no influence on the result.
*/
function renderStageLayout(project, plan, options = {}) {
	const bounds = plan.bounds;
	const defaultPxPerMeter = Math.max(4, Math.min(240, 2048 / Math.max(bounds.width / 1e3, .001)));
	const pxPerMeter = options.pxPerMeter ?? defaultPxPerMeter;
	const pxPerMm = pxPerMeter / 1e3;
	const width = Math.max(16, Math.round(bounds.width * pxPerMm));
	const height = Math.max(16, Math.round(bounds.height * pxPerMm));
	const image = createImage(width, height, options.background ?? BLACK);
	const toPx = (xMm, yMm) => ({
		x: (xMm - bounds.x) * pxPerMm,
		y: (yMm - bounds.y) * pxPerMm
	});
	if (options.showGrid !== false) {
		const stepM = pxPerMeter > 60 ? .5 : 1;
		for (let m = 0; m <= bounds.width / 1e3; m += stepM) {
			const x = Math.round((m * 1e3 - bounds.x) * pxPerMm);
			if (x >= 0 && x < width) drawDashedLine(image, x, 0, x, height, withAlpha(WHITE, 24), 4, 6, 1);
		}
		for (let m = 0; m <= bounds.height / 1e3; m += stepM) {
			const y = Math.round((m * 1e3 - bounds.y) * pxPerMm);
			if (y >= 0 && y < height) drawDashedLine(image, 0, y, width, y, withAlpha(WHITE, 24), 4, 6, 1);
		}
	}
	const stageTopLeft = toPx(0, 0);
	strokeRect(image, {
		x: stageTopLeft.x,
		y: stageTopLeft.y,
		width: project.stage.widthMm * pxPerMm,
		height: project.stage.heightMm * pxPerMm
	}, withAlpha(WHITE, 140), 1);
	for (const block of plan.blocks) {
		const topLeft = toPx(block.rect.x, block.rect.y);
		const rect = {
			x: topLeft.x,
			y: topLeft.y,
			width: Math.max(1, block.rect.width * pxPerMm),
			height: Math.max(1, block.rect.height * pxPerMm)
		};
		const color = parseColor(block.color);
		fillRotatedRect(image, rect, block.rotationDeg, withAlpha(color, 70));
		drawRotatedRectOutline(image, rect, block.rotationDeg, withAlpha(color, 235), 2);
		if (options.showLabels !== false && rect.width > 40 && rect.height > 14) {
			const scale = Math.max(1, Math.round(Math.min(rect.width / 90, rect.height / 30)));
			const label = fitText(block.name, rect.width - 8, scale, 1);
			if (label) drawText(image, label, rect.x + 4, rect.y + 4, WHITE, scale);
			if (options.showDimensions !== false && rect.height > 30) {
				const detail = `${(block.rect.width / 1e3).toFixed(2)}x${(block.rect.height / 1e3).toFixed(2)}M`;
				if (measureText(detail, 1, 1).width <= rect.width - 8) drawText(image, detail, rect.x + 4, rect.y + 4 + scale * 9, withAlpha(WHITE, 190), 1);
			}
		}
	}
	return image;
}
//#endregion
//#region src/main/services/pngEncoder.ts
/**
* Minimal, dependency-free PNG encoder (8-bit RGBA, non-interlaced).
*
* The export pipeline already produces raw RGBA buffers from the stored logical model,
* so encoding them here keeps the export path free of native image libraries and makes
* the byte output deterministic and testable.
*/
var SIGNATURE = Buffer.from([
	137,
	80,
	78,
	71,
	13,
	10,
	26,
	10
]);
var CRC_TABLE = (() => {
	const table = new Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();
function crc32(buffer) {
	let crc = 4294967295;
	for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 255] ^ crc >>> 8;
	return (crc ^ 4294967295) >>> 0;
}
function chunk(type, payload) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(payload.length, 0);
	const typeBuffer = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])), 0);
	return Buffer.concat([
		length,
		typeBuffer,
		payload,
		crc
	]);
}
function encodePng(image) {
	const { width, height, data } = image;
	if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error("PNG dimensions must be positive.");
	if (data.length !== width * height * 4) throw new Error(`PNG buffer size mismatch: expected ${width * height * 4} bytes for ${width}x${height}, received ${data.length}.`);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.writeUInt8(8, 8);
	ihdr.writeUInt8(6, 9);
	ihdr.writeUInt8(0, 10);
	ihdr.writeUInt8(0, 11);
	ihdr.writeUInt8(0, 12);
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y += 1) {
		raw[y * (stride + 1)] = 0;
		Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
	}
	const idat = (0, node_zlib.deflateSync)(raw, { level: 6 });
	return Buffer.concat([
		SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", idat),
		chunk("IEND", Buffer.alloc(0))
	]);
}
//#endregion
//#region src/shared/exportFormats.ts
/**
* Machine-readable export formats.
*
* Semantics are documented in the user manual and repeated inside the JSON payload so
* a downstream tool never has to guess. CuePoint does **not** claim to emit a
* proprietary third-party project format; the JSON document is the integration point.
*/
var MAPPING_FORMAT = "cuepoint.mapping";
var CSV_FORMAT_LABEL = "cuepoint.mapping.csv.v1";
var CSV_COLUMNS = [
	"output_id",
	"output_name",
	"output_width",
	"output_height",
	"screen_id",
	"screen_name",
	"screen_type",
	"screen_visible",
	"screen_locked",
	"group_id",
	"physical_x_mm",
	"physical_y_mm",
	"physical_width_mm",
	"physical_height_mm",
	"rotation_deg",
	"pixel_width",
	"pixel_height",
	"pixel_pitch_mm",
	"pixel_aspect",
	"map_region_x",
	"map_region_y",
	"map_region_width",
	"map_region_height",
	"map_scale",
	"map_offset_x",
	"map_offset_y",
	"map_auto_region",
	"map_export_visible",
	"map_right",
	"map_bottom",
	"map_coverage_percent",
	"notes"
];
function csvEscape(value, delimiter) {
	if (value.includes(delimiter) || value.includes("\"") || value.includes("\n") || value.includes("\r")) return `"${value.replace(/"/g, "\"\"")}"`;
	return value;
}
function fmt(value, decimals = 3) {
	if (value === null || value === void 0 || !Number.isFinite(value)) return "";
	const rounded = Math.round(value * 10 ** decimals) / 10 ** decimals;
	return String(rounded);
}
/**
* Long-format CSV: one row per mapped screen, with its output repeated on the row.
* Unassigned screens are emitted with empty output columns so nothing is silently lost.
*/
function projectToCsv(project, plan, delimiter = ",") {
	const rows = [];
	rows.push(CSV_COLUMNS.join(delimiter));
	const byOutput = new Map(plan.outputs.map((o) => [o.output.id, o]));
	for (const screen of project.screens) {
		const outputId = screen.mapping.outputId;
		const outputPlan = outputId ? byOutput.get(outputId) : void 0;
		const output = outputPlan?.output;
		const region = effectiveRegion(screen.mapping);
		const coverage = outputPlan && outputPlan.output.width * outputPlan.output.height > 0 ? region.width * region.height / (outputPlan.output.width * outputPlan.output.height) * 100 : null;
		const values = [
			output?.id ?? "",
			output?.name ?? "",
			output ? String(output.width) : "",
			output ? String(output.height) : "",
			screen.id,
			screen.name,
			screen.type,
			screen.visible ? "true" : "false",
			screen.locked ? "true" : "false",
			screen.groupId ?? "",
			fmt(screen.xMm, 3),
			fmt(screen.yMm, 3),
			fmt(screen.widthMm, 3),
			fmt(screen.heightMm, 3),
			fmt(screen.rotationDeg, 4),
			String(screen.pixelWidth),
			String(screen.pixelHeight),
			screen.pixelPitchMm === null ? "" : fmt(screen.pixelPitchMm, 4),
			fmt(aspectDecimal(screen.pixelWidth, screen.pixelHeight), 6),
			fmt(region.x, 3),
			fmt(region.y, 3),
			fmt(region.width, 3),
			fmt(region.height, 3),
			fmt(screen.mapping.scale, 6),
			fmt(screen.mapping.offsetXPx, 3),
			fmt(screen.mapping.offsetYPx, 3),
			screen.mapping.autoRegion ? "true" : "false",
			screen.mapping.exportVisible ? "true" : "false",
			fmt(rectRight(region), 3),
			fmt(rectBottom(region), 3),
			coverage === null ? "" : fmt(coverage, 4),
			screen.mapping.notes || screen.notes
		];
		rows.push(values.map((value) => csvEscape(value, delimiter)).join(delimiter));
	}
	return `${rows.join("\r\n")}\r\n`;
}
/**
* Versioned JSON mapping document.
*
* Coordinate systems are stated explicitly so consumers cannot misinterpret units:
* physical geometry is millimetres in stage space, mapping regions are pixels in
* output space with the origin at the output's top-left corner.
*/
function projectToMappingJson(project, plan, options) {
	const document = {
		format: MAPPING_FORMAT,
		formatVersion: 1,
		csvFormat: CSV_FORMAT_LABEL,
		generator: {
			name: options.appName ?? "CuePoint",
			version: options.appVersion,
			projectSchemaVersion: 2
		},
		exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
		units: {
			length: "mm",
			lengthNote: "All physical dimensions are millimetres. Convert with 1 m = 1000 mm, 1 in = 25.4 mm, 1 ft = 304.8 mm.",
			pixel: "px",
			rotation: "degrees, clockwise positive, normalised to 0 <= r < 360"
		},
		coordinateSystems: {
			stageSpace: "Origin at the stage top-left corner. +x to the right, +y downward. Used by all physical_* fields.",
			screenLocalSpace: "Each screen is an axis-aligned rectangle (x, y, width, height) rotated by rotation_deg about that rectangle centre.",
			outputSpace: "Origin at the output top-left corner, +y downward. map_region_* and map_offset_* are pixels in this space.",
			effectiveRegion: "map_region_x + map_offset_x, map_region_y + map_offset_y, map_region_width * map_scale, map_region_height * map_scale."
		},
		project: {
			id: project.meta.id,
			name: project.meta.name,
			author: project.meta.author,
			notes: project.meta.notes,
			createdAt: project.meta.createdAt,
			updatedAt: project.meta.updatedAt,
			stage: {
				name: project.stage.name,
				widthMm: project.stage.widthMm,
				heightMm: project.stage.heightMm,
				canvasPxPerMeter: project.stage.canvasPxPerMeter,
				background: {
					assetPath: project.stage.background.assetPath,
					visible: project.stage.background.visible,
					opacity: project.stage.background.opacity,
					fit: project.stage.background.fit,
					offsetXMm: project.stage.background.offsetXMm,
					offsetYMm: project.stage.background.offsetYMm,
					scale: project.stage.background.scale,
					rotationDeg: project.stage.background.rotationDeg
				}
			}
		},
		outputs: plan.outputs.map((outputPlan) => ({
			id: outputPlan.output.id,
			name: outputPlan.output.name,
			width: outputPlan.output.width,
			height: outputPlan.output.height,
			enabled: outputPlan.output.enabled,
			notes: outputPlan.output.notes,
			mappedPixels: outputPlan.mappedPixels,
			coveredPixels: outputPlan.coveredPixels,
			coveragePercent: outputPlan.coveragePercent,
			unusedPixels: outputPlan.unusedPixels,
			screens: outputPlan.blocks.map((block) => {
				const screen = project.screens.find((s) => s.id === block.screenId);
				const region = effectiveRegion(screen?.mapping ?? {
					region: block.rect,
					scale: 1,
					offsetXPx: 0,
					offsetYPx: 0
				});
				return {
					screenId: block.screenId,
					name: block.name,
					type: screen?.type ?? "led",
					color: screen?.color ?? "#808080",
					visible: screen?.visible ?? true,
					locked: screen?.locked ?? false,
					groupId: screen?.groupId ?? null,
					physical: {
						xMm: screen?.xMm ?? 0,
						yMm: screen?.yMm ?? 0,
						widthMm: screen?.widthMm ?? 0,
						heightMm: screen?.heightMm ?? 0,
						rotationDeg: screen?.rotationDeg ?? 0
					},
					pixel: {
						width: block.native.width,
						height: block.native.height,
						pitchMm: screen?.pixelPitchMm ?? null,
						aspect: aspectDecimal(block.native.width, block.native.height),
						aspectLabel: aspectRatioLabel(block.native.width, block.native.height)
					},
					mapping: {
						region: screen?.mapping.region ?? block.rect,
						effectiveRegion: region,
						scale: screen?.mapping.scale ?? 1,
						offsetXPx: screen?.mapping.offsetXPx ?? 0,
						offsetYPx: screen?.mapping.offsetYPx ?? 0,
						autoRegion: screen?.mapping.autoRegion ?? true,
						exportVisible: screen?.mapping.exportVisible ?? true,
						scaled: block.scaled || (screen?.mapping.region.width ?? 0) !== block.native.width || (screen?.mapping.region.height ?? 0) !== block.native.height,
						notes: screen?.mapping.notes ?? ""
					}
				};
			})
		})),
		unassignedScreens: plan.unassigned.map((screen) => ({
			screenId: screen.id,
			name: screen.name,
			pixelWidth: screen.pixelWidth,
			pixelHeight: screen.pixelHeight,
			physicalWidthMm: screen.widthMm,
			physicalHeightMm: screen.heightMm
		})),
		totals: plan.totals,
		issues: options.includeIssueDetails === false ? plan.issues.map((issue) => ({
			level: issue.level,
			code: issue.code,
			screenId: issue.screenId ?? null,
			outputId: issue.outputId ?? null
		})) : plan.issues,
		compatibility: {
			thirdParty: "CuePoint exports this documented JSON document and the CSV table. It does not emit Resolume Arena, disguise, Watchout or any other vendor project file, and no vendor compatibility is claimed.",
			notes: [
				"Use the combined pixel map PNG as a visual reference for content authors.",
				"Use the per-screen guide PNGs to author content at each screen native resolution.",
				"The mapping JSON is stable within a formatVersion; consumers should check formatVersion first."
			]
		}
	};
	return `${JSON.stringify(document, null, Math.max(0, options.jsonIndent ?? 2))}\n`;
}
function suggestedExportName(projectName, suffix, extension) {
	return `${projectName.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_").slice(0, 60) || "project"}_${suffix}_${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19)}.${extension}`;
}
//#endregion
//#region src/main/services/exportService.ts
/** Hard ceiling on a single rendered image, to protect memory. */
var MAX_EXPORT_PIXELS = 8e7;
var ExportService = class {
	paths;
	store;
	logger;
	constructor(paths, store, logger) {
		this.paths = paths;
		this.store = store;
		this.logger = logger;
	}
	context(overrides) {
		const project = this.store.getProject();
		const settings = {
			...this.store.getSettings().export,
			...overrides ?? {}
		};
		return {
			project,
			plan: buildMappingPlan(project),
			settings
		};
	}
	mapOptions(context) {
		return {
			showLabels: context.settings.includeLabels,
			showGrid: context.settings.includeGrid,
			showBorders: context.settings.includeBorders
		};
	}
	defaultDirectory() {
		const settings = this.store.getSettings();
		if (settings.export.directory) return settings.export.directory;
		if (this.store.getProject().settings.exportDirectory) return this.store.getProject().settings.exportDirectory;
		const projectPath = this.store.getProjectPath();
		return projectPath ? node_path.default.join(node_path.default.dirname(projectPath), "Exports") : this.paths.exports;
	}
	async run(request) {
		const startedAt = (/* @__PURE__ */ new Date()).toISOString();
		const context = this.context(request.options);
		const { project, plan, settings } = context;
		const warnings = [];
		const artifacts = [];
		const rootDirectory = request.directory ?? this.defaultDirectory();
		const runDirectory = node_path.default.join(rootDirectory, suggestedExportName(project.meta.name, "export", "folder").replace(/\.folder$/, ""));
		await (0, node_fs_promises.mkdir)(runDirectory, { recursive: true });
		const baseName = sanitiseBase(project.meta.name);
		const kinds = request.kinds.length ? request.kinds : [
			"combined-map",
			"output-map",
			"csv",
			"json"
		];
		const renderOptions = this.mapOptions(context);
		const outputPlans = request.outputIds?.length ? plan.outputs.filter((outputPlan) => request.outputIds.includes(outputPlan.output.id)) : plan.outputs;
		const screenIds = request.screenIds?.length ? new Set(request.screenIds) : null;
		const writeImage = async (kind, label, fileName, image) => {
			if (image.width * image.height > MAX_EXPORT_PIXELS) {
				warnings.push(`Skipped ${label}: ${image.width} × ${image.height} exceeds the ${MAX_EXPORT_PIXELS.toLocaleString()} pixel export limit. Reduce the output resolution or export per output.`);
				return;
			}
			const target = node_path.default.join(runDirectory, fileName);
			const buffer = encodePng(image);
			await (0, node_fs_promises.writeFile)(target, buffer);
			artifacts.push({
				kind,
				label,
				path: target,
				bytes: buffer.length,
				width: image.width,
				height: image.height
			});
		};
		if (kinds.includes("combined-map")) {
			const combined = buildCombinedMapPlan(project, plan);
			if (combined.blocks.length === 0) warnings.push("The combined pixel map is empty because no screen is mapped to an output.");
			await writeImage("combined-map", "Combined pixel map", `${baseName}_combined-map.png`, renderCombinedMap(combined, renderOptions));
		}
		if (kinds.includes("output-map")) for (const outputPlan of outputPlans) await writeImage("output-map", `Output map — ${outputPlan.output.name}`, `${baseName}_output_${sanitiseBase(outputPlan.output.name)}.png`, renderOutputMap(outputPlan, renderOptions));
		if (kinds.includes("screen-guide")) {
			const screens = screenIds ? project.screens.filter((screen) => screenIds.has(screen.id)) : project.screens;
			for (const screen of screens) {
				if (settings.perScreenGuides === false && !screenIds) continue;
				await writeImage("screen-guide", `Screen guide — ${screen.name}`, `${baseName}_screen_${sanitiseBase(screen.name)}.png`, renderScreenGuide(project, screen, {
					showGrid: settings.includeGrid,
					subtitle: `PROJECT ${project.meta.name}`,
					safeAreaPercent: 10
				}));
			}
		}
		if (kinds.includes("stage-layout") || settings.stageLayout) {
			const layoutPlan = buildStageLayoutPlan(project, 250);
			const pxPerMeter = Math.min(240, Math.max(4, 2048 / Math.max(layoutPlan.bounds.width / 1e3, .001)));
			await writeImage("stage-layout", "Stage layout", `${baseName}_stage-layout.png`, renderStageLayout(project, layoutPlan, {
				pxPerMeter,
				showGrid: settings.includeGrid,
				showLabels: settings.includeLabels
			}));
		}
		if (kinds.includes("csv")) {
			const csv = projectToCsv(project, plan, settings.csvDelimiter);
			const target = node_path.default.join(runDirectory, `${baseName}_mapping.csv`);
			await (0, node_fs_promises.writeFile)(target, csv, "utf8");
			const bytes = (await (0, node_fs_promises.stat)(target)).size;
			artifacts.push({
				kind: "csv",
				label: "Mapping table (CSV)",
				path: target,
				bytes
			});
		}
		if (kinds.includes("json")) {
			const json = projectToMappingJson(project, plan, {
				appVersion: this.appVersion(),
				includeIssueDetails: true,
				jsonIndent: settings.jsonIndent
			});
			const target = node_path.default.join(runDirectory, `${baseName}_mapping.json`);
			await (0, node_fs_promises.writeFile)(target, json, "utf8");
			const bytes = (await (0, node_fs_promises.stat)(target)).size;
			artifacts.push({
				kind: "json",
				label: "Mapping document (JSON)",
				path: target,
				bytes
			});
		}
		const errors = plan.issues.filter((issue) => issue.level === "error");
		if (errors.length > 0) warnings.push(`The export contains ${errors.length} mapping error(s). Open Tools → Validate Mapping for the details before using these files.`);
		const report = {
			directory: runDirectory,
			artifacts,
			totalBytes: artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0),
			startedAt,
			finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
			warnings
		};
		this.logger.info("export", `Exported ${artifacts.length} artifact(s) (${Math.round(report.totalBytes / 1024)} KB).`, runDirectory);
		return report;
	}
	/** Builds a downscaled preview image and returns it as a data URL. */
	async preview(request) {
		const context = this.context();
		const { project, plan, settings } = context;
		const renderOptions = {
			...this.mapOptions(context),
			showGrid: settings.includeGrid,
			showLabels: settings.includeLabels
		};
		const maxWidth = Math.max(64, Math.min(4096, request.maxWidth ?? 900));
		const maxHeight = Math.max(64, Math.min(4096, request.maxHeight ?? 520));
		const warnings = [];
		let image;
		let artifacts = [];
		let kind = request.kind;
		switch (request.kind) {
			case "combined-map": {
				const combined = buildCombinedMapPlan(project, plan);
				image = renderCombinedMap(combined, renderOptions);
				artifacts = [{
					label: "Combined pixel map",
					path: `${combined.width} × ${combined.height} px`
				}, ...combined.bands.map((band) => ({
					label: `Band: ${band.outputName}`,
					path: `${band.width} × ${band.height} px at y=${band.y}`
				}))];
				break;
			}
			case "output-map": {
				const target = plan.outputs.find((outputPlan) => outputPlan.output.id === request.outputId) ?? plan.outputs[0];
				if (!target) throw new AppError("E_NOT_FOUND", "This project has no mapping outputs to preview.");
				image = renderOutputMap(target, renderOptions);
				artifacts = [{
					label: `Output: ${target.output.name}`,
					path: `${target.output.width} × ${target.output.height} px`
				}, {
					label: "Coverage",
					path: `${target.coveragePercent}% (${target.coveredPixels.toLocaleString()} px)`
				}];
				break;
			}
			case "screen-guide": {
				const screen = request.screenId ? project.screens.find((s) => s.id === request.screenId) : project.screens[0];
				if (!screen) throw new AppError("E_NOT_FOUND", "Select a screen to preview its guide image.");
				image = renderScreenGuide(project, screen, {
					showGrid: settings.includeGrid,
					subtitle: `PROJECT ${project.meta.name}`
				});
				artifacts = [{
					label: screen.name,
					path: `${screen.pixelWidth} × ${screen.pixelHeight} px native`
				}];
				break;
			}
			case "stage-layout": {
				const layoutPlan = buildStageLayoutPlan(project, 250);
				image = renderStageLayout(project, layoutPlan, {
					pxPerMeter: Math.min(160, Math.max(4, maxWidth / Math.max(layoutPlan.bounds.width / 1e3, .001))),
					showGrid: settings.includeGrid,
					showLabels: settings.includeLabels
				});
				artifacts = [{
					label: "Stage",
					path: `${(project.stage.widthMm / 1e3).toFixed(2)} m × ${(project.stage.heightMm / 1e3).toFixed(2)} m`
				}];
				break;
			}
			default: throw new AppError("E_UNSUPPORTED", `Unknown preview kind "${String(kind)}".`);
		}
		kind = request.kind;
		const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
		const preview = scale < 1 ? resampleImage(image, Math.round(image.width * scale), Math.round(image.height * scale)) : image;
		const dataUrl = `data:image/png;base64,${encodePng(preview).toString("base64")}`;
		if (scale < 1) warnings.push(`Preview downscaled to ${preview.width} × ${preview.height} px. The exported file is ${image.width} × ${image.height} px.`);
		return {
			kind,
			width: image.width,
			height: image.height,
			dataUrl,
			artifacts,
			warnings
		};
	}
	appVersion() {
		return process.env.CUEPOINT_VERSION ?? "1.0.0";
	}
	/** Combined map plan accessor used by diagnostics. */
	combinedPlan(project, plan) {
		return buildCombinedMapPlan(project, plan);
	}
};
function sanitiseBase(name) {
	return name.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_").slice(0, 48) || "project";
}
//#endregion
//#region src/main/services/ndiManager.ts
/**
* Supervises the NDI helper process and transports frames to the renderer.
*
* Frames reach the UI over a dedicated MessagePort, bypassing the JSON-RPC path. Electron
* only allows MessagePorts to be *transferred*, so each frame is structured-cloned once
* per process hop (helper thread -> helper -> main -> renderer); that cost is bounded by
* throttling preview frames inside the helper and by capping the preview resolution. The
* NDI connection itself is never throttled — only the frames sent to the UI are.
*
* Obsolete frames are dropped rather than queued, which keeps memory bounded.
*/
var NdiManager = class extends node_events.EventEmitter {
	helper = null;
	settings;
	logger = getLogger();
	framePort = null;
	webContents = null;
	stopping = false;
	restartTimes = [];
	status = {
		available: false,
		dllPath: null,
		runtimeVersion: null,
		reason: null,
		helperRunning: false,
		helperPid: null,
		helperStartedAt: null,
		lastError: null,
		restartCount: 0
	};
	sources = [];
	stats = /* @__PURE__ */ new Map();
	events;
	helperPath;
	previewMaxWidth = 1920;
	pendingFramePort = false;
	constructor(settings, helperPath, events) {
		super();
		this.settings = settings;
		this.helperPath = helperPath;
		this.events = events;
		const detected = require_detect.findNdiLibrary(settings.dllPathOverride);
		this.status.dllPath = detected.path;
		this.status.available = Boolean(detected.path);
		this.status.reason = detected.path ? null : require_detect.describeNdiSearch(detected);
	}
	attachWebContents(webContents) {
		this.webContents = webContents;
	}
	/**
	* Requests the main process to create the MessagePort that carries NDI frames to the
	* renderer. The preload script already waits for this port over `ndi:framePort`, so we
	* create it as soon as the renderer is attached and we have a helper that has reported
	* `ready`.
	*/
	requestFramePort() {
		if (!this.helper || !this.helper.connected) {
			this.pendingFramePort = true;
			this.logger.warn("ndi", "Frame port request deferred: NDI helper is not connected.");
			return false;
		}
		return this.createFramePort();
	}
	updateSettings(settings) {
		this.settings = settings;
		if (this.helper?.connected) {
			this.command({
				type: "setPreviewFps",
				fps: settings.previewFps
			});
			if (this.status.available) this.command({
				type: "init",
				dllPath: settings.dllPathOverride ?? this.status.dllPath ?? null,
				previewFps: settings.previewFps,
				colorFormat: settings.colorFormat,
				bandwidth: settings.bandwidth,
				allowVideoFields: false,
				maxPreviewWidth: this.previewMaxWidth
			});
		}
	}
	getStatus() {
		return { ...this.status };
	}
	getSources() {
		return [...this.sources];
	}
	getStats() {
		return [...this.stats.values()];
	}
	get connectedCount() {
		return [...this.stats.values()].filter((entry) => entry.connected).length;
	}
	start() {
		if (this.helper) return this.getStatus();
		this.stopping = false;
		if (!(0, node_fs.existsSync)(this.helperPath)) {
			this.status.lastError = `The NDI helper is missing at ${this.helperPath}. Reinstall CuePoint.`;
			this.logger.error("ndi", this.status.lastError);
			this.emitStatus();
			return this.getStatus();
		}
		let child;
		try {
			child = (0, node_child_process.fork)(this.helperPath, [], {
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
					CUEPOINT_NDI_HELPER: "1"
				},
				execArgv: [],
				serialization: "advanced",
				stdio: [
					"ignore",
					"pipe",
					"pipe",
					"ipc"
				]
			});
		} catch (error) {
			this.status.lastError = `The NDI helper could not be started: ${String(error)}`;
			this.logger.error("ndi", this.status.lastError);
			this.emitStatus();
			return this.getStatus();
		}
		this.helper = child;
		this.status.helperRunning = true;
		this.status.helperPid = child.pid ?? null;
		this.status.helperStartedAt = (/* @__PURE__ */ new Date()).toISOString();
		this.logger.info("ndi", `NDI helper started (pid ${child.pid ?? "unknown"}).`, this.helperPath);
		child.on("message", (message) => this.handleHelperMessage(message));
		child.stdout?.on("data", (chunk) => {
			const text = chunk.toString().trim();
			if (text) this.logger.debug("ndi-helper", text);
		});
		child.stderr?.on("data", (chunk) => {
			const text = chunk.toString().trim();
			if (text) this.logger.warn("ndi-helper", text);
		});
		child.on("exit", (code, signal) => {
			const wasRunning = this.status.helperRunning;
			this.helper = null;
			this.status.helperRunning = false;
			this.status.helperPid = null;
			this.closeFramePort();
			for (const [id, entry] of this.stats) this.stats.set(id, {
				...entry,
				connected: false,
				error: "The NDI helper stopped."
			});
			this.emitStats();
			if (this.stopping) {
				this.logger.info("ndi", `NDI helper stopped (code ${code ?? "null"}).`);
				this.emitStatus();
				return;
			}
			this.status.lastError = `The NDI helper exited unexpectedly (code ${code ?? "null"}${signal ? `, signal ${signal}` : ""}).`;
			this.logger.error("ndi", this.status.lastError);
			if (wasRunning) this.scheduleRestart();
			this.emitStatus();
		});
		child.on("error", (error) => {
			this.status.lastError = `NDI helper process error: ${error.message}`;
			this.logger.error("ndi", this.status.lastError, error.stack);
			this.emitStatus();
		});
		this.sendInit();
		this.tryEnsureFramePort();
		this.emitStatus();
		return this.getStatus();
	}
	scheduleRestart() {
		const now = Date.now();
		this.restartTimes = this.restartTimes.filter((time) => now - time < 6e4);
		if (this.restartTimes.length >= 3) {
			this.status.lastError = "The NDI helper crashed 3 times within a minute and was not restarted automatically. Use NDI Studio → Start NDI runtime to try again.";
			this.logger.error("ndi", this.status.lastError);
			this.emitStatus();
			return;
		}
		this.restartTimes.push(now);
		this.status.restartCount += 1;
		const delay = 1e3 * this.restartTimes.length;
		this.logger.warn("ndi", `Restarting the NDI helper in ${delay} ms.`);
		setTimeout(() => {
			if (!this.stopping) this.start();
		}, delay).unref?.();
	}
	stop() {
		this.stopping = true;
		if (!this.helper) return;
		this.command({ type: "shutdown" });
		const child = this.helper;
		setTimeout(() => {
			if (child.exitCode === null && !child.killed) child.kill();
		}, 1500).unref?.();
	}
	async restart() {
		this.stop();
		await new Promise((resolve) => setTimeout(resolve, 600));
		this.helper = null;
		this.status.helperRunning = false;
		return this.start();
	}
	sendInit() {
		if (!this.helper?.connected) return;
		this.command({
			type: "init",
			dllPath: this.settings.dllPathOverride ?? this.status.dllPath ?? null,
			previewFps: this.settings.previewFps,
			colorFormat: this.settings.colorFormat,
			bandwidth: this.settings.bandwidth,
			allowVideoFields: false,
			maxPreviewWidth: this.previewMaxWidth
		});
	}
	tryEnsureFramePort() {
		if (!this.webContents || this.webContents.isDestroyed()) return;
		if (!this.helper || !this.helper.connected) {
			this.pendingFramePort = true;
			return;
		}
		if (this.status.available) this.createFramePort();
	}
	/**
	* Re-creates the frame port after a helper restart so frames resume flowing without the
	* renderer requesting the port again.
	*/
	ensureFramePortAfterRestart() {
		if (!this.webContents || this.webContents.isDestroyed()) return;
		if (!this.helper || !this.helper.connected) {
			this.pendingFramePort = true;
			return;
		}
		this.pendingFramePort = false;
		this.createFramePort();
	}
	command(message) {
		if (!this.helper?.connected) return;
		try {
			this.helper.send(message);
		} catch (error) {
			this.logger.warn("ndi", "Failed to send a command to the NDI helper.", String(error));
		}
	}
	async discover(timeoutMs) {
		if (!this.helper) throw new AppError("E_NDI_HELPER", "The NDI helper is not running.", { hint: "Open NDI Studio and choose Start NDI runtime, then refresh the source list." });
		if (!this.status.available) throw new AppError("E_NDI_UNAVAILABLE", this.status.reason ?? "The NDI runtime is not available.", { hint: "Install the NDI Runtime (on the same machine), restart CuePoint and try again." });
		this.command({
			type: "discover",
			timeoutMs: timeoutMs ?? this.settings.discoveryTimeoutMs
		});
		return this.getSources();
	}
	connect(source) {
		if (!this.helper) throw new AppError("E_NDI_HELPER", "The NDI helper is not running, so sources cannot be received.");
		const existing = this.stats.get(source.id);
		if (existing?.connected) return existing;
		this.stats.set(source.id, {
			sourceId: source.id,
			name: source.name,
			connected: false,
			paused: false,
			width: 0,
			height: 0,
			frameRateNumerator: 0,
			frameRateDenominator: 1,
			fourCC: 0,
			receivedFps: 0,
			renderedFps: 0,
			frameAgeMs: 0,
			averageFrameAgeMs: 0,
			receivedFrames: 0,
			droppedFrames: 0,
			skippedFrames: 0,
			reconnects: 0,
			lastFrameAt: null,
			error: null
		});
		this.command({
			type: "connect",
			sourceId: source.id,
			name: source.name,
			urlAddress: source.urlAddress
		});
		this.emitStats();
		return this.stats.get(source.id);
	}
	disconnect(sourceId) {
		if (!this.stats.has(sourceId)) return false;
		this.command({
			type: "disconnect",
			sourceId
		});
		this.stats.delete(sourceId);
		this.emitStats();
		return true;
	}
	disconnectAll() {
		for (const sourceId of [...this.stats.keys()]) this.command({
			type: "disconnect",
			sourceId
		});
		this.stats.clear();
		this.emitStats();
	}
	setPaused(sourceId, paused) {
		const entry = this.stats.get(sourceId);
		if (!entry) return false;
		this.command({
			type: "pause",
			sourceId,
			paused
		});
		this.stats.set(sourceId, {
			...entry,
			paused
		});
		this.emitStats();
		return true;
	}
	setPreviewFps(fps) {
		this.command({
			type: "setPreviewFps",
			fps
		});
	}
	/** Records a renderer-side measurement (frames actually drawn, and their age). */
	reportRenderStats(sourceId, renderedFps, frameAgeMs) {
		const entry = this.stats.get(sourceId);
		if (!entry) return;
		this.stats.set(sourceId, {
			...entry,
			renderedFps,
			frameAgeMs
		});
	}
	/**
	* Hands a MessagePort to the renderer. The renderer receives frames on it directly,
	* so pixel buffers never pass through JSON or the preload bridge.
	*
	* The `ondemand` pattern (renderer calls `requestPort(ioc)`) works too, but if the
	* renderer never asks for it the UI sees no frames. Creating the port as soon as the
	* helper is ready is the most reliable path for a live-preview tool.
	*/
	createFramePort() {
		if (!this.webContents || this.webContents.isDestroyed()) {
			this.logger.warn("ndi", "Cannot create the NDI frame port: no renderer is attached.");
			return false;
		}
		this.closeFramePort();
		const channel = new electron.MessageChannelMain();
		const port = channel.port1;
		port.on("message", (event) => {
			const data = event.data;
			if (data?.kind === "renderStats" && data.sourceId) this.reportRenderStats(data.sourceId, data.renderedFps ?? 0, data.frameAgeMs ?? 0);
		});
		port.start();
		this.framePort = port;
		this.webContents.postMessage("ndi:framePort", { ok: true }, [channel.port2]);
		this.logger.info("ndi", "NDI frame port established with the renderer.");
		return true;
	}
	closeFramePort() {
		if (!this.framePort) return;
		try {
			this.framePort.close();
		} catch {}
		this.framePort = null;
	}
	handleHelperMessage(message) {
		switch (message.type) {
			case "ready": {
				const nowAvailable = Boolean(message.runtime.available);
				const changed = nowAvailable !== this.status.available || this.status.dllPath !== message.runtime.dllPath || this.status.runtimeVersion !== message.runtime.version;
				this.status.available = nowAvailable;
				this.status.dllPath = message.runtime.dllPath ?? this.status.dllPath;
				this.status.runtimeVersion = message.runtime.version ?? this.status.runtimeVersion;
				this.status.reason = message.runtime.reason ?? null;
				if (nowAvailable && this.status.runtimeVersion === null) this.status.runtimeVersion = this.status.runtimeVersion;
				if (changed || this.status.helperRunning) {
					this.emitStatus();
					this.sendInit();
					if (this.pendingFramePort) {
						this.pendingFramePort = false;
						this.createFramePort();
					} else if (this.status.available && this.webContents && !this.webContents.isDestroyed()) this.ensureFramePortAfterRestart();
				}
				break;
			}
			case "sources": {
				const discoveredAt = (/* @__PURE__ */ new Date()).toISOString();
				this.sources = message.sources.map((source) => ({
					id: source.id,
					name: source.name,
					urlAddress: source.urlAddress,
					groups: source.groups ?? "",
					discoveredAt
				}));
				this.events.onSources(this.getSources());
				break;
			}
			case "sourceState": {
				const entry = this.stats.get(message.sourceId);
				const next = {
					sourceId: message.sourceId,
					name: message.name || entry?.name || message.sourceId,
					connected: message.state === "connected",
					paused: entry?.paused ?? false,
					width: message.width,
					height: message.height,
					frameRateNumerator: message.frameRateNumerator,
					frameRateDenominator: message.frameRateDenominator,
					fourCC: message.fourCC,
					receivedFps: entry?.receivedFps ?? 0,
					renderedFps: entry?.renderedFps ?? 0,
					frameAgeMs: entry?.frameAgeMs ?? 0,
					averageFrameAgeMs: entry?.averageFrameAgeMs ?? 0,
					receivedFrames: entry?.receivedFrames ?? 0,
					droppedFrames: entry?.droppedFrames ?? 0,
					skippedFrames: entry?.skippedFrames ?? 0,
					reconnects: entry?.reconnects ?? 0,
					lastFrameAt: entry?.lastFrameAt ?? null,
					error: message.state === "error" ? message.error : null
				};
				if (message.state === "connected" && next.width > 0) next.lastFrameAt = (/* @__PURE__ */ new Date()).toISOString();
				this.stats.set(message.sourceId, next);
				if (message.state === "error") this.logger.warn("ndi", `Source "${next.name}" reported an error.`, message.error ?? void 0);
				else if (message.state === "connected") this.logger.info("ndi", `Source "${next.name}" connected at ${next.width}x${next.height} ${require_protocol.fourCCLabel(next.fourCC)} (${next.frameRateNumerator}/${next.frameRateDenominator}).`);
				this.emitStats();
				break;
			}
			case "stats": {
				const entry = this.stats.get(message.sourceId);
				if (!entry) break;
				this.stats.set(message.sourceId, {
					...entry,
					receivedFrames: message.receivedFrames,
					droppedFrames: message.droppedFrames,
					skippedFrames: message.skippedFrames,
					receivedFps: message.receivedFps,
					averageFrameAgeMs: message.averageFrameAgeMs,
					reconnects: message.reconnects,
					width: message.width || entry.width,
					height: message.height || entry.height,
					connected: message.receivedFrames > 0 || entry.connected
				});
				this.emitStats();
				break;
			}
			case "frame":
				this.forwardFrame(message);
				break;
			case "log":
				this.logger.log(message.level, "ndi-helper", message.message, message.detail);
				break;
			case "error":
				this.status.lastError = message.message;
				this.logger.error("ndi-helper", message.message, message.detail);
				this.emitStatus();
		}
	}
	forwardFrame(message) {
		const port = this.framePort;
		const entry = this.stats.get(message.sourceId);
		if (entry) {
			const lastFrameAt = (/* @__PURE__ */ new Date()).toISOString();
			this.stats.set(message.sourceId, {
				...entry,
				connected: true,
				lastFrameAt,
				width: message.width || entry.width,
				height: message.height || entry.height
			});
		}
		if (!port) return;
		const buffer = message.buffer.buffer;
		const meta = {
			sourceId: message.sourceId,
			width: message.width,
			height: message.height,
			lineStrideInBytes: message.lineStrideInBytes,
			frameAgeMs: message.frameAgeMs,
			sequence: message.sequence,
			capturedAt: message.capturedAt
		};
		try {
			port.postMessage({
				kind: "frame",
				meta,
				buffer
			});
		} catch (error) {
			this.logger.warn("ndi", "Failed to forward an NDI frame to the renderer.", String(error));
		}
	}
	emitStatus() {
		this.events.onRuntime(this.getStatus());
	}
	emitStats() {
		this.events.onStats(this.getStats());
	}
	getDiagnostics() {
		return {
			helperRunning: this.status.helperRunning,
			helperPid: this.status.helperPid,
			framePortOpen: Boolean(this.framePort),
			connectedSources: this.connectedCount,
			lastError: this.status.lastError
		};
	}
};
//#endregion
//#region src/main/services/recordingService.ts
/** Minimum free space required before a recording may start. */
var MIN_FREE_BYTES = 536870912;
/**
* Recording service.
*
* Encoding happens in the renderer (Chromium's MediaRecorder on a canvas capture
* stream), which keeps the CPU-heavy encoder off the process that also handles NDI
* reception. The main process owns the file: it opens the destination, streams encoded
* chunks to disk, then verifies the finished file by decoding it with FFmpeg and,
* optionally, transcodes it to MP4.
*/
var RecordingService = class {
	paths;
	store;
	logger;
	session = null;
	status = {
		state: "idle",
		entry: null,
		encoder: {
			name: "Chromium MediaRecorder",
			available: true,
			ffmpegPath: null,
			detail: "Not checked yet."
		},
		framesCaptured: 0,
		framesDropped: 0,
		elapsedMs: 0,
		estimatedBytes: 0,
		outputDirectory: null,
		error: null
	};
	startedAt = 0;
	encoderInfo = null;
	listeners = /* @__PURE__ */ new Set();
	constructor(paths, store, logger) {
		this.paths = paths;
		this.store = store;
		this.logger = logger;
	}
	onStatusChange(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	emit() {
		const snapshot = this.getStatus();
		for (const listener of this.listeners) listener(snapshot);
	}
	getStatus() {
		if (this.session && !this.session.closed) {
			this.status.elapsedMs = Date.now() - this.startedAt;
			this.status.framesCaptured = this.session.framesCaptured;
			this.status.framesDropped = this.session.framesDropped;
		}
		return { ...this.status };
	}
	getFfmpegPath() {
		const resolved = resolveUnpackedModule(this.paths, "ffmpeg-static/ffmpeg.exe");
		if (resolved && !resolved.includes("app.asar" + node_path.default.sep)) return resolved;
		try {
			const required = require("ffmpeg-static");
			if (required) return required.replace(`app.asar${node_path.default.sep}`, `app.asar.unpacked${node_path.default.sep}`);
		} catch {}
		return null;
	}
	/** Verifies that FFmpeg is present and usable; result is cached. */
	async checkEncoder(force = false) {
		if (this.encoderInfo && !force) return this.encoderInfo;
		const ffmpegPath = this.getFfmpegPath();
		if (!ffmpegPath) {
			this.encoderInfo = {
				name: "Chromium MediaRecorder",
				available: true,
				ffmpegPath: null,
				detail: "MediaRecorder can capture WebM directly. FFmpeg was not found, so MP4 transcoding and file verification are unavailable."
			};
			return this.encoderInfo;
		}
		try {
			const { code, stdout } = await runProcess(ffmpegPath, ["-hide_banner", "-version"], 15e3);
			const firstLine = stdout.split("\n")[0]?.trim() ?? "";
			const hasX264 = await this.hasEncoder(ffmpegPath, "libx264");
			this.encoderInfo = {
				name: "Chromium MediaRecorder + FFmpeg",
				available: code === 0,
				ffmpegPath,
				detail: code === 0 ? `${firstLine}. MP4 (H.264) transcoding is ${hasX264 ? "available" : "not available in this FFmpeg build"}.` : `FFmpeg exited with code ${code} when asked for its version.`
			};
		} catch (error) {
			this.encoderInfo = {
				name: "Chromium MediaRecorder",
				available: true,
				ffmpegPath,
				detail: `FFmpeg could not be executed (${String(error)}). WebM capture still works; verification is unavailable.`
			};
		}
		this.status.encoder = { ...this.encoderInfo };
		this.emit();
		return this.encoderInfo;
	}
	async hasEncoder(ffmpegPath, name) {
		return hasEncoderImpl(ffmpegPath, name);
	}
	/** Preflight: directory, permissions, disk space, encoder and output path. */
	async preflight(config) {
		const directory = config.outputDirectory ?? this.paths.recordings;
		try {
			await (0, node_fs_promises.mkdir)(directory, { recursive: true });
			await (0, node_fs_promises.access)(directory, node_fs_promises.constants.W_OK);
		} catch (error) {
			const code = error.code;
			throw new AppError(code === "EACCES" || code === "EPERM" ? "E_PERMISSION" : "E_IO", `CuePoint cannot write to the recording folder "${directory}".`, {
				hint: "Choose a different output folder in Recording → Configuration.",
				detail: String(error)
			});
		}
		try {
			const stats = await (0, node_fs_promises.statfs)(directory);
			const free = Number(stats.bavail) * Number(stats.bsize);
			if (Number.isFinite(free) && free < MIN_FREE_BYTES) throw new AppError("E_DISK_FULL", "There is not enough free disk space to start recording.", { hint: `At least ${Math.round(MIN_FREE_BYTES / 1024 / 1024)} MB is required on ${directory}. Free up space or choose another drive.` });
		} catch (error) {
			if (error instanceof AppError) throw error;
			this.logger.warn("recording", "Free disk space could not be determined.", String(error));
		}
		if (config.width * config.height > 33177600) throw new AppError("E_INVALID_INPUT", "The requested recording resolution is too large.", { hint: "Use 7680 × 4320 or smaller." });
		const encoder = await this.checkEncoder();
		this.status = {
			...this.status,
			state: "arming",
			encoder: {
				...encoder,
				ffmpegPath: encoder.ffmpegPath
			},
			outputDirectory: directory,
			error: null,
			framesCaptured: 0,
			framesDropped: 0,
			elapsedMs: 0,
			estimatedBytes: Math.round(config.bitrateMbps * 1e6 / 8 * 60)
		};
		this.emit();
		return this.getStatus();
	}
	/** Creates the destination file and opens it for streaming. */
	async begin(payload) {
		if (this.session && !this.session.closed) throw new AppError("E_RECORDING", "A recording is already in progress.", { hint: "Stop the current recording before starting another one." });
		const directory = payload.config.outputDirectory ?? this.paths.recordings;
		await (0, node_fs_promises.mkdir)(directory, { recursive: true });
		const fileName = buildFileName(payload.config.fileNameTemplate, this.store.getProject().meta.name, payload.label, payload.container);
		const filePath = node_path.default.join(directory, await uniqueFilePath(directory, fileName));
		const stream = (0, node_fs.createWriteStream)(filePath, { flags: "wx" });
		await new Promise((resolve, reject) => {
			stream.once("open", () => resolve());
			stream.once("error", (error) => reject(error));
		});
		this.session = {
			id: newId("rec"),
			filePath,
			stream,
			bytes: 0,
			startedAt: (/* @__PURE__ */ new Date()).toISOString(),
			container: payload.container,
			mimeType: payload.mimeType,
			width: payload.width,
			height: payload.height,
			fps: payload.fps,
			label: payload.label,
			target: payload.config.target,
			framesCaptured: 0,
			framesDropped: 0,
			durationMs: 0,
			closed: false
		};
		this.startedAt = Date.now();
		this.status = {
			...this.status,
			state: "recording",
			outputDirectory: directory,
			error: null
		};
		this.emit();
		return {
			sessionId: this.session.id,
			filePath
		};
	}
	/** Appends an encoded chunk. Back-pressure is applied through the write stream. */
	async push(sessionId, chunk) {
		const session = this.session;
		if (!session || session.id !== sessionId || session.closed) throw new AppError("E_RECORDING", "The recording session is no longer active.", { hint: "Start a new recording." });
		const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
		await new Promise((resolve, reject) => {
			if (session.stream.write(buffer, (error) => {
				if (error) reject(error);
			})) resolve();
			else session.stream.once("drain", () => resolve());
		});
		session.bytes += buffer.length;
		return { bytes: session.bytes };
	}
	setProgress(sessionId, framesCaptured, framesDropped, durationMs) {
		if (!this.session || this.session.id !== sessionId) return;
		this.session.framesCaptured = framesCaptured;
		this.session.framesDropped = framesDropped;
		this.session.durationMs = durationMs;
	}
	pause() {
		if (this.status.state !== "recording") return this.getStatus();
		this.status = {
			...this.status,
			state: "paused"
		};
		this.emit();
		return this.getStatus();
	}
	resume() {
		if (this.status.state !== "paused") return this.getStatus();
		this.status = {
			...this.status,
			state: "recording"
		};
		this.emit();
		return this.getStatus();
	}
	/** Finalises the file, verifies it and (optionally) transcodes it to MP4. */
	async finish(sessionId, payload) {
		const session = this.session;
		if (!session || session.id !== sessionId) throw new AppError("E_RECORDING", "The recording session is no longer active.");
		this.status = {
			...this.status,
			state: "finalizing"
		};
		this.emit();
		await closeStream(session.stream);
		session.closed = true;
		session.durationMs = payload.durationMs;
		session.framesCaptured = payload.framesCaptured;
		session.framesDropped = payload.framesDropped;
		let sizeBytes = session.bytes;
		try {
			sizeBytes = (await (0, node_fs_promises.stat)(session.filePath)).size;
		} catch {}
		if (sizeBytes === 0) {
			const entry = this.buildEntry(session, sizeBytes, "failed", "The recording file is empty; nothing was captured.", null);
			await this.store.upsertRecordingEntry(entry);
			this.session = null;
			this.status = {
				...this.status,
				state: "failed",
				entry,
				error: entry.error
			};
			this.emit();
			return entry;
		}
		let verification = await this.verifyFile(session.filePath);
		let finalPath = session.filePath;
		if (payload.config.container === "mp4" || payload.config.transcodeToMp4) {
			const transcoded = await this.transcode(session.filePath, session.width, session.height).catch((error) => {
				this.logger.warn("recording", "Transcode to MP4 failed; the WebM capture is kept.", String(error));
				return null;
			});
			if (transcoded) {
				finalPath = transcoded;
				sizeBytes = (await (0, node_fs_promises.stat)(transcoded)).size;
				verification = await this.verifyFile(transcoded);
			} else if (payload.config.container === "mp4") this.logger.warn("recording", "MP4 was requested but transcoding was unavailable; the recording was kept as WebM.");
		}
		const entry = this.buildEntry(session, sizeBytes, verification.decodable ? "complete" : "failed", verification.decodable ? null : `The recording could not be decoded: ${verification.detail}`, verification, finalPath);
		await this.store.upsertRecordingEntry(entry);
		this.session = null;
		this.status = {
			...this.status,
			state: entry.state,
			entry,
			error: entry.error,
			framesCaptured: session.framesCaptured,
			framesDropped: session.framesDropped,
			elapsedMs: session.durationMs
		};
		this.emit();
		this.logger.info("recording", `Recording finalised: ${node_path.default.basename(finalPath)} (${Math.round(sizeBytes / 1024)} KB, ${(session.durationMs / 1e3).toFixed(1)} s).`, verification.detail);
		return entry;
	}
	async abort(sessionId, reason) {
		const session = this.session;
		if (!session || session.id !== sessionId) return false;
		await closeStream(session.stream).catch(() => void 0);
		session.closed = true;
		let sizeBytes = session.bytes;
		try {
			sizeBytes = (await (0, node_fs_promises.stat)(session.filePath)).size;
		} catch {
			sizeBytes = 0;
		}
		const entry = this.buildEntry(session, sizeBytes, "failed", reason, null);
		await this.store.upsertRecordingEntry(entry);
		this.session = null;
		this.status = {
			...this.status,
			state: "failed",
			entry,
			error: reason
		};
		this.emit();
		this.logger.warn("recording", `Recording aborted: ${reason}`, session.filePath);
		return true;
	}
	buildEntry(session, sizeBytes, state, error, verified, filePath) {
		return {
			id: session.id,
			filePath: filePath ?? session.filePath,
			target: session.target,
			label: session.label,
			width: session.width,
			height: session.height,
			fps: session.fps,
			container: session.container,
			startedAt: session.startedAt,
			finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
			durationMs: session.durationMs,
			sizeBytes,
			state,
			error,
			verified
		};
	}
	/** Decodes the file with FFmpeg to prove it is playable, and reads back its metadata. */
	async verifyFile(filePath) {
		const ffmpegPath = this.getFfmpegPath();
		const base = {
			checked: false,
			decodable: false,
			container: node_path.default.extname(filePath).replace(".", "") || null,
			videoCodec: null,
			durationSeconds: null,
			frameCount: null,
			width: null,
			height: null,
			detail: "Not verified: FFmpeg is unavailable."
		};
		if (!ffmpegPath) return base;
		try {
			const probe = await runProcess(ffmpegPath, [
				"-hide_banner",
				"-i",
				filePath
			], 3e4, true);
			const output = `${probe.stdout}\n${probe.stderr}`;
			const duration = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(output);
			const video = /Stream #\d+:\d+.*Video:\s*([a-zA-Z0-9_]+)/.exec(output);
			const size = /,\s*(\d{2,5})x(\d{2,5})/.exec(output);
			const durationSeconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null;
			const decode = await runProcess(ffmpegPath, [
				"-hide_banner",
				"-v",
				"error",
				"-i",
				filePath,
				"-f",
				"null",
				"-"
			], 18e4);
			const frames = /frame=\s*(\d+)/.exec(`${decode.stderr}\n${decode.stdout}`);
			return {
				checked: true,
				decodable: decode.code === 0,
				container: base.container,
				videoCodec: video ? video[1] : null,
				durationSeconds,
				frameCount: frames ? Number(frames[1]) : null,
				width: size ? Number(size[1]) : null,
				height: size ? Number(size[2]) : null,
				detail: decode.code === 0 ? `Decoded successfully with FFmpeg (${video ? video[1] : "unknown codec"}${durationSeconds !== null ? `, ${durationSeconds.toFixed(2)} s` : ""}).` : `FFmpeg could not decode the file (exit code ${decode.code}). ${decode.stderr.trim().split("\n").slice(-1)[0] ?? ""}`.trim()
			};
		} catch (error) {
			return {
				...base,
				checked: true,
				detail: `Verification failed: ${String(error)}`
			};
		}
	}
	async verifyEntry(id) {
		const entry = this.store.recordingEntries().find((candidate) => candidate.id === id);
		if (!entry) throw new AppError("E_NOT_FOUND", "That recording is not in the history any more.");
		const verification = await this.verifyFile(entry.filePath);
		const updated = {
			...entry,
			verified: verification,
			state: verification.decodable ? "complete" : "failed",
			error: verification.decodable ? null : `The recording could not be decoded: ${verification.detail}`
		};
		await this.store.upsertRecordingEntry(updated);
		return updated;
	}
	/** Transcodes the captured WebM to H.264 MP4. */
	async transcode(source, width, height) {
		const ffmpegPath = this.getFfmpegPath();
		if (!ffmpegPath) return null;
		if (!await hasEncoderImpl(ffmpegPath, "libx264")) {
			this.logger.warn("recording", "This FFmpeg build has no libx264 encoder; MP4 output is unavailable.");
			return null;
		}
		const target = source.replace(/\.(webm|mp4)$/i, "") + ".mp4";
		const args = [
			"-hide_banner",
			"-y",
			"-i",
			source,
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-crf",
			"20",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			target
		];
		this.logger.info("recording", `Transcoding to MP4 (${width}x${height}).`, target);
		const result = await runProcess(ffmpegPath, args, 18e5);
		if (result.code !== 0) throw new AppError("E_ENCODER", `FFmpeg could not transcode the recording (exit code ${result.code}).`, { detail: result.stderr.slice(-1200) });
		return target;
	}
	getOutputDirectory(config) {
		return config.outputDirectory ?? this.paths.recordings;
	}
};
async function hasEncoderImpl(ffmpegPath, name) {
	try {
		const { stdout } = await runProcess(ffmpegPath, ["-hide_banner", "-encoders"], 15e3);
		return stdout.includes(name);
	} catch {
		return false;
	}
}
function runProcess(command, args, timeoutMs, allowNonZero = false) {
	return new Promise((resolve, reject) => {
		const child = (0, node_child_process.spawn)(command, args, { windowsHide: true });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill();
			reject(/* @__PURE__ */ new Error(`${node_path.default.basename(command)} timed out after ${timeoutMs} ms.`));
		}, timeoutMs);
		child.stdout?.on("data", (chunk) => {
			stdout += chunk.toString();
			if (stdout.length > 2e6) stdout = stdout.slice(-1e6);
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
			if (stderr.length > 2e6) stderr = stderr.slice(-1e6);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0 && !allowNonZero) {
				resolve({
					code: code ?? -1,
					stdout,
					stderr
				});
				return;
			}
			resolve({
				code: code ?? -1,
				stdout,
				stderr
			});
		});
	});
}
function closeStream(stream) {
	return new Promise((resolve) => {
		if (stream.closed) {
			resolve();
			return;
		}
		stream.end(() => resolve());
	});
}
function buildFileName(template, projectName, label, container) {
	const now = /* @__PURE__ */ new Date();
	const pad = (value) => String(value).padStart(2, "0");
	const replacements = {
		"{project}": sanitise(projectName),
		"{target}": sanitise(label),
		"{date}": `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
		"{time}": `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
		"{timestamp}": String(now.getTime())
	};
	let name = template || "CuePoint_{project}_{target}_{date}_{time}";
	for (const [token, value] of Object.entries(replacements)) name = name.split(token).join(value);
	name = sanitise(name);
	return `${name || `CuePoint_${Date.now()}`}.${container}`;
}
function sanitise(value) {
	return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, "_").slice(0, 120);
}
async function uniqueFilePath(directory, fileName) {
	const ext = node_path.default.extname(fileName);
	const base = node_path.default.basename(fileName, ext);
	for (let index = 0; index < 500; index += 1) {
		const candidate = index === 0 ? fileName : `${base}_${index}${ext}`;
		try {
			await (0, node_fs_promises.access)(node_path.default.join(directory, candidate), node_fs_promises.constants.F_OK);
		} catch {
			return candidate;
		}
	}
	return `${base}_${Date.now()}${ext}`;
}
//#endregion
//#region src/main/services/diagnosticsService.ts
/**
* Collects the diagnostics dashboard payload.
*
* Only operational facts are gathered: versions, paths, free space, NDI state and
* recent log entries. No project content, file contents or credentials are included,
* so the report is safe to share.
*/
var DiagnosticsService = class {
	deps;
	constructor(deps) {
		this.deps = deps;
	}
	async report() {
		const { paths, store, ndi, recording } = this.deps;
		const logger = getLogger();
		const project = store.getProject();
		const mappingPlan = buildMappingPlan(project);
		const validation = validateProject(project);
		const counts = issuesByLevel(mappingPlan);
		const recordingStatus = recording.getStatus();
		const recentProjectPath = store.getProjectPath();
		const libraryStats = await store.libraryStats();
		let projectBytes = null;
		if (recentProjectPath) try {
			projectBytes = (await (0, node_fs_promises.stat)(recentProjectPath)).size;
		} catch {
			projectBytes = 0;
		}
		const recordingDirectory = recording.getOutputDirectory(store.getSettings().recording);
		const projectPath = store.getProjectPath();
		const exportDirectory = store.getSettings().export.directory ?? (projectPath ? node_path.default.join(node_path.default.dirname(projectPath), "Exports") : paths.exports);
		return {
			generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			app: {
				name: "CuePoint",
				version: this.deps.appVersion,
				packaged: electron.app.isPackaged,
				locale: electron.app.getLocale()
			},
			runtime: {
				electron: process.versions.electron ?? "unknown",
				chrome: process.versions.chrome ?? "unknown",
				node: process.versions.node,
				v8: process.versions.v8 ?? "unknown",
				os: `${node_os.default.type()} ${node_os.default.release()}`,
				arch: process.arch
			},
			hardware: {
				cpuModel: node_os.default.cpus()[0]?.model ?? "unknown",
				cpuCount: node_os.default.cpus().length,
				totalMemoryMb: Math.round(node_os.default.totalmem() / 1024 / 1024),
				freeMemoryMb: Math.round(node_os.default.freemem() / 1024 / 1024),
				appMemoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
			},
			paths: {
				userData: paths.userData,
				logs: paths.logs,
				libraryDatabase: paths.library,
				projectDirectory: recentProjectPath ? node_path.default.dirname(recentProjectPath) : null,
				exportDirectory,
				recordingDirectory
			},
			database: {
				libraryPath: paths.library,
				libraryBytes: libraryStats.bytes,
				librarySchema: 1,
				projectPath: recentProjectPath,
				projectBytes,
				projectSchema: recentProjectPath ? project.schemaVersion : null,
				recentProjects: libraryStats.recent
			},
			storage: {
				exportDrive: node_path.default.parse(exportDirectory).root || null,
				exportFreeBytes: await freeSpace(exportDirectory),
				recordingDrive: node_path.default.parse(recordingDirectory).root || null,
				recordingFreeBytes: await freeSpace(recordingDirectory)
			},
			ndi: ndi.getStatus(),
			ndiSources: ndi.getStats(),
			recording: {
				state: recordingStatus.state,
				lastFile: recordingStatus.entry?.filePath ?? null,
				lastVerified: recordingStatus.entry?.verified ?? null,
				encoderAvailable: recordingStatus.encoder.available,
				encoderDetail: recordingStatus.encoder.detail
			},
			project: {
				path: recentProjectPath,
				screens: project.screens.length,
				outputs: project.outputs.length,
				validationErrors: validation.errors,
				mappingIssues: counts
			},
			logs: {
				recentWarnings: logger.recent(25, "warn").map((entry) => `${entry.ts} [${entry.scope}] ${entry.message}`),
				recentErrors: logger.recent(25, "error").map((entry) => `${entry.ts} [${entry.scope}] ${entry.message}`)
			}
		};
	}
	logs(query = {}) {
		return getLogger().recent(Math.min(Math.max(query.limit ?? 200, 1), 500), query.level, query.scope);
	}
	clearLogs() {
		getLogger().info("diagnostics", "The in-memory log buffer was cleared by the operator.");
		return true;
	}
	/** Plain-text report used by Help → Copy diagnostic report. */
	async reportText() {
		const report = await this.report();
		return [
			`${report.app.name} ${report.app.version} diagnostic report`,
			`Generated: ${report.generatedAt}`,
			"",
			"Runtime",
			`  Electron ${report.runtime.electron} (Chromium ${report.runtime.chrome}, Node ${report.runtime.node})`,
			`  OS ${report.runtime.os} ${report.runtime.arch} · packaged: ${report.app.packaged}`,
			`  CPU ${report.hardware.cpuModel} (${report.hardware.cpuCount} logical cores)`,
			`  Memory ${report.hardware.appMemoryMb} MB used by CuePoint of ${report.hardware.totalMemoryMb} MB total`,
			"",
			"Storage",
			`  User data: ${report.paths.userData}`,
			`  Library:   ${report.paths.libraryDatabase} (${report.database.libraryBytes} bytes)`,
			`  Project:   ${report.database.projectPath ?? "none open"}`,
			`  Exports:   ${report.paths.exportDirectory} (free ${formatBytes(report.storage.exportFreeBytes)})`,
			`  Recording: ${report.paths.recordingDirectory} (free ${formatBytes(report.storage.recordingFreeBytes)})`,
			"",
			"NDI",
			`  Runtime available: ${report.ndi.available}`,
			`  Library: ${report.ndi.dllPath ?? "not found"}`,
			`  Version: ${report.ndi.runtimeVersion ?? "unknown"}`,
			`  Helper running: ${report.ndi.helperRunning} (pid ${report.ndi.helperPid ?? "n/a"}, restarts ${report.ndi.restartCount})`,
			`  Reason: ${report.ndi.reason ?? "none"}`,
			...report.ndiSources.map((source) => `  Source "${source.name}": ${source.connected ? "connected" : "not connected"}, ${source.width}x${source.height}, recv ${source.receivedFps} fps, rendered ${source.renderedFps} fps, age ${source.frameAgeMs} ms, dropped ${source.droppedFrames}, skipped ${source.skippedFrames}`),
			"",
			"Recording",
			`  State: ${report.recording.state}`,
			`  Last file: ${report.recording.lastFile ?? "none"}`,
			`  Encoder: ${report.recording.encoderDetail}`,
			`  Verification: ${report.recording.lastVerified?.detail ?? "no recording verified yet"}`,
			"",
			"Project",
			`  Screens: ${report.project.screens} · Outputs: ${report.project.outputs}`,
			`  Validation errors: ${report.project.validationErrors.length}`,
			`  Mapping issues: ${report.project.mappingIssues.error} error(s), ${report.project.mappingIssues.warning} warning(s), ${report.project.mappingIssues.info} info`,
			...report.project.validationErrors.map((error) => `    ! ${error}`),
			"",
			"Recent warnings",
			...report.logs.recentWarnings.length ? report.logs.recentWarnings.map((line) => `  ${line}`) : ["  none"],
			"",
			"Recent errors",
			...report.logs.recentErrors.length ? report.logs.recentErrors.map((line) => `  ${line}`) : ["  none"]
		].join("\n");
	}
};
async function freeSpace(target) {
	try {
		const stats = await (0, node_fs_promises.statfs)(target);
		return Number(stats.bavail) * Number(stats.bsize);
	} catch {
		return null;
	}
}
function formatBytes(bytes) {
	if (bytes === null || !Number.isFinite(bytes)) return "unknown";
	const units = [
		"B",
		"KB",
		"MB",
		"GB",
		"TB"
	];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
//#endregion
//#region src/main/services/imageProbe.ts
var SUPPORTED_IMAGE_EXTENSIONS = [
	"png",
	"jpg",
	"jpeg",
	"webp",
	"bmp",
	"gif"
];
function probeImage(buffer) {
	return probePng(buffer) ?? probeJpeg(buffer) ?? probeWebp(buffer) ?? probeGif(buffer) ?? probeBmp(buffer);
}
function probePng(buffer) {
	if (buffer.length < 24) return null;
	const signature = [
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	];
	for (let i = 0; i < signature.length; i += 1) if (buffer[i] !== signature[i]) return null;
	if (buffer[12] !== 73 || buffer[13] !== 72 || buffer[14] !== 68 || buffer[15] !== 82) return null;
	return {
		width: readUint32(buffer, 16),
		height: readUint32(buffer, 20),
		format: "png"
	};
}
function probeJpeg(buffer) {
	if (buffer.length < 4 || buffer[0] !== 255 || buffer[1] !== 216) return null;
	let offset = 2;
	while (offset + 9 < buffer.length) {
		if (buffer[offset] !== 255) {
			offset += 1;
			continue;
		}
		const marker = buffer[offset + 1];
		if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204) return {
			height: buffer[offset + 5] << 8 | buffer[offset + 6],
			width: buffer[offset + 7] << 8 | buffer[offset + 8],
			format: "jpeg"
		};
		const length = buffer[offset + 2] << 8 | buffer[offset + 3];
		if (length <= 0) return null;
		offset += 2 + length;
	}
	return null;
}
function probeWebp(buffer) {
	if (buffer.length < 30) return null;
	const riff = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
	const webp = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
	if (riff !== "RIFF" || webp !== "WEBP") return null;
	const chunk = String.fromCharCode(buffer[12], buffer[13], buffer[14], buffer[15]);
	if (chunk === "VP8X") return {
		width: 1 + (buffer[24] | buffer[25] << 8 | buffer[26] << 16),
		height: 1 + (buffer[27] | buffer[28] << 8 | buffer[29] << 16),
		format: "webp"
	};
	if (chunk === "VP8 ") return {
		width: (buffer[26] | buffer[27] << 8) & 16383,
		height: (buffer[28] | buffer[29] << 8) & 16383,
		format: "webp"
	};
	if (chunk === "VP8L") {
		const bits = buffer[21] | buffer[22] << 8 | buffer[23] << 16 | buffer[24] << 24;
		return {
			width: (bits & 16383) + 1,
			height: (bits >> 14 & 16383) + 1,
			format: "webp"
		};
	}
	return null;
}
function probeGif(buffer) {
	if (buffer.length < 10) return null;
	const header = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3], buffer[4], buffer[5]);
	if (header !== "GIF87a" && header !== "GIF89a") return null;
	return {
		width: buffer[6] | buffer[7] << 8,
		height: buffer[8] | buffer[9] << 8,
		format: "gif"
	};
}
function probeBmp(buffer) {
	if (buffer.length < 26) return null;
	if (buffer[0] !== 66 || buffer[1] !== 77) return null;
	return {
		width: Math.abs(readInt32(buffer, 18)),
		height: Math.abs(readInt32(buffer, 22)),
		format: "bmp"
	};
}
function readUint32(buffer, offset) {
	return (buffer[offset] << 24 >>> 0) + (buffer[offset + 1] << 16) + (buffer[offset + 2] << 8) + buffer[offset + 3];
}
function readInt32(buffer, offset) {
	return buffer[offset] << 24 | buffer[offset + 1] << 16 | buffer[offset + 2] << 8 | buffer[offset + 3];
}
function extensionOf(filePath) {
	const match = /\.([a-z0-9]+)$/i.exec(filePath);
	return match ? match[1].toLowerCase() : "";
}
function isSupportedImagePath(filePath) {
	return SUPPORTED_IMAGE_EXTENSIONS.includes(extensionOf(filePath));
}
//#endregion
//#region src/main/constants.ts
var APP_NAME = "CuePoint";
/** Subtle product credit shown in the status bar, About dialog and documentation. */
var APP_COPYRIGHT = "© 2026 Sandila Fernando";
/** Uses the packaged application version so About always matches the installed build. */
var APP_VERSION = electron.app?.getVersion?.() ?? "1.0.0";
var DOC_FILES = [
	{
		id: "user-manual",
		file: "USER_MANUAL.md",
		title: "CuePoint User Manual",
		description: "Complete operator guide: projects, stage design, mapping, NDI and recording."
	},
	{
		id: "architecture",
		file: "ARCHITECTURE.md",
		title: "Architecture",
		description: "How the Electron processes, NDI helper, storage and export pipeline fit together."
	},
	{
		id: "testing",
		file: "TESTING.md",
		title: "Testing & Measurements",
		description: "Automated test coverage and the measured performance results for this build."
	},
	{
		id: "troubleshooting",
		file: "TROUBLESHOOTING.md",
		title: "Troubleshooting",
		description: "Common problems, error messages and how to resolve them."
	},
	{
		id: "user-manual-pdf",
		file: "CuePoint_User_Manual.pdf",
		title: "User Manual (PDF)",
		description: "Printable version of the user manual."
	}
];
//#endregion
//#region src/main/ipc.ts
/**
* Registers every IPC handler.
*
* Every handler is wrapped in `guard`, so a failure becomes a typed
* `{ ok: false, error }` envelope instead of a rejected promise, and every mutating
* handler validates its arguments before touching the file system.
*/
function registerIpcHandlers(context) {
	const { paths, store, exporter, ndi, recording, diagnostics } = context;
	const logger = getLogger();
	const withWindow = (fn) => {
		const window = context.getWindow();
		if (!window || window.isDestroyed()) throw new AppError("E_INTERNAL", "The CuePoint window is not available.");
		return fn(window);
	};
	electron.ipcMain.handle(IPC.app.info, () => guard("app.info", () => ({
		name: "CuePoint",
		version: APP_VERSION,
		electron: process.versions.electron ?? "unknown",
		chrome: process.versions.chrome ?? "unknown",
		node: process.versions.node,
		platform: process.platform,
		arch: process.arch,
		packaged: electron.app.isPackaged,
		userDataPath: paths.userData,
		logsPath: paths.logs,
		docsPath: paths.docs,
		workspacePath: paths.appRoot,
		license: "MIT",
		author: "Sandila Fernando",
		copyright: APP_COPYRIGHT
	})));
	electron.ipcMain.handle(IPC.app.settings, () => guard("app.settings", () => store.getSettings()));
	electron.ipcMain.handle(IPC.app.saveSettings, (_event, patch) => guard("app.saveSettings", async () => {
		assert(patch && typeof patch === "object", "Settings payload is required.");
		const normalized = normalizeSettings({
			...store.getSettings(),
			...patch
		});
		const saved = await store.saveSettings(normalized);
		ndi.updateSettings(saved.ndi);
		return saved;
	}));
	electron.ipcMain.handle(IPC.app.window, (_event, action) => guard("app.window", () => withWindow((window) => {
		switch (action) {
			case "minimize":
				window.minimize();
				return true;
			case "maximize":
				if (window.isMaximized()) window.unmaximize();
				else window.maximize();
				return window.isMaximized();
			case "close":
				window.close();
				return true;
			default: throw new AppError("E_INVALID_INPUT", `Unknown window action "${String(action)}".`);
		}
	})));
	electron.ipcMain.handle(IPC.app.isMaximized, () => guard("app.isMaximized", () => withWindow((window) => window.isMaximized())));
	electron.ipcMain.handle(IPC.app.chooseDirectory, (_event, options) => guard("app.chooseDirectory", async () => {
		const window = context.getWindow();
		const result = await electron.dialog.showOpenDialog(window ?? void 0, {
			title: options?.title ?? "Choose a folder",
			defaultPath: options?.defaultPath,
			properties: [
				"openDirectory",
				"createDirectory",
				"promptToCreate"
			]
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		return result.filePaths[0];
	}));
	electron.ipcMain.handle(IPC.app.chooseFile, (_event, options) => guard("app.chooseFile", async () => {
		const window = context.getWindow();
		const result = await electron.dialog.showOpenDialog(window ?? void 0, {
			title: options?.title ?? "Choose a file",
			defaultPath: options?.defaultPath,
			filters: options?.filters ?? [{
				name: "Images",
				extensions: SUPPORTED_IMAGE_EXTENSIONS
			}, {
				name: "All files",
				extensions: ["*"]
			}],
			properties: ["openFile"]
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		return result.filePaths[0];
	}));
	electron.ipcMain.handle(IPC.app.openExternal, (_event, url) => guard("app.openExternal", async () => {
		const target = requireString(url, "URL");
		assert(/^https?:\/\//i.test(target), "Only http and https links can be opened.");
		await electron.shell.openExternal(target);
		return true;
	}));
	electron.ipcMain.handle(IPC.app.openPath, (_event, target) => guard("app.openPath", async () => {
		const value = requireString(target, "Path");
		const error = await electron.shell.openPath(value);
		if (error) throw new AppError("E_IO", error, { hint: "Check that the file still exists and that you have access to it." });
		return true;
	}));
	electron.ipcMain.handle(IPC.app.revealPath, (_event, target) => guard("app.revealPath", async () => {
		const value = requireString(target, "Path");
		if (!(0, node_fs.existsSync)(value)) throw new AppError("E_NOT_FOUND", `"${value}" no longer exists.`, { hint: "The file may have been moved or deleted outside CuePoint." });
		electron.shell.showItemInFolder(value);
		return true;
	}));
	electron.ipcMain.handle(IPC.app.clipboardWrite, (_event, text) => guard("app.clipboardWrite", () => {
		assert(typeof text === "string", "Clipboard text must be a string.");
		electron.clipboard.writeText(text.slice(0, 2e5));
		return true;
	}));
	electron.ipcMain.handle(IPC.app.clipboardRead, () => guard("app.clipboardRead", () => electron.clipboard.readText()));
	electron.ipcMain.handle(IPC.app.setMenuState, (_event, patch) => guard("app.setMenuState", () => {
		assert(patch && typeof patch === "object", "A menu state payload is required.");
		context.setMenuState(patch);
		return true;
	}));
	electron.ipcMain.handle(IPC.project.create, (_event, request) => guard("project.create", async () => {
		assert(request && typeof request === "object", "A project request is required.");
		const name = requireString(request.name, "Project name", 120);
		const directory = typeof request.directory === "string" && request.directory ? request.directory : paths.projects;
		return await store.createProject({
			name,
			author: typeof request.author === "string" ? request.author : "",
			directory,
			stageWidthMm: Number(request.stageWidthMm ?? 12e3),
			stageHeightMm: Number(request.stageHeightMm ?? 6e3),
			defaultUnit: request.defaultUnit ?? "m",
			backgroundAssetPath: typeof request.backgroundAssetPath === "string" && request.backgroundAssetPath ? request.backgroundAssetPath : null,
			initialScreenCount: Number(request.initialScreenCount ?? 0),
			outputs: Array.isArray(request.outputs) ? request.outputs : void 0
		});
	}));
	electron.ipcMain.handle(IPC.project.openDialog, () => guard("project.openDialog", async () => {
		const window = context.getWindow();
		const result = await electron.dialog.showOpenDialog(window ?? void 0, {
			title: "Open CuePoint project",
			defaultPath: paths.projects,
			filters: [{
				name: "CuePoint projects",
				extensions: [PROJECT_EXTENSION]
			}, {
				name: "All files",
				extensions: ["*"]
			}],
			properties: ["openFile"]
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		return toOpenResult(await store.openProject(result.filePaths[0]));
	}));
	electron.ipcMain.handle(IPC.project.openPath, (_event, projectPath) => guard("project.openPath", async () => {
		return toOpenResult(await store.openProject(requireString(projectPath, "Project path")));
	}));
	electron.ipcMain.handle(IPC.project.current, () => guard("project.current", () => {
		if (!store.getProjectPath()) throw new AppError("E_NOT_FOUND", "No project is currently open.");
		return store.getProject();
	}));
	electron.ipcMain.handle(IPC.project.save, () => guard("project.save", async () => {
		if (!store.getProjectPath()) return null;
		return store.saveCurrent("manual");
	}));
	electron.ipcMain.handle(IPC.project.saveAs, (_event, directory) => guard("project.saveAs", async () => {
		let target = typeof directory === "string" && directory ? directory : "";
		if (!target) {
			const window = context.getWindow();
			const result = await electron.dialog.showOpenDialog(window ?? void 0, {
				title: "Choose a folder for this project",
				defaultPath: store.getProjectPath() ? node_path.default.dirname(store.getProjectPath()) : paths.projects,
				properties: [
					"openDirectory",
					"createDirectory",
					"promptToCreate"
				]
			});
			if (result.canceled || result.filePaths.length === 0) return null;
			target = result.filePaths[0];
		}
		return store.saveAs(target);
	}));
	electron.ipcMain.handle(IPC.project.apply, (_event, payload) => guard("project.apply", async () => {
		assert(payload?.project && typeof payload.project === "object", "A project payload is required.");
		const incoming = payload.project;
		assert(Array.isArray(incoming.screens), "The project payload has no screens array.");
		assert(Array.isArray(incoming.outputs), "The project payload has no outputs array.");
		assert(incoming.stage && typeof incoming.stage === "object", "The project payload has no stage.");
		store.setProject({
			...incoming,
			schemaVersion: 2
		}, { reason: payload.reason });
		return { dirty: store.isDirty() };
	}));
	electron.ipcMain.handle(IPC.project.validate, () => guard("project.validate", () => {
		const project = store.getProject();
		const validation = validateProject(project);
		const plan = buildMappingPlan(project);
		return {
			errors: validation.errors,
			warnings: validation.warnings,
			mappingIssues: plan.issues,
			summary: store.summary()
		};
	}));
	electron.ipcMain.handle(IPC.project.recent, () => guard("project.recent", () => store.recentProjects()));
	electron.ipcMain.handle(IPC.project.forgetRecent, (_event, projectPath) => guard("project.forgetRecent", async () => {
		await store.forgetRecent(requireString(projectPath, "Project path"));
		return true;
	}));
	electron.ipcMain.handle(IPC.project.pinRecent, (_event, payload) => guard("project.pinRecent", async () => {
		const target = requireString(payload?.path, "Project path");
		await store.pinRecent(target, Boolean(payload?.pinned));
		return true;
	}));
	electron.ipcMain.handle(IPC.project.duplicate, (_event, payload) => guard("project.duplicate", async () => {
		const source = requireString(payload?.path, "Project path");
		const result = await store.duplicateProject(source, payload?.newName);
		return toOpenResult(await store.openProject(result.path));
	}));
	electron.ipcMain.handle(IPC.project.rename, (_event, newName) => guard("project.rename", async () => store.renameProject(requireString(newName, "Project name", 120))));
	electron.ipcMain.handle(IPC.project.snapshots, (_event, projectPath) => guard("project.snapshots", () => store.snapshots(typeof projectPath === "string" ? projectPath : void 0)));
	electron.ipcMain.handle(IPC.project.restoreSnapshot, (_event, id) => guard("project.restoreSnapshot", async () => {
		const snapshot = (await store.snapshots()).find((candidate) => candidate.id === id);
		if (!snapshot) throw new AppError("E_NOT_FOUND", "That recovery snapshot is no longer available.");
		if (!(0, node_fs.existsSync)(snapshot.path)) throw new AppError("E_NOT_FOUND", "The recovery snapshot file is missing from disk.");
		const target = snapshot.projectPath;
		if ((0, node_fs.existsSync)(target)) await (0, node_fs_promises.copyFile)(target, `${target}.pre-restore.bak`).catch(() => void 0);
		await (0, node_fs_promises.copyFile)(snapshot.path, target);
		return toOpenResult(await store.openProject(target));
	}));
	electron.ipcMain.handle(IPC.project.deleteSnapshot, (_event, id) => guard("project.deleteSnapshot", () => store.deleteSnapshot(Number(id))));
	electron.ipcMain.handle(IPC.project.markClean, (_event, projectPath) => guard("project.markClean", () => {
		store.markClean(typeof projectPath === "string" ? projectPath : void 0);
		return true;
	}));
	electron.ipcMain.handle(IPC.stage.probeAsset, (_event, assetPath) => guard("stage.probeAsset", async () => {
		return probeAsset(requireString(assetPath, "Asset path"));
	}));
	electron.ipcMain.handle(IPC.stage.importBackground, () => guard("stage.importBackground", async () => {
		const window = context.getWindow();
		const result = await electron.dialog.showOpenDialog(window ?? void 0, {
			title: "Import stage background",
			filters: [{
				name: "Images",
				extensions: SUPPORTED_IMAGE_EXTENSIONS
			}, {
				name: "All files",
				extensions: ["*"]
			}],
			properties: ["openFile"]
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		const source = result.filePaths[0];
		const info = await probeAsset(source);
		await (0, node_fs_promises.mkdir)(paths.assets, { recursive: true });
		const target = uniquePath(node_path.default.join(paths.assets, `${sanitiseFileName(node_path.default.basename(source, node_path.default.extname(source)))}${node_path.default.extname(source)}`));
		await (0, node_fs_promises.copyFile)(source, target);
		logger.info("stage", "Background imported.", `${source} -> ${target}`);
		return {
			...info,
			copiedTo: target
		};
	}));
	electron.ipcMain.handle(IPC.stage.readAssetDataUrl, (_event, assetPath) => guard("stage.readAssetDataUrl", async () => {
		const target = requireString(assetPath, "Asset path");
		if (!(0, node_fs.existsSync)(target)) throw new AppError("E_NOT_FOUND", `The background image "${node_path.default.basename(target)}" was not found.`, { hint: "Import the image again, or choose a different file." });
		assert((await (0, node_fs_promises.stat)(target)).size <= 67108864, "That image is larger than the 64 MB limit for stage backgrounds.");
		const buffer = await (0, node_fs_promises.readFile)(target);
		const probed = probeImage(buffer);
		return `data:${probed?.format === "png" ? "image/png" : probed?.format === "jpeg" ? "image/jpeg" : probed?.format === "webp" ? "image/webp" : probed?.format === "gif" ? "image/gif" : probed?.format === "bmp" ? "image/bmp" : "application/octet-stream"};base64,${buffer.toString("base64")}`;
	}));
	electron.ipcMain.handle(IPC.stage.clearBackground, (_event, deleteFile) => guard("stage.clearBackground", async () => {
		const project = store.getProject();
		const assetPath = project.stage.background.assetPath;
		project.stage.background.assetPath = null;
		project.stage.background.assetMissing = false;
		project.stage.background.sourceWidth = null;
		project.stage.background.sourceHeight = null;
		store.setProject(project, { reason: "background-cleared" });
		if (deleteFile && assetPath && assetPath.startsWith(paths.assets)) await (0, node_fs_promises.unlink)(assetPath).catch(() => void 0);
		return true;
	}));
	async function probeAsset(target) {
		if (!(0, node_fs.existsSync)(target)) throw new AppError("E_NOT_FOUND", `"${target}" could not be found.`);
		if (isSupportedImagePath(target)) {}
		const info = await (0, node_fs_promises.stat)(target);
		if (info.size > 67108864) throw new AppError("E_UNSUPPORTED", "That image is larger than the 64 MB limit for stage backgrounds.");
		const probed = probeImage(await (0, node_fs_promises.readFile)(target));
		if (!probed) throw new AppError("E_UNSUPPORTED", `"${node_path.default.basename(target)}" is not a readable PNG, JPEG, WebP, BMP or GIF image.`, { hint: "Choose a different file, or re-export the image from your image editor." });
		if (probed.width < 16 || probed.height < 16) throw new AppError("E_UNSUPPORTED", "Stage backgrounds must be at least 16 × 16 pixels.");
		const extension = extensionOf(target);
		const warning = extension && !SUPPORTED_IMAGE_EXTENSIONS.includes(extension) ? `The file extension ".${extension}" does not match the detected ${probed.format.toUpperCase()} data.` : null;
		return {
			path: target,
			width: probed.width,
			height: probed.height,
			bytes: info.size,
			format: probed.format,
			copiedTo: null,
			warning
		};
	}
	electron.ipcMain.handle(IPC.export.run, (_event, request) => guard("export.run", async () => {
		assert(request && typeof request === "object", "An export request is required.");
		assert(Array.isArray(request.kinds), "The export request must list at least one kind.");
		return exporter.run(request);
	}));
	electron.ipcMain.handle(IPC.export.preview, (_event, request) => guard("export.preview", async () => {
		assert(request && typeof request === "object", "A preview request is required.");
		return exporter.preview(request);
	}));
	electron.ipcMain.handle(IPC.export.defaultDirectory, () => guard("export.defaultDirectory", async () => {
		const settings = store.getSettings();
		const directory = settings.export.directory ?? paths.exports;
		if (settings.export.directory) return directory;
		const window = context.getWindow();
		const result = await electron.dialog.showOpenDialog(window ?? void 0, {
			title: "Choose an export folder",
			defaultPath: directory,
			properties: [
				"openDirectory",
				"createDirectory",
				"promptToCreate"
			]
		});
		if (result.canceled || result.filePaths.length === 0) return directory;
		await store.saveSettings({ export: {
			...settings.export,
			directory: result.filePaths[0]
		} });
		return result.filePaths[0];
	}));
	electron.ipcMain.handle(IPC.ndi.status, () => guard("ndi.status", () => ndi.getStatus()));
	electron.ipcMain.handle(IPC.ndi.start, () => guard("ndi.start", async () => {
		return ndi.start();
	}));
	electron.ipcMain.handle(IPC.ndi.stop, () => guard("ndi.stop", () => {
		ndi.stop();
		return ndi.getStatus();
	}));
	electron.ipcMain.handle(IPC.ndi.discover, (_event, timeoutMs) => guard("ndi.discover", async () => ndi.discover(typeof timeoutMs === "number" ? timeoutMs : void 0)));
	electron.ipcMain.handle(IPC.ndi.connect, (_event, source) => guard("ndi.connect", () => {
		assert(source && typeof source.name === "string" && source.name.trim().length > 0, "A source name is required.");
		return ndi.connect({
			id: source.id || source.name,
			name: source.name,
			urlAddress: typeof source.urlAddress === "string" ? source.urlAddress : "",
			groups: typeof source.groups === "string" ? source.groups : ""
		});
	}));
	electron.ipcMain.handle(IPC.ndi.disconnect, (_event, sourceId) => guard("ndi.disconnect", () => ndi.disconnect(requireString(sourceId, "Source id"))));
	electron.ipcMain.handle(IPC.ndi.setPaused, (_event, payload) => guard("ndi.setPaused", () => ndi.setPaused(requireString(payload?.sourceId, "Source id"), Boolean(payload?.paused))));
	electron.ipcMain.handle(IPC.ndi.setPreviewFps, (_event, fps) => guard("ndi.setPreviewFps", async () => {
		const value = Math.round(Number(fps));
		assert(Number.isFinite(value) && value >= 1 && value <= 120, "Preview frame rate must be between 1 and 120.");
		const settings = store.getSettings();
		await store.saveSettings({ ndi: {
			...settings.ndi,
			previewFps: value
		} });
		ndi.setPreviewFps(value);
		return true;
	}));
	electron.ipcMain.handle(IPC.ndi.stats, () => guard("ndi.stats", () => ndi.getStats()));
	electron.ipcMain.handle(IPC.ndi.requestPort, () => guard("ndi.requestPort", () => ndi.createFramePort()));
	electron.ipcMain.handle(IPC.recording.status, () => guard("recording.status", () => recording.getStatus()));
	electron.ipcMain.handle(IPC.recording.start, (_event, config) => guard("recording.start", async () => {
		const settings = store.getSettings();
		const merged = normalizeSettings({
			...settings,
			recording: {
				...settings.recording,
				...config ?? {}
			}
		});
		assert(merged.recording.target !== "screen" || merged.recording.screenId, "Select a screen to record.");
		assert(merged.recording.target !== "ndi" || merged.recording.ndiSourceId, "Select an NDI source to record.");
		return recording.preflight(merged.recording);
	}));
	electron.ipcMain.handle(IPC.recording.pause, () => guard("recording.pause", () => recording.pause()));
	electron.ipcMain.handle(IPC.recording.resume, () => guard("recording.resume", () => recording.resume()));
	electron.ipcMain.handle(IPC.recording.begin, (_event, payload) => guard("recording.begin", async () => {
		assert(payload && typeof payload === "object", "A recording payload is required.");
		assert(typeof payload.mimeType === "string" && payload.mimeType.length > 0, "A MIME type is required.");
		const settings = store.getSettings();
		return recording.begin({
			...payload,
			config: settings.recording
		});
	}));
	electron.ipcMain.handle(IPC.recording.receiveChunk, (_event, sessionId, chunk) => guard("recording.push", async () => {
		assert(chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk), "A binary chunk is required.");
		const bytes = new Uint8Array(chunk);
		return recording.push(requireString(sessionId, "Session id"), bytes);
	}));
	electron.ipcMain.handle(IPC.recording.finalize, (_event, sessionId, payload) => guard("recording.finalize", async () => {
		const settings = store.getSettings();
		return recording.finish(requireString(sessionId, "Session id"), {
			durationMs: Number(payload?.durationMs ?? 0),
			framesCaptured: Number(payload?.framesCaptured ?? 0),
			framesDropped: Number(payload?.framesDropped ?? 0),
			config: settings.recording
		});
	}));
	electron.ipcMain.handle(IPC.recording.cancel, (_event, sessionId, reason) => guard("recording.cancel", () => recording.abort(requireString(sessionId, "Session id"), reason || "Cancelled by the operator.")));
	electron.ipcMain.handle(IPC.recording.stop, () => guard("recording.stop", () => {
		recording.setProgress("", 0, 0, 0);
		return recording.getStatus();
	}));
	electron.ipcMain.handle(IPC.recording.entries, () => guard("recording.entries", () => store.recordingEntries()));
	electron.ipcMain.handle(IPC.recording.deleteEntry, (_event, payload) => guard("recording.deleteEntry", async () => {
		const id = requireString(payload?.id, "Recording id");
		const entry = store.recordingEntries().find((candidate) => candidate.id === id);
		if (payload?.deleteFile && entry && (0, node_fs.existsSync)(entry.filePath)) await (0, node_fs_promises.unlink)(entry.filePath).catch(() => void 0);
		return store.deleteRecordingEntry(id);
	}));
	electron.ipcMain.handle(IPC.recording.verify, (_event, id) => guard("recording.verify", () => recording.verifyEntry(requireString(id, "Recording id"))));
	electron.ipcMain.handle(IPC.recording.openFolder, () => guard("recording.openFolder", async () => {
		const directory = recording.getOutputDirectory(store.getSettings().recording);
		await (0, node_fs_promises.mkdir)(directory, { recursive: true });
		const error = await electron.shell.openPath(directory);
		if (error) throw new AppError("E_IO", error);
		return true;
	}));
	electron.ipcMain.handle(IPC.recording.checkEncoder, () => guard("recording.checkEncoder", () => recording.checkEncoder(true)));
	electron.ipcMain.handle(IPC.recording.config, () => guard("recording.config", () => store.getSettings().recording));
	electron.ipcMain.handle(IPC.diagnostics.report, () => guard("diagnostics.report", () => diagnostics.report()));
	electron.ipcMain.handle(IPC.diagnostics.logs, (_event, query) => guard("diagnostics.logs", () => diagnostics.logs(query ?? {})));
	electron.ipcMain.handle(IPC.diagnostics.clearLogs, () => guard("diagnostics.clearLogs", () => {
		logger.info("diagnostics", "Log view cleared.");
		return true;
	}));
	electron.ipcMain.handle(IPC.diagnostics.writeReport, () => guard("diagnostics.writeReport", async () => {
		const text = await diagnostics.reportText();
		const target = node_path.default.join(paths.logs, `diagnostic-report-${Date.now()}.txt`);
		await (0, node_fs_promises.writeFile)(target, text, "utf8");
		return target;
	}));
	electron.ipcMain.handle(IPC.docs.list, () => guard("docs.list", () => DOC_FILES.map((doc) => ({
		id: doc.id,
		title: doc.title,
		description: doc.description,
		path: node_path.default.join(paths.docs, doc.file),
		exists: (0, node_fs.existsSync)(node_path.default.join(paths.docs, doc.file))
	}))));
	electron.ipcMain.handle(IPC.docs.read, (_event, id) => guard("docs.read", async () => {
		const doc = DOC_FILES.find((candidate) => candidate.id === id);
		if (!doc) throw new AppError("E_NOT_FOUND", "That document is not part of this build.");
		const target = node_path.default.join(paths.docs, doc.file);
		if (!(0, node_fs.existsSync)(target)) throw new AppError("E_NOT_FOUND", `The document "${doc.title}" was not installed with this build.`, { hint: "Reinstall CuePoint, or open the documentation next to the installer." });
		return (0, node_fs_promises.readFile)(target, "utf8");
	}));
	electron.ipcMain.handle(IPC.docs.open, (_event, id) => guard("docs.open", async () => {
		const doc = DOC_FILES.find((candidate) => candidate.id === id);
		if (!doc) throw new AppError("E_NOT_FOUND", "That document is not part of this build.");
		const target = node_path.default.join(paths.docs, doc.file);
		if (!(0, node_fs.existsSync)(target)) throw new AppError("E_NOT_FOUND", `The document "${doc.title}" was not installed with this build.`);
		const error = await electron.shell.openPath(target);
		if (error) throw new AppError("E_IO", error);
		return true;
	}));
	logger.info("ipc", `Registered ${countHandlers()} IPC handlers.`);
}
function countHandlers() {
	return Object.values(IPC).reduce((sum, group) => sum + Object.keys(group).length, 0);
}
function toOpenResult(opened) {
	return {
		path: opened.path,
		directory: opened.directory,
		migrations: opened.migrations,
		missingAssets: opened.missingAssets,
		backupPath: opened.backupPath
	};
}
function sendToRenderer(window, channel, payload) {
	if (!window || window.isDestroyed()) return;
	window.webContents.send(channel, payload);
}
//#endregion
//#region src/main/menu.ts
/**
* Builds the native application menu.
*
* Menu items call back into `runCommand`, which dispatches the command to the renderer
* (single source of truth for workspace state) or handles it in the main process.
*
* Actions marked `owner: 'renderer'` in the shortcut catalog are registered with
* `registerAccelerator: false`: the accelerator is still displayed, but the key is left
* to the renderer so normal text editing inside inputs keeps working.
*/
function buildApplicationMenu(context) {
	const item = (id) => {
		const action = SHORTCUT_BY_ID[id];
		const accelerator = action?.default;
		return {
			label: action?.label ?? id,
			accelerator,
			registerAccelerator: action?.owner !== "renderer",
			click: () => context.runCommand(id)
		};
	};
	const state = context.getState();
	const template = [
		{
			label: "&File",
			submenu: [
				item("file.new"),
				item("file.open"),
				{ type: "separator" },
				{
					...item("file.save"),
					enabled: state.hasProject
				},
				{
					...item("file.saveAs"),
					enabled: state.hasProject
				},
				{ type: "separator" },
				item("file.importBackground"),
				{
					...item("file.export"),
					enabled: state.hasProject
				},
				{ type: "separator" },
				{
					...item("file.projectProperties"),
					enabled: state.hasProject
				},
				{
					...item("file.revealProject"),
					enabled: state.hasProject
				},
				{ type: "separator" },
				{
					role: "quit",
					label: "Exit",
					accelerator: "Alt+F4"
				}
			]
		},
		{
			label: "&Edit",
			submenu: [
				{
					...item("edit.undo"),
					enabled: state.canUndo
				},
				{
					...item("edit.redo"),
					enabled: state.canRedo
				},
				{ type: "separator" },
				item("edit.cut"),
				item("edit.copy"),
				item("edit.paste"),
				item("edit.duplicate"),
				{
					...item("edit.delete"),
					enabled: state.hasSelection
				},
				{ type: "separator" },
				item("edit.selectAll"),
				{
					...item("edit.clearSelection"),
					enabled: state.hasSelection
				},
				{ type: "separator" },
				item("edit.preferences")
			]
		},
		{
			label: "&View",
			submenu: [
				item("view.zoomIn"),
				item("view.zoomOut"),
				item("view.fitStage"),
				item("view.fitSelection"),
				item("view.resetView"),
				{ type: "separator" },
				{
					...item("view.toggleGrid"),
					type: "checkbox",
					checked: state.gridVisible
				},
				{
					...item("view.toggleSnap"),
					type: "checkbox",
					checked: state.snapEnabled
				},
				{
					...item("view.toggleGuides"),
					type: "checkbox",
					checked: state.guidesVisible
				},
				{ type: "separator" },
				{
					...item("view.toggleLeftPanel"),
					type: "checkbox",
					checked: state.leftPanelVisible
				},
				{
					...item("view.toggleInspector"),
					type: "checkbox",
					checked: state.inspectorVisible
				},
				{ type: "separator" },
				{
					...item("view.fullscreen"),
					type: "checkbox",
					checked: state.isFullScreen
				}
			]
		},
		{
			label: "&Tools",
			submenu: [
				item("tools.home"),
				item("tools.stageDesigner"),
				item("tools.pixelMapping"),
				item("tools.ndiStudio"),
				item("tools.recording"),
				{ type: "separator" },
				item("tools.settings"),
				item("tools.diagnostics"),
				item("tools.help"),
				{ type: "separator" },
				item("tools.validateProject"),
				item("tools.validateMapping")
			]
		},
		{
			label: "&Screens",
			submenu: [
				item("screen.add"),
				{
					...item("screen.rename"),
					enabled: state.selectionCount === 1
				},
				item("screen.duplicate"),
				{
					...item("screen.lock"),
					enabled: state.hasSelection
				},
				{
					...item("screen.hide"),
					enabled: state.hasSelection
				},
				{ type: "separator" },
				item("edit.clearSelection")
			]
		},
		{
			label: "&NDI",
			submenu: [
				item("ndi.refresh"),
				item("ndi.connect"),
				{
					...item("ndi.disconnectAll"),
					enabled: state.ndiConnected > 0
				}
			]
		},
		{
			label: "&Recording",
			submenu: [
				{
					...item("recording.start"),
					enabled: !state.recording
				},
				{
					...item("recording.stop"),
					enabled: state.recording
				},
				{ type: "separator" },
				item("recording.openFolder")
			]
		},
		{
			label: "&Help",
			submenu: [
				item("help.manual"),
				item("help.shortcuts"),
				item("help.troubleshooting"),
				{ type: "separator" },
				item("help.openLogs"),
				item("help.copyDiagnostics"),
				{ type: "separator" },
				item("help.about")
			]
		}
	];
	return electron.Menu.buildFromTemplate(template);
}
IPC.events.command;
//#endregion
//#region src/main/index.ts
if (!electron.app.requestSingleInstanceLock()) electron.app.quit();
var mainWindow = null;
var paths;
var store;
var exporter;
var ndi;
var recording;
var diagnostics;
var quitting = false;
var rendererReady = false;
var dirtySuppressed = false;
var windowStateFile = () => node_path.default.join(paths.userData, "window-state.json");
function loadWindowState() {
	const fallback = {
		width: 1440,
		height: 900,
		maximized: false
	};
	try {
		const raw = JSON.parse((0, node_fs.readFileSync)(windowStateFile(), "utf8"));
		return {
			width: typeof raw.width === "number" && raw.width >= 960 ? raw.width : fallback.width,
			height: typeof raw.height === "number" && raw.height >= 640 ? raw.height : fallback.height,
			x: typeof raw.x === "number" ? raw.x : void 0,
			y: typeof raw.y === "number" ? raw.y : void 0,
			maximized: raw.maximized === true
		};
	} catch {
		return fallback;
	}
}
function saveWindowState(window) {
	try {
		const bounds = window.getNormalBounds();
		const payload = {
			width: bounds.width,
			height: bounds.height,
			x: bounds.x,
			y: bounds.y,
			maximized: window.isMaximized()
		};
		(0, node_fs.writeFileSync)(windowStateFile(), JSON.stringify(payload, null, 2), "utf8");
	} catch {}
}
var CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"media-src 'self' blob: data:",
	"connect-src 'self' ws://localhost:* http://localhost:*",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'"
].join("; ");
function applySecurityPolicy() {
	electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		callback({ responseHeaders: {
			...details.responseHeaders,
			"Content-Security-Policy": [CSP],
			"X-Content-Type-Options": ["nosniff"]
		} });
	});
	electron.session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
		callback(false);
	});
	electron.session.defaultSession.setPermissionCheckHandler(() => false);
}
function hardenWebContents(window) {
	const contents = window.webContents;
	contents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//i.test(url)) electron.shell.openExternal(url);
		return { action: "deny" };
	});
	contents.on("will-navigate", (event, url) => {
		const devUrl = process.env.ELECTRON_RENDERER_URL;
		if (!(devUrl ? url.startsWith(devUrl) : url.startsWith("file://"))) {
			event.preventDefault();
			getLogger().warn("security", "Blocked a navigation attempt outside the application.", url);
		}
	});
	contents.on("will-attach-webview", (event) => {
		event.preventDefault();
	});
	contents.on("render-process-gone", (_event, details) => {
		getLogger().error("renderer", `The renderer process ended (${details.reason}).`, `exitCode=${details.exitCode}`);
		if (!quitting && details.reason !== "clean-exit") {
			electron.dialog.showMessageBoxSync({
				type: "error",
				title: `${APP_NAME} — interface restarted`,
				message: "The CuePoint interface stopped unexpectedly and has been reloaded.",
				detail: "Your project is still open in memory. If your most recent edits are missing, use File → Open and choose the project, then check Home → Recovery snapshots."
			});
			window.reload();
		}
	});
}
function createWindow() {
	const state = loadWindowState();
	const options = {
		width: state.width,
		height: state.height,
		minWidth: 1024,
		minHeight: 640,
		show: false,
		backgroundColor: "#101318",
		autoHideMenuBar: false,
		title: APP_NAME,
		titleBarStyle: "hidden",
		titleBarOverlay: {
			color: "#161a20",
			symbolColor: "#c9d4e3",
			height: 38
		},
		icon: resolveWindowIcon(),
		webPreferences: {
			preload: node_path.default.join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webSecurity: true,
			spellcheck: false,
			devTools: !electron.app.isPackaged
		}
	};
	if (typeof state.x === "number" && typeof state.y === "number") {
		options.x = state.x;
		options.y = state.y;
	}
	const window = new electron.BrowserWindow(options);
	hardenWebContents(window);
	window.once("ready-to-show", () => {
		if (state.maximized) window.maximize();
		window.show();
	});
	window.on("resize", () => saveWindowState(window));
	window.on("move", () => saveWindowState(window));
	window.on("maximize", () => {
		saveWindowState(window);
		sendToRenderer(window, IPC.events.dirtyState, currentDirtyState());
	});
	window.on("unmaximize", () => {
		saveWindowState(window);
		sendToRenderer(window, IPC.events.dirtyState, currentDirtyState());
	});
	window.on("close", (event) => {
		if (quitting) return;
		if (handleCloseRequest(window)) event.preventDefault();
	});
	window.on("closed", () => {
		mainWindow = null;
	});
	const devUrl = process.env.ELECTRON_RENDERER_URL;
	if (devUrl) window.loadURL(devUrl);
	else window.loadFile(node_path.default.join(__dirname, "../renderer/index.html"));
	return window;
}
function resolveWindowIcon() {
	return [
		node_path.default.join(process.resourcesPath ?? "", "icon.ico"),
		node_path.default.join(electron.app.getAppPath(), "assets", "icon.ico"),
		node_path.default.join(electron.app.getAppPath(), "build", "icon.ico")
	].find((candidate) => candidate && (0, node_fs.existsSync)(candidate));
}
function currentDirtyState() {
	const state = store.getCurrent();
	return {
		dirty: state.dirty,
		savedAt: state.lastSavedAt,
		autosaveAt: state.autosaveAt,
		path: state.projectPath
	};
}
/** Returns true when the close should be cancelled. */
function handleCloseRequest(window) {
	if (!store.isDirty() || dirtySuppressed) {
		saveWindowState(window);
		return false;
	}
	const choice = electron.dialog.showMessageBoxSync(window, {
		type: "warning",
		buttons: [
			"Save",
			"Don't save",
			"Cancel"
		],
		defaultId: 0,
		cancelId: 2,
		title: "Unsaved changes",
		message: `Save changes to "${store.getProject().meta.name}" before closing?`,
		detail: "CuePoint keeps autosave snapshots, but they are recovery copies. Saving writes the project to its file."
	});
	if (choice === 2) return true;
	if (choice === 0) try {
		if (store.getProjectPath()) store.saveCurrent("close");
		else {
			const target = electron.dialog.showOpenDialogSync(window, {
				title: "Choose a folder to save this project in",
				defaultPath: paths.projects,
				properties: [
					"openDirectory",
					"createDirectory",
					"promptToCreate"
				]
			});
			if (!target || target.length === 0) return true;
			store.saveAs(target[0]);
		}
	} catch (error) {
		electron.dialog.showErrorBox("CuePoint could not save the project", String(error));
		return true;
	}
	saveWindowState(window);
	return false;
}
var menuState = {
	canUndo: false,
	canRedo: false,
	hasSelection: false,
	selectionCount: 0,
	dirty: false,
	hasProject: false,
	gridVisible: true,
	snapEnabled: true,
	guidesVisible: true,
	leftPanelVisible: true,
	inspectorVisible: true,
	isFullScreen: false,
	recording: false,
	ndiConnected: 0
};
function refreshMenu() {
	electron.Menu.setApplicationMenu(buildApplicationMenu({
		getWindow: () => mainWindow,
		getState: () => ({
			...menuState,
			isFullScreen: mainWindow?.isFullScreen() ?? false,
			ndiConnected: ndi?.connectedCount ?? 0
		}),
		runCommand: (command) => runCommand(command)
	}));
}
/** Commands the main process can execute itself; everything else goes to the renderer. */
function runCommand(command) {
	const window = mainWindow;
	switch (command) {
		case "view.fullscreen":
			if (window) window.setFullScreen(!window.isFullScreen());
			refreshMenu();
			return;
		case "app.exit":
			electron.app.quit();
			return;
		case "ndi.disconnectAll":
			ndi?.disconnectAll();
			refreshMenu();
			return;
		case "help.openLogs":
			electron.shell.openPath(paths.logs);
			return;
	}
	if (window && rendererReady) sendToRenderer(window, IPC.events.command, command);
	else if (window) window.webContents.once("did-finish-load", () => sendToRenderer(window, IPC.events.command, command));
}
function bootstrap() {
	electron.app.setAppUserModelId("com.sandilafernando.cuepoint");
	electron.app.setName(APP_NAME);
	electron.nativeTheme.themeSource = "dark";
	paths = resolveAppPaths(electron.app);
	const logger = createLogger({
		directory: paths.logs,
		level: "info",
		keepFiles: 10
	});
	logger.info("app", `${APP_NAME} ${APP_VERSION} starting.`, `userData=${paths.userData}`);
	logger.info("app", APP_COPYRIGHT);
	store = new ProjectStore(paths, logger, {
		onDirtyState: (state) => {
			menuState.dirty = state.dirty;
			menuState.hasProject = Boolean(state.path);
			refreshMenu();
			sendToRenderer(mainWindow, IPC.events.dirtyState, state);
		},
		onProjectSaved: (result) => {
			refreshMenu();
			logger.debug("store", `Saved ${result.screenCount} screens.`, result.path);
		},
		onWarning: (message, detail) => {
			sendToRenderer(mainWindow, IPC.events.toast, {
				id: `warn-${Date.now()}`,
				level: "warning",
				message,
				detail,
				timeoutMs: 9e3
			});
		}
	});
	applySecurityPolicy();
	store.init().then(() => {
		exporter = new ExportService(paths, store, logger);
		ndi = new NdiManager(store.getSettings().ndi, node_path.default.join(__dirname, "ndi-helper.js"), {
			onRuntime: (status) => sendToRenderer(mainWindow, IPC.events.ndiRuntime, status),
			onSources: (sources) => sendToRenderer(mainWindow, IPC.events.ndiSources, sources),
			onStats: (stats) => {
				sendToRenderer(mainWindow, IPC.events.ndiStats, stats);
				menuState.ndiConnected = ndi.connectedCount;
				refreshMenu();
			}
		});
		recording = new RecordingService(paths, store, logger);
		recording.onStatusChange((status) => {
			sendToRenderer(mainWindow, IPC.events.recording, status);
			menuState.recording = status.state === "recording" || status.state === "paused" || status.state === "finalizing";
			refreshMenu();
		});
		diagnostics = new DiagnosticsService({
			paths,
			store,
			ndi,
			recording,
			appVersion: APP_VERSION
		});
		mainWindow = createWindow();
		ndi.attachWebContents(mainWindow.webContents);
		ndi.requestFramePort();
		registerIpcHandlers({
			paths,
			store,
			exporter,
			ndi,
			recording,
			diagnostics,
			getWindow: () => mainWindow,
			setDirtySuppressed: (value) => {
				dirtySuppressed = value;
			},
			setMenuState: (patch) => {
				menuState = {
					...menuState,
					...patch
				};
				refreshMenu();
			}
		});
		mainWindow.webContents.on("did-finish-load", () => {
			rendererReady = true;
			sendToRenderer(mainWindow, IPC.events.dirtyState, currentDirtyState());
			if (store.getSettings().ndi.autoStartHelper) {
				const status = ndi.start();
				sendToRenderer(mainWindow, IPC.events.ndiRuntime, status);
			}
		});
		mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
			logger.error("renderer", `The interface failed to load (${code} ${description}).`, url);
		});
		refreshMenu();
		store.cleanupTemporaryFiles();
		logger.rotate();
	}).catch((error) => {
		logger.error("app", "CuePoint failed to start.", String(error));
		electron.dialog.showErrorBox(`${APP_NAME} could not start`, [
			"CuePoint could not initialise its application data.",
			"",
			String(error),
			"",
			`Folder: ${paths?.userData ?? "unknown"}`
		].join("\n"));
		electron.app.quit();
	});
}
electron.app.whenReady().then(bootstrap);
electron.app.on("second-instance", () => {
	if (mainWindow) {
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	}
});
electron.app.on("window-all-closed", () => {
	electron.app.quit();
});
electron.app.on("activate", () => {
	if (electron.BrowserWindow.getAllWindows().length === 0 && store) {
		mainWindow = createWindow();
		if (ndi) ndi.attachWebContents(mainWindow.webContents);
	}
});
electron.app.on("before-quit", () => {
	quitting = true;
	const logger = getLogger();
	try {
		ndi?.stop();
		store?.close();
		logger.info("app", "CuePoint shutting down.");
		logger.flushNow();
	} catch {}
});
process.on("uncaughtException", (error) => {
	getLogger().error("main", "Unhandled exception in the main process.", error.stack ?? String(error));
});
process.on("unhandledRejection", (reason) => {
	getLogger().error("main", "Unhandled promise rejection in the main process.", String(reason));
});
//#endregion
