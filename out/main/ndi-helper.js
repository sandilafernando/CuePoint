const require_rolldown_runtime = require("./chunks/rolldown-runtime-VH7oDXx4.js");
const require_detect = require("./chunks/detect-NkY9Vl0e.js");
let node_path = require("node:path");
node_path = require_rolldown_runtime.__toESM(node_path);
let node_worker_threads = require("node:worker_threads");
//#region src/main/ndi/ndiHelperMain.ts
/**
* NDI helper process.
*
* Runs as a separate Node process (Electron started with ELECTRON_RUN_AS_NODE) so that
* the NDI runtime is never loaded into the UI process. It owns:
*   - runtime discovery (a short lived 'discover' worker),
*   - one 'receive' worker thread per connected source,
*   - worker crash recovery.
*
* The main process supervises this process; this process supervises its workers.
* Communication with the main process is JSON plus typed arrays (advanced serialisation).
*/
var MAX_RESTARTS = 5;
var state = {
	config: {
		dllPath: null,
		previewFps: 30,
		colorFormat: "rgba",
		bandwidth: "native",
		allowVideoFields: false,
		maxPreviewWidth: 1920
	},
	resolvedDllPath: null,
	runtimeVersion: null,
	receive: /* @__PURE__ */ new Map(),
	discoverWorker: null,
	shuttingDown: false
};
function send(message) {
	if (!process.send) return;
	try {
		process.send(message);
	} catch {}
}
function log(level, message, detail) {
	send({
		type: "log",
		level,
		scope: "ndi-helper",
		message,
		...detail ? { detail } : {}
	});
}
function workerPath() {
	return node_path.default.join(__dirname, "ndi-worker.js");
}
function resolveDllPath() {
	if (state.resolvedDllPath) return;
	const info = require_detect.findNdiLibrary(state.config.dllPath);
	state.resolvedDllPath = info.path;
	if (!info.path) {
		send({
			type: "ready",
			runtime: {
				available: false,
				dllPath: null,
				version: null,
				reason: require_detect.describeNdiSearch(info)
			}
		});
		log("warn", require_detect.describeNdiSearch(info));
		return;
	}
	log("info", `NDI runtime resolved via ${info.source}.`, info.path);
}
function spawnWorker(command, handlers) {
	const worker = new node_worker_threads.Worker(workerPath(), { workerData: command });
	worker.on("message", handlers.onMessage);
	worker.on("error", (error) => {
		log("error", "NDI worker crashed.", String(error?.stack ?? error));
	});
	worker.on("exit", (code) => handlers.onExit(code));
	return worker;
}
function relayWorkerMessage(sourceId, message) {
	const type = message.type;
	if (type === "log") {
		send(message);
		return;
	}
	if (type === "error") {
		send(message);
		return;
	}
	if (type === "sources") {
		send({
			type: "sources",
			sources: message.sources ?? []
		});
		return;
	}
	if (type === "sourceState") {
		send({
			type: "sourceState",
			sourceId: String(message.sourceId ?? sourceId ?? ""),
			name: String(message.name ?? ""),
			state: message.state ?? "connecting",
			error: message.error ?? null,
			width: Number(message.width ?? 0),
			height: Number(message.height ?? 0),
			frameRateNumerator: Number(message.frameRateNumerator ?? 0),
			frameRateDenominator: Number(message.frameRateDenominator ?? 1),
			fourCC: Number(message.fourCC ?? 0)
		});
		return;
	}
	if (type === "stats") {
		send({
			type: "stats",
			sourceId: String(message.sourceId ?? sourceId ?? ""),
			receivedFrames: Number(message.receivedFrames ?? 0),
			droppedFrames: Number(message.droppedFrames ?? 0),
			skippedFrames: Number(message.skippedFrames ?? 0),
			receivedFps: Number(message.receivedFps ?? 0),
			averageFrameAgeMs: Number(message.averageFrameAgeMs ?? 0),
			reconnects: Number(message.reconnects ?? 0),
			width: Number(message.width ?? 0),
			height: Number(message.height ?? 0)
		});
		return;
	}
	if (type === "frame") send(message);
}
function startReceive(command) {
	const existing = state.receive.get(command.sourceId);
	if (existing) {
		existing.desired = false;
		existing.worker?.postMessage({ kind: "stop" });
		existing.worker?.removeAllListeners();
		existing.worker?.terminate().catch(() => void 0);
		state.receive.delete(command.sourceId);
	}
	const slot = {
		command,
		worker: null,
		restarts: 0,
		desired: true,
		paused: false,
		backoffMs: 500
	};
	state.receive.set(command.sourceId, slot);
	const launch = () => {
		if (!slot.desired || state.shuttingDown) return;
		if (!state.resolvedDllPath) {
			send({
				type: "sourceState",
				sourceId: command.sourceId,
				name: command.name,
				state: "error",
				error: "The NDI runtime is not installed, so this source cannot be received.",
				width: 0,
				height: 0,
				frameRateNumerator: 0,
				frameRateDenominator: 1,
				fourCC: 0
			});
			return;
		}
		const workerCommand = {
			...command,
			dllPath: state.resolvedDllPath
		};
		slot.worker = spawnWorker(workerCommand, {
			onMessage: (message) => relayWorkerMessage(command.sourceId, message),
			onExit: (code) => {
				slot.worker = null;
				if (!slot.desired || state.shuttingDown) return;
				slot.restarts += 1;
				if (slot.restarts > MAX_RESTARTS) {
					slot.desired = false;
					send({
						type: "sourceState",
						sourceId: command.sourceId,
						name: command.name,
						state: "error",
						error: `The NDI receive thread for this source stopped ${MAX_RESTARTS} times and will not be restarted. Disconnect and connect again to retry.`,
						width: 0,
						height: 0,
						frameRateNumerator: 0,
						frameRateDenominator: 1,
						fourCC: 0
					});
					return;
				}
				log("warn", `NDI receive thread exited (code ${code}); restarting attempt ${slot.restarts}.`);
				const wait = slot.backoffMs;
				slot.backoffMs = Math.min(slot.backoffMs * 2, 8e3);
				setTimeout(launch, wait).unref?.();
			}
		});
	};
	launch();
}
function stopReceive(sourceId) {
	const slot = state.receive.get(sourceId);
	if (!slot) return;
	slot.desired = false;
	slot.worker?.postMessage({ kind: "stop" });
	const worker = slot.worker;
	slot.worker = null;
	state.receive.delete(sourceId);
	if (worker) {
		worker.removeAllListeners();
		setTimeout(() => {
			worker.terminate().catch(() => void 0);
		}, 250).unref?.();
	}
}
function stopAll() {
	state.shuttingDown = true;
	for (const sourceId of [...state.receive.keys()]) stopReceive(sourceId);
	if (state.discoverWorker) {
		state.discoverWorker.removeAllListeners();
		state.discoverWorker.terminate().catch(() => void 0);
		state.discoverWorker = null;
	}
}
function handleDiscover(timeoutMs) {
	if (!state.resolvedDllPath) {
		send({
			type: "sources",
			sources: []
		});
		send({
			type: "error",
			scope: "discover",
			message: "The NDI runtime is not installed, so source discovery is unavailable.",
			fatal: false
		});
		return;
	}
	if (state.discoverWorker) {
		state.discoverWorker.removeAllListeners();
		state.discoverWorker.terminate().catch(() => void 0);
		state.discoverWorker = null;
	}
	state.discoverWorker = spawnWorker({
		kind: "discover",
		dllPath: state.resolvedDllPath,
		timeoutMs
	}, {
		onMessage: (message) => relayWorkerMessage(null, message),
		onExit: () => {
			state.discoverWorker = null;
		}
	});
}
process.on("message", (raw) => {
	if (!raw || typeof raw !== "object") return;
	switch (raw.type) {
		case "init":
			state.config = {
				dllPath: raw.dllPath,
				previewFps: raw.previewFps,
				colorFormat: raw.colorFormat,
				bandwidth: raw.bandwidth,
				allowVideoFields: raw.allowVideoFields,
				maxPreviewWidth: raw.maxPreviewWidth
			};
			resolveDllPath();
			send({
				type: "ready",
				runtime: {
					available: Boolean(state.resolvedDllPath),
					dllPath: state.resolvedDllPath,
					version: state.runtimeVersion,
					reason: state.resolvedDllPath ? null : "The NDI runtime library could not be located."
				}
			});
			break;
		case "discover":
			handleDiscover(raw.timeoutMs);
			break;
		case "connect":
			if (!state.resolvedDllPath) {
				send({
					type: "sourceState",
					sourceId: raw.sourceId,
					name: raw.name,
					state: "error",
					error: "The NDI runtime is not installed, so this source cannot be received.",
					width: 0,
					height: 0,
					frameRateNumerator: 0,
					frameRateDenominator: 1,
					fourCC: 0
				});
				break;
			}
			startReceive({
				kind: "receive",
				sourceId: raw.sourceId,
				name: raw.name,
				urlAddress: raw.urlAddress,
				dllPath: state.resolvedDllPath,
				previewFps: state.config.previewFps,
				colorFormat: state.config.colorFormat,
				bandwidth: state.config.bandwidth,
				allowVideoFields: state.config.allowVideoFields,
				maxPreviewWidth: state.config.maxPreviewWidth
			});
			break;
		case "disconnect":
			stopReceive(raw.sourceId);
			send({
				type: "sourceState",
				sourceId: raw.sourceId,
				name: "",
				state: "disconnected",
				error: null,
				width: 0,
				height: 0,
				frameRateNumerator: 0,
				frameRateDenominator: 1,
				fourCC: 0
			});
			break;
		case "pause": {
			const slot = state.receive.get(raw.sourceId);
			if (slot) {
				slot.paused = raw.paused;
				slot.worker?.postMessage({
					kind: "pause",
					paused: raw.paused
				});
			}
			break;
		}
		case "setPreviewFps":
			state.config.previewFps = raw.fps;
			for (const slot of state.receive.values()) slot.command.previewFps = raw.fps;
			break;
		case "shutdown":
			stopAll();
			setTimeout(() => process.exit(0), 400);
	}
});
process.on("uncaughtException", (error) => {
	log("error", "Unhandled error in the NDI helper.", String(error?.stack ?? error));
});
process.on("unhandledRejection", (error) => {
	log("error", "Unhandled promise rejection in the NDI helper.", String(error));
});
process.on("disconnect", () => {
	stopAll();
	process.exit(0);
});
send({
	type: "ready",
	runtime: {
		available: false,
		dllPath: null,
		version: null,
		reason: "Waiting for initialisation."
	}
});
//#endregion
