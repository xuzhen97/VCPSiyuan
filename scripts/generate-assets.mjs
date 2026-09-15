import fs from "node:fs";
import zlib from "node:zlib";

function crc32(buffer) {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function createPng(width, height, r, g, b) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // bit depth
    ihdrData[9] = 2; // color type RGB
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace

    const ihdrCrc = Buffer.alloc(4);
    ihdrCrc.writeUInt32BE(
        crc32(Buffer.concat([Buffer.from("IHDR"), ihdrData])),
        0,
    );
    const ihdrChunk = Buffer.concat([
        Buffer.from([0, 0, 0, 13]),
        Buffer.from("IHDR"),
        ihdrData,
        ihdrCrc,
    ]);

    const rawRows = [];
    for (let y = 0; y < height; y++) {
        const row = Buffer.alloc(1 + width * 3);
        row[0] = 0; // filter type none
        for (let x = 0; x < width; x++) {
            const offset = 1 + x * 3;
            row[offset] = r;
            row[offset + 1] = g;
            row[offset + 2] = b;
        }
        rawRows.push(row);
    }

    const compressed = zlib.deflateSync(Buffer.concat(rawRows));
    const idatLen = Buffer.alloc(4);
    idatLen.writeUInt32BE(compressed.length, 0);
    const idatCrc = Buffer.alloc(4);
    idatCrc.writeUInt32BE(
        crc32(Buffer.concat([Buffer.from("IDAT"), compressed])),
        0,
    );
    const idatChunk = Buffer.concat([
        idatLen,
        Buffer.from("IDAT"),
        compressed,
        idatCrc,
    ]);

    const iendChunk = Buffer.from([
        0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]);

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

fs.writeFileSync("icon.png", createPng(160, 160, 43, 114, 186));
fs.writeFileSync("preview.png", createPng(1024, 768, 30, 41, 59));
console.log("✓ icon.png (160x160) and preview.png (1024x768) generated.");
