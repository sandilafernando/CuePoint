let electron = require("electron");
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
//#region src/preload/index.ts
var framePortWaiters = [];
var pendingFramePort = null;
electron.ipcRenderer.on("ndi:framePort", (event) => {
	const port = event.ports?.[0];
	if (!port) return;
	const waiter = framePortWaiters.shift();
	if (waiter) waiter(port);
	else pendingFramePort = port;
});
/** Hands the port to whoever asks for it first, buffering it if nobody is listening yet. */
function takeFramePort(callback) {
	if (pendingFramePort) {
		const port = pendingFramePort;
		pendingFramePort = null;
		callback(port);
		return;
	}
	framePortWaiters.push(callback);
}
function subscribe(channel, handler) {
	const listener = (_event, payload) => handler(payload);
	electron.ipcRenderer.on(channel, listener);
	return () => {
		electron.ipcRenderer.removeListener(channel, listener);
	};
}
var activeFramePort = null;
electron.contextBridge.exposeInMainWorld("cuepoint", {
	app: {
		info: () => electron.ipcRenderer.invoke(IPC.app.info),
		getSettings: () => electron.ipcRenderer.invoke(IPC.app.settings),
		saveSettings: (settings) => electron.ipcRenderer.invoke(IPC.app.saveSettings, settings),
		window: (action) => electron.ipcRenderer.invoke(IPC.app.window, action),
		isMaximized: () => electron.ipcRenderer.invoke(IPC.app.isMaximized),
		chooseDirectory: (options) => electron.ipcRenderer.invoke(IPC.app.chooseDirectory, options),
		chooseFile: (options) => electron.ipcRenderer.invoke(IPC.app.chooseFile, options),
		openExternal: (url) => electron.ipcRenderer.invoke(IPC.app.openExternal, url),
		openPath: (target) => electron.ipcRenderer.invoke(IPC.app.openPath, target),
		revealPath: (target) => electron.ipcRenderer.invoke(IPC.app.revealPath, target),
		writeClipboard: (text) => electron.ipcRenderer.invoke(IPC.app.clipboardWrite, text),
		readClipboard: () => electron.ipcRenderer.invoke(IPC.app.clipboardRead),
		setMenuState: (state) => electron.ipcRenderer.invoke(IPC.app.setMenuState, state),
		onCommand: (handler) => subscribe(IPC.events.command, handler),
		onToast: (handler) => subscribe(IPC.events.toast, handler),
		onSettingsChanged: (handler) => subscribe(IPC.events.settingsChanged, handler),
		onDirtyState: (handler) => subscribe(IPC.events.dirtyState, handler),
		onCloseRequested: (handler) => subscribe(IPC.events.closeRequested, handler)
	},
	project: {
		create: (request) => electron.ipcRenderer.invoke(IPC.project.create, request),
		openDialog: () => electron.ipcRenderer.invoke(IPC.project.openDialog),
		openPath: (projectPath) => electron.ipcRenderer.invoke(IPC.project.openPath, projectPath),
		current: () => electron.ipcRenderer.invoke(IPC.project.current),
		save: () => electron.ipcRenderer.invoke(IPC.project.save),
		saveAs: (directory) => electron.ipcRenderer.invoke(IPC.project.saveAs, directory),
		apply: (project, options) => electron.ipcRenderer.invoke(IPC.project.apply, {
			project,
			reason: options?.reason
		}),
		validate: () => electron.ipcRenderer.invoke(IPC.project.validate),
		recent: () => electron.ipcRenderer.invoke(IPC.project.recent),
		forgetRecent: (projectPath) => electron.ipcRenderer.invoke(IPC.project.forgetRecent, projectPath),
		pinRecent: (projectPath, pinned) => electron.ipcRenderer.invoke(IPC.project.pinRecent, {
			path: projectPath,
			pinned
		}),
		duplicate: (projectPath, newName) => electron.ipcRenderer.invoke(IPC.project.duplicate, {
			path: projectPath,
			newName
		}),
		rename: (newName) => electron.ipcRenderer.invoke(IPC.project.rename, newName),
		snapshots: (projectPath) => electron.ipcRenderer.invoke(IPC.project.snapshots, projectPath),
		restoreSnapshot: (id) => electron.ipcRenderer.invoke(IPC.project.restoreSnapshot, id),
		deleteSnapshot: (id) => electron.ipcRenderer.invoke(IPC.project.deleteSnapshot, id),
		onChanged: (handler) => subscribe(IPC.events.projectChanged, handler)
	},
	stage: {
		importBackground: () => electron.ipcRenderer.invoke(IPC.stage.importBackground),
		probeAsset: (assetPath) => electron.ipcRenderer.invoke(IPC.stage.probeAsset, assetPath),
		readAssetDataUrl: (assetPath) => electron.ipcRenderer.invoke(IPC.stage.readAssetDataUrl, assetPath),
		clearBackground: (deleteFile) => electron.ipcRenderer.invoke(IPC.stage.clearBackground, deleteFile)
	},
	export: {
		run: (request) => electron.ipcRenderer.invoke(IPC.export.run, request),
		preview: (request) => electron.ipcRenderer.invoke(IPC.export.preview, request),
		defaultDirectory: () => electron.ipcRenderer.invoke(IPC.export.defaultDirectory)
	},
	ndi: {
		status: () => electron.ipcRenderer.invoke(IPC.ndi.status),
		start: () => electron.ipcRenderer.invoke(IPC.ndi.start),
		stop: () => electron.ipcRenderer.invoke(IPC.ndi.stop),
		discover: (timeoutMs) => electron.ipcRenderer.invoke(IPC.ndi.discover, timeoutMs),
		connect: (source) => electron.ipcRenderer.invoke(IPC.ndi.connect, source),
		disconnect: (sourceId) => electron.ipcRenderer.invoke(IPC.ndi.disconnect, sourceId),
		setPaused: (sourceId, paused) => electron.ipcRenderer.invoke(IPC.ndi.setPaused, {
			sourceId,
			paused
		}),
		setPreviewFps: (fps) => electron.ipcRenderer.invoke(IPC.ndi.setPreviewFps, fps),
		stats: () => electron.ipcRenderer.invoke(IPC.ndi.stats),
		requestPort: () => electron.ipcRenderer.invoke(IPC.ndi.requestPort),
		/**
		* Hands the raw MessagePort to the renderer. Reading frames in the renderer avoids a
		* second copy of every pixel buffer through the bridge.
		*/
		attachFramePort: (callback) => {
			let active = true;
			takeFramePort((port) => {
				if (!active) {
					try {
						port.close();
					} catch {}
					return;
				}
				activeFramePort = port;
				callback(port);
			});
			return () => {
				active = false;
			};
		},
		/** Fallback used when the renderer cannot use a raw port. */
		onFrames: (handler) => {
			let active = true;
			takeFramePort((port) => {
				if (!active) return;
				activeFramePort = port;
				port.onmessage = (event) => {
					if (event.data?.kind === "frame") handler(event.data.meta, event.data.buffer);
				};
				port.start();
			});
			return () => {
				active = false;
			};
		},
		reportRenderStats: (sourceId, renderedFps, frameAgeMs) => {
			const port = activeFramePort;
			if (!port) return;
			try {
				port.postMessage({
					kind: "renderStats",
					sourceId,
					renderedFps,
					frameAgeMs
				});
			} catch {}
		},
		onStats: (handler) => subscribe(IPC.events.ndiStats, handler),
		onRuntime: (handler) => subscribe(IPC.events.ndiRuntime, handler),
		onSources: (handler) => subscribe(IPC.events.ndiSources, handler)
	},
	recording: {
		status: () => electron.ipcRenderer.invoke(IPC.recording.status),
		start: (config) => electron.ipcRenderer.invoke(IPC.recording.start, config),
		pause: () => electron.ipcRenderer.invoke(IPC.recording.pause),
		resume: () => electron.ipcRenderer.invoke(IPC.recording.resume),
		stop: () => electron.ipcRenderer.invoke(IPC.recording.stop),
		cancel: () => electron.ipcRenderer.invoke(IPC.recording.cancel),
		begin: (payload) => electron.ipcRenderer.invoke(IPC.recording.begin, payload),
		push: (sessionId, chunk) => electron.ipcRenderer.invoke(IPC.recording.receiveChunk, sessionId, chunk),
		finish: (sessionId, payload) => electron.ipcRenderer.invoke(IPC.recording.finalize, sessionId, payload),
		abort: (sessionId, reason) => electron.ipcRenderer.invoke(IPC.recording.cancel, sessionId, reason),
		entries: () => electron.ipcRenderer.invoke(IPC.recording.entries),
		deleteEntry: (id, deleteFile) => electron.ipcRenderer.invoke(IPC.recording.deleteEntry, {
			id,
			deleteFile
		}),
		verify: (id) => electron.ipcRenderer.invoke(IPC.recording.verify, id),
		openFolder: () => electron.ipcRenderer.invoke(IPC.recording.openFolder),
		checkEncoder: () => electron.ipcRenderer.invoke(IPC.recording.checkEncoder),
		config: () => electron.ipcRenderer.invoke(IPC.recording.config),
		onStatus: (handler) => subscribe(IPC.events.recording, handler)
	},
	diagnostics: {
		report: () => electron.ipcRenderer.invoke(IPC.diagnostics.report),
		logs: (query) => electron.ipcRenderer.invoke(IPC.diagnostics.logs, query),
		clearLogs: () => electron.ipcRenderer.invoke(IPC.diagnostics.clearLogs),
		writeReport: () => electron.ipcRenderer.invoke(IPC.diagnostics.writeReport)
	},
	docs: {
		list: () => electron.ipcRenderer.invoke(IPC.docs.list),
		read: (id) => electron.ipcRenderer.invoke(IPC.docs.read, id),
		open: (id) => electron.ipcRenderer.invoke(IPC.docs.open, id)
	}
});
//#endregion
