function boxes(bytes, start = 0, end = bytes.length) {
    const result = [];
    while (start < end) {
        if (start + 8 > end)
            throw new Error("Truncated MP4 box");
        let size = bytes.readUInt32BE(start);
        let header = 8;
        if (size === 1) {
            if (start + 16 > end)
                throw new Error("Truncated MP4 extended box");
            const extended = bytes.readBigUInt64BE(start + 8);
            if (extended > BigInt(Number.MAX_SAFE_INTEGER))
                throw new Error("Oversized MP4 box");
            size = Number(extended);
            header = 16;
        }
        else if (size === 0)
            size = end - start;
        if (size < header || start + size > end)
            throw new Error("Invalid MP4 box size");
        result.push({ type: bytes.toString("latin1", start + 4, start + 8), start, payload: start + header, end: start + size });
        if (result.length > 10_000)
            throw new Error("Too many MP4 boxes");
        start += size;
    }
    return result;
}
function child(bytes, parent, type) {
    const box = boxes(bytes, parent.payload, parent.end).find((entry) => entry.type === type);
    if (!box)
        throw new Error(`Missing MP4 ${type}`);
    return box;
}
// A conservative progressive-MP4 profile, not a decoder or transcoder.
export function inspectEditorialMp4(bytes) {
    const top = boxes(bytes);
    const moov = top.find((box) => box.type === "moov");
    const mdat = top.find((box) => box.type === "mdat");
    if (top[0]?.type !== "ftyp" || !moov || !mdat || mdat.end <= mdat.payload || moov.start > mdat.start || top.some((box) => box.type === "moof")) {
        throw new Error("MP4 must support progressive playback");
    }
    const mvhd = child(bytes, moov, "mvhd");
    const version = bytes[mvhd.payload];
    if (version !== 0 && version !== 1)
        throw new Error("Unsupported MP4 duration version");
    const scaleOffset = mvhd.payload + (version === 1 ? 20 : 12);
    const durationOffset = scaleOffset + 4;
    if (durationOffset + (version === 1 ? 8 : 4) > mvhd.end)
        throw new Error("Truncated MP4 duration");
    const scale = bytes.readUInt32BE(scaleOffset);
    const duration = version === 1 ? Number(bytes.readBigUInt64BE(durationOffset)) : bytes.readUInt32BE(durationOffset);
    const seconds = duration / scale;
    if (!scale || !Number.isFinite(seconds) || seconds < 1 || seconds > 120)
        throw new Error("Invalid MP4 duration");
    let width = 0;
    let height = 0;
    let videoTracks = 0;
    for (const track of boxes(bytes, moov.payload, moov.end).filter((box) => box.type === "trak")) {
        const mdia = child(bytes, track, "mdia");
        const handler = child(bytes, mdia, "hdlr");
        if (handler.payload + 12 > handler.end)
            throw new Error("Truncated MP4 handler");
        const kind = bytes.toString("latin1", handler.payload + 8, handler.payload + 12);
        if (kind !== "vide" && kind !== "soun")
            throw new Error("Unsupported MP4 track");
        const stsd = child(bytes, child(bytes, child(bytes, mdia, "minf"), "stbl"), "stsd");
        if (stsd.payload + 8 > stsd.end || bytes.readUInt32BE(stsd.payload + 4) !== 1)
            throw new Error("Invalid MP4 sample descriptions");
        const entries = boxes(bytes, stsd.payload + 8, stsd.end);
        const entry = entries[0];
        if (entries.length !== 1 || !entry)
            throw new Error("Invalid MP4 sample entry");
        if (kind === "vide") {
            if (++videoTracks !== 1 || entry.type !== "avc1" || entry.payload + 78 > entry.end)
                throw new Error("Only H.264 video is supported");
            width = bytes.readUInt16BE(entry.payload + 24);
            height = bytes.readUInt16BE(entry.payload + 26);
            if (!width || !height || width > 4096 || height > 4096 || width * height > 8_294_400)
                throw new Error("Invalid video dimensions");
            const config = boxes(bytes, entry.payload + 78, entry.end).find((box) => box.type === "avcC");
            if (!config || config.payload + 7 > config.end || bytes[config.payload] !== 1)
                throw new Error("Missing AVC decoder configuration");
            let cursor = config.payload + 6;
            const spsCount = bytes[config.payload + 5] & 31;
            if (!spsCount)
                throw new Error("Missing AVC SPS");
            const readParameters = (count) => {
                for (let index = 0; index < count; index++) {
                    if (cursor + 2 > config.end)
                        throw new Error("Truncated AVC parameters");
                    const size = bytes.readUInt16BE(cursor);
                    cursor += 2;
                    if (!size || cursor + size > config.end)
                        throw new Error("Invalid AVC parameters");
                    cursor += size;
                }
            };
            readParameters(spsCount);
            if (cursor >= config.end)
                throw new Error("Missing AVC PPS");
            const ppsCount = bytes[cursor++];
            if (!ppsCount)
                throw new Error("Missing AVC PPS");
            readParameters(ppsCount);
        }
        else {
            if (entry.type !== "mp4a" || entry.payload + 28 > entry.end)
                throw new Error("Only AAC audio is supported");
            const esds = boxes(bytes, entry.payload + 28, entry.end).find((box) => box.type === "esds");
            if (!esds)
                throw new Error("Missing AAC configuration");
            // DecoderConfigDescriptor tag, bounded ISO descriptor length, MPEG-4 Audio object type.
            let aac = false;
            for (let cursor = esds.payload + 4; cursor < esds.end - 2; cursor++) {
                if (bytes[cursor] !== 4)
                    continue;
                let offset = cursor + 1;
                let length = 0;
                for (let count = 0; count < 4 && offset < esds.end; count++) {
                    const value = bytes[offset++];
                    length = length * 128 + (value & 127);
                    if (!(value & 128)) {
                        aac = length >= 13 && offset + length <= esds.end && bytes[offset] === 0x40 && (bytes[offset + 1] >> 2) === 5;
                        break;
                    }
                }
                if (aac)
                    break;
            }
            if (!aac)
                throw new Error("Unsupported MP4 audio codec");
        }
    }
    if (videoTracks !== 1)
        throw new Error("Missing video track");
    return { durationMs: Math.round(seconds * 1000), width, height };
}
