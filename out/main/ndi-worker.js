const require_rolldown_runtime = require("./chunks/rolldown-runtime-VH7oDXx4.js");
const require_protocol = require("./chunks/protocol-BaKXCjPd.js");
let node_worker_threads = require("node:worker_threads");
let koffi = require("koffi");
koffi = require_rolldown_runtime.__toESM(koffi);
//#region src/main/ndi/ffi.ts
/**
* FFI bindings to the official NDI runtime (`Processing.NDI.Lib.x64.dll`).
*
* Why FFI rather than a compiled addon: the NDI SDK is not redistributable, so linking
* it at build time would force every developer and CI machine to install the SDK and a
* matching toolchain. The runtime DLL exports a flat C API, so binding to the *installed*
* runtime gives real NDI support — real discovery, real connections, real frames — while
* keeping the build free of SDK headers and native compilation.
*
* Struct layouts below mirror NDIlib_video_frame_v2_t and friends exactly; the union of
* `NDIlib_video_frame_v2_t` and the public header is intentional and must not be
* reordered.
*/
/**
* Struct types are registered with koffi under their NDI names; the `func()` signature
* strings below resolve them from that registry. They are exported so the test suite can
* assert the ABI layout (sizes and member offsets) against the C headers.
*/
var SOURCE_STRUCT = koffi.default.struct("NDIlib_source_t", {
	p_ndi_name: "const char *",
	p_url_address: "const char *"
});
koffi.default.struct("NDIlib_video_frame_v2_t", {
	xres: "int32",
	yres: "int32",
	FourCC: "int32",
	frame_rate_N: "int32",
	frame_rate_D: "int32",
	picture_aspect_ratio: "float",
	frame_format_type: "int32",
	timecode: "int64",
	p_data: "uint8_t *",
	line_stride_in_bytes: "int32",
	p_metadata: "const char *",
	timestamp: "int64"
});
koffi.default.struct("NDIlib_find_create_t", {
	show_local_sources: "bool",
	p_groups: "const char *",
	p_extra_ips: "const char *"
});
koffi.default.struct("NDIlib_recv_create_v3_t", {
	source: SOURCE_STRUCT,
	color_format: "int32",
	bandwidth: "int32",
	allow_video_fields: "bool",
	p_ndi_recv_name: "const char *"
});
koffi.default.struct("NDIlib_send_create_t", {
	p_ndi_name: "const char *",
	p_groups: "const char *",
	clock_video: "bool",
	clock_audio: "bool"
});
var NdiRuntime = class {
	dllPath;
	lib;
	initialized = false;
	destroyed = false;
	fnInitialize;
	fnDestroy;
	fnVersion;
	fnFindCreate;
	fnFindDestroy;
	fnFindGetSources;
	fnFindWait;
	fnRecvCreate;
	fnRecvDestroy;
	fnRecvCapture;
	fnRecvFreeVideo;
	fnSendCreate;
	fnSendDestroy;
	fnSendVideo;
	constructor(dllPath) {
		this.dllPath = dllPath;
		this.lib = koffi.default.load(dllPath);
		this.fnInitialize = this.lib.func("bool NDIlib_initialize()");
		this.fnDestroy = this.lib.func("void NDIlib_destroy()");
		this.fnVersion = this.lib.func("const char *NDIlib_version()");
		this.fnFindCreate = this.lib.func("void *NDIlib_find_create_v2(NDIlib_find_create_t *p_create_settings)");
		this.fnFindDestroy = this.lib.func("void NDIlib_find_destroy(void *p_instance)");
		this.fnFindGetSources = this.lib.func("const NDIlib_source_t *NDIlib_find_get_current_sources(void *p_instance, _Out_ uint32_t *p_no_sources)");
		this.fnFindWait = this.lib.func("bool NDIlib_find_wait_for_sources(void *p_instance, uint32_t timeout_in_milliseconds)");
		this.fnRecvCreate = this.lib.func("void *NDIlib_recv_create_v3(NDIlib_recv_create_v3_t *p_create_settings)");
		this.fnRecvDestroy = this.lib.func("void NDIlib_recv_destroy(void *p_instance)");
		this.fnRecvCapture = this.lib.func("int NDIlib_recv_capture_v3(void *p_instance, NDIlib_video_frame_v2_t *p_video_data, void *p_audio_data, void *p_metadata, uint32_t timeout_in_milliseconds)");
		this.fnRecvFreeVideo = this.lib.func("void NDIlib_recv_free_video_v2(void *p_instance, NDIlib_video_frame_v2_t *p_video_data)");
		this.fnSendCreate = this.lib.func("void *NDIlib_send_create(NDIlib_send_create_t *p_create_settings)");
		this.fnSendDestroy = this.lib.func("void NDIlib_send_destroy(void *p_instance)");
		this.fnSendVideo = this.lib.func("void NDIlib_send_send_video_v2(void *p_instance, NDIlib_video_frame_v2_t *p_video_data)");
	}
	initialize() {
		if (this.initialized) return true;
		this.initialized = Boolean(this.fnInitialize());
		return this.initialized;
	}
	version() {
		try {
			return String(this.fnVersion());
		} catch {
			return "unknown";
		}
	}
	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		try {
			if (this.initialized) this.fnDestroy();
		} catch {}
	}
	createFinder(showLocalSources = true, groups = "") {
		return this.fnFindCreate({
			show_local_sources: showLocalSources,
			p_groups: groups,
			p_extra_ips: ""
		});
	}
	destroyFinder(instance) {
		this.fnFindDestroy(instance);
	}
	/** Current sources without waiting. */
	currentSources(instance) {
		const count = [0];
		const pointer = this.fnFindGetSources(instance, count);
		const total = Number(count[0] ?? 0);
		if (!pointer || total <= 0) return [];
		return koffi.default.decode(pointer, SOURCE_STRUCT, total).map((row) => ({
			name: typeof row.p_ndi_name === "string" ? row.p_ndi_name : "",
			urlAddress: typeof row.p_url_address === "string" ? row.p_url_address : ""
		})).filter((source) => source.name.length > 0);
	}
	/** Blocks (up to `timeoutMs`) until the source list changes. */
	waitForSources(instance, timeoutMs) {
		return Boolean(this.fnFindWait(instance, timeoutMs));
	}
	createReceiver(options) {
		const handle = this.fnRecvCreate({
			source: {
				p_ndi_name: options.name,
				p_url_address: options.urlAddress
			},
			color_format: options.colorFormat,
			bandwidth: options.bandwidth,
			allow_video_fields: options.allowVideoFields,
			p_ndi_recv_name: options.receiverName
		});
		if (!handle) throw new Error(`NDI could not create a receiver for "${options.name}".`);
		return handle;
	}
	destroyReceiver(instance) {
		this.fnRecvDestroy(instance);
	}
	/**
	* Captures one video frame.
	* Returns `{ type, frame }`. When `type === 1` the caller must pass `frame` to
	* `freeVideo` once the pixel data has been copied out.
	*/
	captureVideo(instance, timeoutMs) {
		const frame = {
			xres: 0,
			yres: 0,
			FourCC: 0,
			p_data: null
		};
		const type = Number(this.fnRecvCapture(instance, frame, null, null, timeoutMs));
		if (type !== 1) return {
			type,
			pointer: null,
			info: null
		};
		const info = frame;
		const width = Math.max(0, Math.floor(info.xres ?? 0));
		const height = Math.max(0, Math.floor(info.yres ?? 0));
		const stride = Math.max(0, Math.floor(info.line_stride_in_bytes ?? 0));
		const rowBytes = width * 4;
		const byteLength = Math.max(0, stride * Math.max(0, height - 1) + rowBytes);
		let data = /* @__PURE__ */ new Uint8Array(0);
		if (width > 0 && height > 0 && stride >= rowBytes && info.p_data) data = new Uint8Array(koffi.default.view(info.p_data, byteLength));
		return {
			type,
			pointer: frame,
			info: {
				width,
				height,
				fourCC: Number(info.FourCC ?? 0),
				frameRateNumerator: Number(info.frame_rate_N ?? 0),
				frameRateDenominator: Number(info.frame_rate_D ?? 1),
				aspectRatio: Number(info.picture_aspect_ratio ?? 0),
				frameFormatType: Number(info.frame_format_type ?? 0),
				timecode: Number(info.timecode ?? 0),
				lineStrideInBytes: stride,
				timestamp: Number(info.timestamp ?? 0),
				data
			}
		};
	}
	freeVideo(instance, pointer) {
		this.fnRecvFreeVideo(instance, pointer);
	}
	createSender(name, clockVideo = true, groups = "") {
		const handle = this.fnSendCreate({
			p_ndi_name: name,
			p_groups: groups,
			clock_video: clockVideo,
			clock_audio: false
		});
		if (!handle) throw new Error(`NDI could not create a sender named "${name}".`);
		return handle;
	}
	destroySender(instance) {
		this.fnSendDestroy(instance);
	}
	/** Sends one RGBA/BGRA frame. `data` must be `width * height * 4` bytes. */
	sendVideo(instance, frame) {
		this.fnSendVideo(instance, {
			xres: frame.width,
			yres: frame.height,
			FourCC: frame.fourCC,
			frame_rate_N: frame.frameRateNumerator,
			frame_rate_D: frame.frameRateDenominator,
			picture_aspect_ratio: frame.aspectRatio,
			frame_format_type: frame.frameFormatType,
			timecode: frame.timecode,
			p_data: frame.data,
			line_stride_in_bytes: frame.lineStrideInBytes,
			p_metadata: null,
			timestamp: frame.timestamp
		});
	}
};
function loadNdiRuntime(dllPath) {
	const runtime = new NdiRuntime(dllPath);
	if (!runtime.initialize()) throw new Error("The NDI runtime library loaded but NDIlib_initialize() failed. Reinstall the NDI runtime.");
	return runtime;
}
//#endregion
//#region src/main/ndi/worker.ts
/**
* One worker thread per NDI concern.
*
* The NDI C API blocks, so every connection gets its own thread: a blocking capture
* loop can run at full speed without starving the helper's control plane, and a fault
* in one source's thread cannot take down the others or the application.
*
* Frames are posted to the helper thread as transferable ArrayBuffers (zero-copy).
*/
var port = node_worker_threads.parentPort;
if (!port) throw new Error("The NDI worker must run inside a worker thread.");
var runtime = null;
var stopping = false;
/** While paused the connection stays open and frames keep arriving, but none are forwarded. */
var paused = false;
var command = node_worker_threads.workerData;
function log(level, message, detail) {
	port.postMessage({
		type: "log",
		level,
		scope: "ndi-worker",
		message,
		...detail ? { detail } : {}
	});
}
function fail(scope, error, fatal = true) {
	const message = error instanceof Error ? error.message : String(error);
	const detail = error instanceof Error ? error.stack : void 0;
	port.postMessage({
		type: "error",
		scope,
		message,
		...detail ? { detail } : {},
		fatal
	});
}
function shutdown(code) {
	stopping = true;
	try {
		runtime?.destroy();
	} catch {}
	runtime = null;
	process.exit(code);
}
process.on("uncaughtException", (error) => {
	fail("uncaught", error);
	shutdown(1);
});
process.on("unhandledRejection", (error) => {
	fail("unhandledRejection", error);
	shutdown(1);
});
port.on("message", (message) => {
	if (message?.kind === "stop") stopping = true;
	else if (message?.kind === "pause") paused = message.paused === true;
});
/**
* Nearest-neighbour / box downscale of a tightly packed RGBA frame.
* Only used when the source is wider than the configured preview width, so the common
* case (1080p or smaller) never pays for it.
*/
function downscaleRgba(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
	const output = new Uint8Array(targetWidth * targetHeight * 4);
	const xRatio = sourceWidth / targetWidth;
	const yRatio = sourceHeight / targetHeight;
	for (let y = 0; y < targetHeight; y += 1) {
		const yStart = Math.floor(y * yRatio);
		const yEnd = Math.max(yStart + 1, Math.min(sourceHeight, Math.floor((y + 1) * yRatio)));
		for (let x = 0; x < targetWidth; x += 1) {
			const xStart = Math.floor(x * xRatio);
			const xEnd = Math.max(xStart + 1, Math.min(sourceWidth, Math.floor((x + 1) * xRatio)));
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			let samples = 0;
			for (let sy = yStart; sy < yEnd; sy += 1) {
				let offset = (sy * sourceWidth + xStart) * 4;
				for (let sx = xStart; sx < xEnd; sx += 1) {
					r += source[offset];
					g += source[offset + 1];
					b += source[offset + 2];
					a += source[offset + 3];
					samples += 1;
					offset += 4;
				}
			}
			const out = (y * targetWidth + x) * 4;
			output[out] = samples ? r / samples : 0;
			output[out + 1] = samples ? g / samples : 0;
			output[out + 2] = samples ? b / samples : 0;
			output[out + 3] = samples ? a / samples : 255;
		}
	}
	return output;
}
function prepareFrame(frame, maxPreviewWidth) {
	const width = frame.width;
	const height = frame.height;
	const stride = frame.lineStrideInBytes;
	let data = frame.data;
	if (stride !== width * 4) {
		const tight = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y += 1) tight.set(data.subarray(y * stride, y * stride + width * 4), y * width * 4);
		data = tight;
	}
	let outWidth = width;
	let outHeight = height;
	if (maxPreviewWidth > 0 && width > maxPreviewWidth) {
		const scale = maxPreviewWidth / width;
		outWidth = Math.max(1, Math.round(width * scale));
		outHeight = Math.max(1, Math.round(height * scale));
		data = downscaleRgba(data, width, height, outWidth, outHeight);
	}
	return {
		buffer: data,
		width: outWidth,
		height: outHeight,
		stride: outWidth * 4
	};
}
async function runDiscovery(command) {
	runtime = loadNdiRuntime(command.dllPath);
	const finder = runtime.createFinder(true, "");
	const deadline = Date.now() + Math.max(500, command.timeoutMs);
	const emit = () => {
		const sources = runtime.currentSources(finder).map((source) => ({
			id: source.name,
			name: source.name,
			urlAddress: source.urlAddress,
			groups: ""
		}));
		port.postMessage({
			type: "sources",
			sources
		});
	};
	emit();
	while (!stopping && Date.now() < deadline) {
		const changed = runtime.waitForSources(finder, Math.min(500, Math.max(50, deadline - Date.now())));
		if (stopping) break;
		if (changed) emit();
	}
	emit();
	runtime.destroyFinder(finder);
	shutdown(0);
}
async function runReceiver(command) {
	runtime = loadNdiRuntime(command.dllPath);
	const bandwidth = require_protocol.bandwidthCode(command.bandwidth);
	const colorFormat = require_protocol.colorFormatCode(command.colorFormat);
	let receiver = null;
	let reconnects = 0;
	let receivedFrames = 0;
	let droppedFrames = 0;
	let skippedFrames = 0;
	let sequence = 0;
	let lastFrameAt = 0;
	let lastStatsAt = Date.now();
	let statsFrames = 0;
	let ageSum = 0;
	let ageSamples = 0;
	let currentWidth = 0;
	let currentHeight = 0;
	let announcedFormat = "";
	const openReceiver = () => {
		if (receiver) {
			try {
				runtime.destroyReceiver(receiver);
			} catch {}
			receiver = null;
		}
		receiver = runtime.createReceiver({
			name: command.name,
			urlAddress: command.urlAddress,
			colorFormat,
			bandwidth,
			allowVideoFields: command.allowVideoFields,
			receiverName: `CuePoint ${command.sourceId.slice(0, 40)}`
		});
		port.postMessage({
			type: "sourceState",
			sourceId: command.sourceId,
			name: command.name,
			state: "connecting",
			error: null,
			width: currentWidth,
			height: currentHeight,
			frameRateNumerator: 0,
			frameRateDenominator: 1,
			fourCC: 0
		});
	};
	openReceiver();
	const frameTimeoutMs = Math.max(4, Math.min(100, Math.round(1e3 / Math.max(1, command.previewFps))));
	while (!stopping) {
		let capture;
		try {
			capture = runtime.captureVideo(receiver, frameTimeoutMs);
		} catch (error) {
			fail("capture", error, false);
			droppedFrames += 1;
			await delay(250);
			continue;
		}
		if (capture.type === require_protocol.FRAME_TYPE.video && capture.info) {
			const info = capture.info;
			receivedFrames += 1;
			lastFrameAt = Date.now();
			statsFrames += 1;
			if (info.width !== currentWidth || info.height !== currentHeight) {
				currentWidth = info.width;
				currentHeight = info.height;
			}
			const formatKey = `${info.width}x${info.height}@${info.frameRateNumerator}/${info.frameRateDenominator}:${require_protocol.fourCCLabel(info.fourCC)}`;
			if (formatKey !== announcedFormat) {
				announcedFormat = formatKey;
				port.postMessage({
					type: "sourceState",
					sourceId: command.sourceId,
					name: command.name,
					state: "connected",
					error: null,
					width: info.width,
					height: info.height,
					frameRateNumerator: info.frameRateNumerator,
					frameRateDenominator: info.frameRateDenominator,
					fourCC: info.fourCC
				});
				log("info", `Format: ${formatKey}`);
			}
			if (paused) {
				skippedFrames += 1;
				try {
					runtime.freeVideo(receiver, capture.pointer);
				} catch {}
				continue;
			}
			try {
				const prepared = prepareFrame(info, command.maxPreviewWidth);
				sequence += 1;
				const frameAgeMs = Date.now() - lastFrameAt;
				ageSum += frameAgeMs;
				ageSamples += 1;
				port.postMessage({
					type: "frame",
					sourceId: command.sourceId,
					sequence,
					width: prepared.width,
					height: prepared.height,
					lineStrideInBytes: prepared.stride,
					frameAgeMs,
					capturedAt: lastFrameAt,
					buffer: prepared.buffer
				}, [prepared.buffer.buffer]);
			} catch (error) {
				skippedFrames += 1;
				fail("prepareFrame", error, false);
			} finally {
				try {
					runtime.freeVideo(receiver, capture.pointer);
				} catch (error) {
					fail("freeVideo", error, false);
				}
			}
		} else if (capture.type === require_protocol.FRAME_TYPE.error) {
			droppedFrames += 1;
			log("warn", "NDI reported a receive error; reconnecting.");
			reconnects += 1;
			await delay(500);
			try {
				openReceiver();
			} catch (error) {
				fail("reconnect", error, false);
				await delay(1e3);
			}
		} else if (capture.type === require_protocol.FRAME_TYPE.statusChange) log("info", "NDI status change reported for this connection.");
		else if (lastFrameAt > 0 && Date.now() - lastFrameAt > 1e4 && reconnects < 20) {
			reconnects += 1;
			log("warn", `No frames for 10 s from "${command.name}"; reconnecting.`);
			try {
				openReceiver();
			} catch (error) {
				fail("reconnect", error, false);
			}
			lastFrameAt = Date.now();
		}
		const now = Date.now();
		if (now - lastStatsAt >= 1e3) {
			const elapsed = (now - lastStatsAt) / 1e3;
			port.postMessage({
				type: "stats",
				sourceId: command.sourceId,
				receivedFrames,
				droppedFrames,
				skippedFrames,
				receivedFps: elapsed > 0 ? Math.round(statsFrames / elapsed * 10) / 10 : 0,
				averageFrameAgeMs: ageSamples ? Math.round(ageSum / ageSamples * 10) / 10 : 0,
				reconnects,
				width: currentWidth,
				height: currentHeight
			});
			lastStatsAt = now;
			statsFrames = 0;
			ageSum = 0;
			ageSamples = 0;
		}
	}
	if (receiver) try {
		runtime.destroyReceiver(receiver);
	} catch {}
	shutdown(0);
}
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
async function main() {
	if (!command || !("kind" in command)) {
		fail("worker", /* @__PURE__ */ new Error("The NDI worker was started without a command."));
		shutdown(1);
		return;
	}
	if (command.kind === "discover") {
		await runDiscovery(command);
		return;
	}
	if (command.kind === "receive") {
		await runReceiver(command);
		return;
	}
	shutdown(0);
}
main();
//#endregion
