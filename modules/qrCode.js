// modules/qrCode.js
// Pure vanilla JS ISO/IEC 18004 SVG QR Code generator for Zero-Cloud mobile transfer

const ECC_LEVELS = Object.freeze({
    L: { ordinal: 0, formatBits: 1 },
    M: { ordinal: 1, formatBits: 0 },
    Q: { ordinal: 2, formatBits: 3 },
    H: { ordinal: 3, formatBits: 2 }
});

// ISO/IEC 18004 Table 9: Error correction codewords per block [L, M, Q, H] for versions 1 to 40
const EC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
];

// ISO/IEC 18004 Table 9: Number of error correction blocks [L, M, Q, H] for versions 1 to 40
const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/**
 * Validates and sanitises a URL before encoding it into a QR code.
 * Accepts only http and https protocols within safe length bounds.
 * @param {string} rawUrl Input URL string
 * @returns {string|null} Sanitised URL string or null if invalid
 */
export function sanitiseQrUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const cleaned = rawUrl.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!cleaned || cleaned === 'about:blank' || cleaned.length > 2048) return null;
    if (cleaned.includes('error.html')) return null;

    try {
        const parsed = new URL(cleaned);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.href;
    } catch (_) {
        return null;
    }
}

/**
 * Returns true if the supplied URL can be safely shared via QR code.
 * @param {string} rawUrl Candidate URL string
 * @returns {boolean} True when shareable over HTTP or HTTPS
 */
export function isShareableQrUrl(rawUrl) {
    return Boolean(sanitiseQrUrl(rawUrl));
}

function getNumRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const numAlign = Math.floor(ver / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (ver >= 7) {
            result -= 36;
        }
    }
    return result;
}

function getNumDataCodewords(ver, ecc) {
    return Math.floor(getNumRawDataModules(ver) / 8) -
        EC_CODEWORDS_PER_BLOCK[ecc.ordinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecc.ordinal][ver];
}

function appendBits(val, len, bitBuffer) {
    for (let i = len - 1; i >= 0; i -= 1) {
        bitBuffer.push((val >>> i) & 1);
    }
}

function rsMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
}

function rsComputeDivisor(degree) {
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i += 1) {
        for (let j = 0; j < degree; j += 1) {
            result[j] = rsMultiply(result[j], root);
            if (j + 1 < degree) {
                result[j] ^= result[j + 1];
            }
        }
        root = rsMultiply(root, 0x02);
    }
    return result;
}

function rsComputeRemainder(data, divisor) {
    const result = new Uint8Array(divisor.length);
    for (const b of data) {
        const factor = b ^ result[0];
        result.copyWithin(0, 1);
        result[result.length - 1] = 0;
        for (let i = 0; i < divisor.length; i += 1) {
            result[i] ^= rsMultiply(divisor[i], factor);
        }
    }
    return result;
}

function getAlignmentPatternPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) {
        result.splice(1, 0, pos);
    }
    return result;
}

function addEccAndInterleave(dataBytes, ver, ecc) {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecc.ordinal][ver];
    const blockEccLen = EC_CODEWORDS_PER_BLOCK[ecc.ordinal][ver];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const rsDiv = rsComputeDivisor(blockEccLen);
    let offset = 0;

    for (let i = 0; i < numBlocks; i += 1) {
        const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
        const dat = dataBytes.slice(offset, offset + datLen);
        offset += datLen;
        const eccBytes = rsComputeRemainder(dat, rsDiv);
        if (i < numShortBlocks) {
            dat.push(0);
        }
        blocks.push({ dat, eccBytes });
    }

    const result = [];
    const maxDataLen = shortBlockLen - blockEccLen + 1;
    for (let i = 0; i < maxDataLen; i += 1) {
        for (let j = 0; j < blocks.length; j += 1) {
            if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
                result.push(blocks[j].dat[i]);
            }
        }
    }
    for (let i = 0; i < blockEccLen; i += 1) {
        for (let j = 0; j < blocks.length; j += 1) {
            result.push(blocks[j].eccBytes[i]);
        }
    }
    return result;
}

function createMatrixContext(version) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => Array(size).fill(0));
    const isFunction = Array.from({ length: size }, () => Array(size).fill(false));

    function setFunctionModule(row, col, isDark) {
        modules[row][col] = isDark ? 1 : 0;
        isFunction[row][col] = true;
    }

    function drawFinderPattern(row, col) {
        for (let dy = -4; dy <= 4; dy += 1) {
            for (let dx = -4; dx <= 4; dx += 1) {
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                const r = row + dy;
                const c = col + dx;
                if (r >= 0 && r < size && c >= 0 && c < size) {
                    setFunctionModule(r, c, dist !== 2 && dist !== 4);
                }
            }
        }
    }

    function drawAlignmentPattern(row, col) {
        for (let dy = -2; dy <= 2; dy += 1) {
            for (let dx = -2; dx <= 2; dx += 1) {
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                setFunctionModule(row + dy, col + dx, dist !== 1);
            }
        }
    }

    function drawFormatBits(ecc, mask) {
        const data = (ecc.formatBits << 3) | mask;
        let rem = data;
        for (let i = 0; i < 10; i += 1) {
            rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        }
        const bits = ((data << 10) | rem) ^ 0x5412;

        for (let i = 0; i <= 5; i += 1) setFunctionModule(i, 8, ((bits >>> i) & 1) !== 0);
        setFunctionModule(7, 8, ((bits >>> 6) & 1) !== 0);
        setFunctionModule(8, 8, ((bits >>> 7) & 1) !== 0);
        setFunctionModule(8, 7, ((bits >>> 8) & 1) !== 0);
        for (let i = 9; i < 15; i += 1) setFunctionModule(8, 14 - i, ((bits >>> i) & 1) !== 0);

        for (let i = 0; i < 8; i += 1) setFunctionModule(8, size - 1 - i, ((bits >>> i) & 1) !== 0);
        for (let i = 8; i < 15; i += 1) setFunctionModule(size - 15 + i, 8, ((bits >>> i) & 1) !== 0);
        setFunctionModule(size - 8, 8, true);
    }

    function drawVersion() {
        if (version < 7) return;
        let rem = version;
        for (let i = 0; i < 12; i += 1) {
            rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
        }
        const bits = (version << 12) | rem;
        for (let i = 0; i < 18; i += 1) {
            const bit = ((bits >>> i) & 1) !== 0;
            const a = size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            setFunctionModule(a, b, bit);
            setFunctionModule(b, a, bit);
        }
    }

    // Timing patterns
    for (let i = 0; i < size; i += 1) {
        setFunctionModule(6, i, i % 2 === 0);
        setFunctionModule(i, 6, i % 2 === 0);
    }

    // Finder patterns
    drawFinderPattern(3, 3);
    drawFinderPattern(3, size - 4);
    drawFinderPattern(size - 4, 3);

    // Alignment patterns
    const alignPos = getAlignmentPatternPositions(version);
    const numAlign = alignPos.length;
    for (let i = 0; i < numAlign; i += 1) {
        for (let j = 0; j < numAlign; j += 1) {
            const isFinderCorner = (i === 0 && j === 0) ||
                (i === 0 && j === numAlign - 1) ||
                (i === numAlign - 1 && j === 0);
            if (!isFinderCorner) {
                drawAlignmentPattern(alignPos[i], alignPos[j]);
            }
        }
    }

    // Reserve format and version areas
    drawFormatBits(ECC_LEVELS.L, 0);
    drawVersion();

    return { size, modules, isFunction, drawFormatBits };
}

function drawCodewords(ctx, allCodewords) {
    const { size, modules, isFunction } = ctx;
    let bitIdx = 0;

    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert += 1) {
            for (let j = 0; j < 2; j += 1) {
                const col = right - j;
                const upward = ((right + 1) & 2) === 0;
                const row = upward ? size - 1 - vert : vert;
                if (!isFunction[row][col] && bitIdx < allCodewords.length * 8) {
                    const byteVal = allCodewords[bitIdx >>> 3];
                    const bit = (byteVal >>> (7 - (bitIdx & 7))) & 1;
                    modules[row][col] = bit;
                    bitIdx += 1;
                }
            }
        }
    }
}

function applyMask(ctx, mask) {
    const { size, modules, isFunction } = ctx;
    for (let r = 0; r < size; r += 1) {
        for (let c = 0; c < size; c += 1) {
            if (isFunction[r][c]) continue;
            let invert = false;
            switch (mask) {
                case 0: invert = (r + c) % 2 === 0; break;
                case 1: invert = r % 2 === 0; break;
                case 2: invert = c % 3 === 0; break;
                case 3: invert = (r + c) % 3 === 0; break;
                case 4: invert = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
                case 5: invert = ((r * c) % 2) + ((r * c) % 3) === 0; break;
                case 6: invert = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
                case 7: invert = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break;
            }
            if (invert) {
                modules[r][c] ^= 1;
            }
        }
    }
}

function finderPenaltyCountPatterns(runHistory, size) {
    const n = runHistory[1];
    const core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 &&
        runHistory[4] === n && runHistory[5] === n;
    if (!core) return 0;
    let count = 0;
    if (runHistory[0] >= n * 4 && runHistory[6] >= n) count += 1;
    if (runHistory[6] >= n * 4 && runHistory[0] >= n) count += 1;
    return count;
}

function finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory, size) {
    if (currentRunColor === 1) {
        runHistory.pop();
        runHistory.unshift(currentRunLength);
        currentRunLength = 0;
    }
    currentRunLength += size;
    runHistory.pop();
    runHistory.unshift(currentRunLength);
    return finderPenaltyCountPatterns(runHistory, size);
}

function getPenaltyScore(modules, size) {
    let result = 0;

    // N1 and N3 on rows
    for (let r = 0; r < size; r += 1) {
        let runColor = 0;
        let runX = 0;
        const runHistory = [0, 0, 0, 0, 0, 0, 0];
        for (let c = 0; c < size; c += 1) {
            if (modules[r][c] === runColor) {
                runX += 1;
                if (runX === 5) result += PENALTY_N1;
                else if (runX > 5) result += 1;
            } else {
                runHistory.pop();
                runHistory.unshift(runX);
                if (runColor === 0) {
                    result += finderPenaltyCountPatterns(runHistory, size) * PENALTY_N3;
                }
                runColor = modules[r][c];
                runX = 1;
            }
        }
        result += finderPenaltyTerminateAndCount(runColor, runX, runHistory, size) * PENALTY_N3;
    }

    // N1 and N3 on columns
    for (let c = 0; c < size; c += 1) {
        let runColor = 0;
        let runY = 0;
        const runHistory = [0, 0, 0, 0, 0, 0, 0];
        for (let r = 0; r < size; r += 1) {
            if (modules[r][c] === runColor) {
                runY += 1;
                if (runY === 5) result += PENALTY_N1;
                else if (runY > 5) result += 1;
            } else {
                runHistory.pop();
                runHistory.unshift(runY);
                if (runColor === 0) {
                    result += finderPenaltyCountPatterns(runHistory, size) * PENALTY_N3;
                }
                runColor = modules[r][c];
                runY = 1;
            }
        }
        result += finderPenaltyTerminateAndCount(runColor, runY, runHistory, size) * PENALTY_N3;
    }

    // N2: 2x2 blocks of matching modules
    for (let r = 0; r < size - 1; r += 1) {
        for (let c = 0; c < size - 1; c += 1) {
            const color = modules[r][c];
            if (color === modules[r][c + 1] && color === modules[r + 1][c] && color === modules[r + 1][c + 1]) {
                result += PENALTY_N2;
            }
        }
    }

    // N4: Proportion of dark modules
    let dark = 0;
    for (const row of modules) {
        for (const cell of row) {
            if (cell === 1) dark += 1;
        }
    }
    const total = size * size;
    const k = Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1);
    result += k * PENALTY_N4;

    return result;
}

/**
 * Encodes an input string into a QR Code module matrix using Byte Mode (UTF-8).
 * @param {string} text Text or URL to encode
 * @param {object} [options] Encoding options
 * @param {string} [options.ecc='M'] Error correction level ('L', 'M', 'Q', 'H')
 * @returns {{ version: number, size: number, ecc: string, mask: number, modules: number[][] }}
 */
export function encodeQrMatrix(text, options = {}) {
    if (typeof text !== 'string' || text.length === 0) {
        throw new Error('QR input must be a non-empty string');
    }

    const eccKey = String(options.ecc || 'M').toUpperCase();
    const ecc = ECC_LEVELS[eccKey] || ECC_LEVELS.M;
    const utf8Bytes = new TextEncoder().encode(text);

    // Select smallest version from 1 to 40 that accommodates payload in Byte Mode
    let version = -1;
    let dataCapacityBytes = 0;
    for (let v = 1; v <= 40; v += 1) {
        const countBits = v <= 9 ? 8 : 16;
        const requiredBits = 4 + countBits + utf8Bytes.length * 8;
        const capBytes = getNumDataCodewords(v, ecc);
        if (requiredBits <= capBytes * 8) {
            version = v;
            dataCapacityBytes = capBytes;
            break;
        }
    }

    if (version === -1) {
        throw new Error('Input exceeds maximum QR Code Byte Mode capacity');
    }

    const bitBuffer = [];
    appendBits(0b0100, 4, bitBuffer); // Byte Mode indicator
    appendBits(utf8Bytes.length, version <= 9 ? 8 : 16, bitBuffer);
    for (const byteVal of utf8Bytes) {
        appendBits(byteVal, 8, bitBuffer);
    }

    const capacityBits = dataCapacityBytes * 8;
    appendBits(0, Math.min(4, capacityBits - bitBuffer.length), bitBuffer);
    while (bitBuffer.length % 8 !== 0) {
        bitBuffer.push(0);
    }

    const dataBytes = [];
    for (let i = 0; i < bitBuffer.length; i += 8) {
        let b = 0;
        for (let j = 0; j < 8; j += 1) {
            b = (b << 1) | bitBuffer[i + j];
        }
        dataBytes.push(b);
    }

    let padByte = 0xEC;
    while (dataBytes.length < dataCapacityBytes) {
        dataBytes.push(padByte);
        padByte = padByte === 0xEC ? 0x11 : 0xEC;
    }

    const allCodewords = addEccAndInterleave(dataBytes, version, ecc);
    const ctx = createMatrixContext(version);
    drawCodewords(ctx, allCodewords);

    let bestMask = 0;
    let minPenalty = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
        applyMask(ctx, mask);
        ctx.drawFormatBits(ecc, mask);
        const penalty = getPenaltyScore(ctx.modules, ctx.size);
        if (penalty < minPenalty) {
            minPenalty = penalty;
            bestMask = mask;
        }
        applyMask(ctx, mask);
    }

    applyMask(ctx, bestMask);
    ctx.drawFormatBits(ecc, bestMask);

    return {
        version,
        size: ctx.size,
        ecc: eccKey in ECC_LEVELS ? eccKey : 'M',
        mask: bestMask,
        modules: ctx.modules
    };
}

/**
 * Renders a QR code directly to a clean, dependency-free SVG markup string.
 * @param {string} text Text or URL to encode
 * @param {object} [options] Rendering options
 * @param {string} [options.ecc='M'] Error correction level ('L', 'M', 'Q', 'H')
 * @param {number} [options.margin=4] Quiet zone width in modules
 * @param {number} [options.size=220] Pixel width and height of the SVG element
 * @param {string} [options.fgColor='#000000'] Foreground dark module colour
 * @param {string} [options.bgColor='#ffffff'] Background quiet zone colour
 * @returns {string} SVG markup string
 */
export function generateQrSvg(text, options = {}) {
    const ecc = options.ecc || 'M';
    const margin = Number.isFinite(options.margin) && options.margin >= 0 ? Math.floor(options.margin) : 4;
    const pixelSize = Number.isFinite(options.size) && options.size > 0 ? Math.floor(options.size) : 220;
    const fgColor = typeof options.fgColor === 'string' && options.fgColor.trim() ? options.fgColor.trim() : '#000000';
    const bgColor = typeof options.bgColor === 'string' && options.bgColor.trim() ? options.bgColor.trim() : '#ffffff';

    const matrix = encodeQrMatrix(text, { ecc });
    const total = matrix.size + margin * 2;
    const parts = [];

    for (let r = 0; r < matrix.size; r += 1) {
        const row = matrix.modules[r];
        for (let c = 0; c < matrix.size; c += 1) {
            if (row[c] === 1) {
                parts.push(`M${c + margin} ${r + margin}h1v1h-1z`);
            }
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges" role="img" aria-label="QR code for mobile transfer"><rect width="100%" height="100%" fill="${bgColor}" rx="2"/><path d="${parts.join('')}" fill="${fgColor}"/></svg>`;
}
