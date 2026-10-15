//#region src/main/ndi/protocol.ts
function colorFormatCode(format) {
	switch (format) {
		case "bgra": return 0;
		case "uyvy": return 3;
		default: return 2;
	}
}
/**
* Maps CuePoint's bandwidth mode to the NDI receive bandwidth enum.
*
* Measured against NDI 6.2.1 on Windows (see docs/TESTING.md): with the enum value 0
* the receiver starts at native resolution and drops to exactly half resolution from
* the second frame onwards, while enum value 1 delivers native resolution continuously
* at a slightly lower frame rate. The UI therefore labels the modes by their observed
* effect and the app reports the resolution it actually receives.
*/
function bandwidthCode(bandwidth) {
	return bandwidth === "throughput" ? 0 : 1;
}
var FRAME_TYPE = {
	none: 0,
	video: 1,
	audio: 2,
	metadata: 3,
	error: 4,
	statusChange: 5
};
/** Turns an NDI FourCC integer into its printable label, e.g. 0x41524742 -> "BGRA". */
function fourCCLabel(code) {
	if (!Number.isFinite(code) || code === 0) return "unknown";
	return [
		code & 255,
		code >> 8 & 255,
		code >> 16 & 255,
		code >> 24 & 255
	].map((byte) => byte >= 32 && byte < 127 ? String.fromCharCode(byte) : "?").join("");
}
//#endregion
Object.defineProperty(exports, "FRAME_TYPE", {
	enumerable: true,
	get: function() {
		return FRAME_TYPE;
	}
});
Object.defineProperty(exports, "bandwidthCode", {
	enumerable: true,
	get: function() {
		return bandwidthCode;
	}
});
Object.defineProperty(exports, "colorFormatCode", {
	enumerable: true,
	get: function() {
		return colorFormatCode;
	}
});
Object.defineProperty(exports, "fourCCLabel", {
	enumerable: true,
	get: function() {
		return fourCCLabel;
	}
});
