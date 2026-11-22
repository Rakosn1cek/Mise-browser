// tests/send-to-mobile-qr.test.js
// Automated regression test suite for Zero-Cloud Send to Mobile QR Code generator and modal

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Mock Electron objects for headless execution before requiring contextMenus
try {
    const electronResolved = require.resolve('electron');
    class MockMenuItem {
        constructor(opts) {
            Object.assign(this, opts);
        }
    }
    class MockMenu {
        constructor() {
            this.items = [];
        }
        append(item) {
            this.items.push(item);
        }
    }
    require.cache[electronResolved] = {
        id: electronResolved,
        filename: electronResolved,
        loaded: true,
        exports: {
            Menu: MockMenu,
            MenuItem: MockMenuItem,
            app: { getPath: () => '/tmp' },
            clipboard: { writeText: () => {} },
            shell: { openExternal: () => {} }
        }
    };
} catch (_) {}

console.log('Running Mise Zero-Cloud Send to Mobile (QR Code) regression tests...');

(async () => {
    const qrCode = await import('../modules/qrCode.js');

    // 1. URL Sanitisation & Security Filtering
    {
        assert.equal(qrCode.isShareableQrUrl('https://example.com/path?a=1&b=2#sec'), true);
        assert.equal(qrCode.isShareableQrUrl('http://192.168.1.50:8080/dashboard'), true);
        assert.equal(
            qrCode.sanitiseQrUrl('  https://archlinux.org/packages/\n  '),
            'https://archlinux.org/packages/'
        );

        const rejectedInputs = [
            '',
            '   ',
            null,
            undefined,
            12345,
            'about:blank',
            'file:///etc/passwd',
            'file:///app/error.html?url=https://example.com',
            'https://example.com/error.html',
            'javascript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'chrome://settings',
            'https://example.com/' + 'a'.repeat(2050)
        ];

        for (const bad of rejectedInputs) {
            assert.equal(qrCode.isShareableQrUrl(bad), false, `Expected ${String(bad).slice(0, 40)} to be rejected`);
            assert.equal(qrCode.sanitiseQrUrl(bad), null, `Expected sanitiseQrUrl to return null for ${String(bad).slice(0, 40)}`);
        }

        console.log('✓ URL sanitisation and protocol allowlist verified');
    }

    // 2. ISO/IEC 18004 QR Matrix Generation
    {
        const shortMatrix = qrCode.encodeQrMatrix('https://m.io');
        assert.equal(shortMatrix.version, 1, '12-byte URL must fit inside QR Version 1 (ECC M capacity 14 bytes)');
        assert.equal(shortMatrix.size, 21, 'Version 1 QR code must be 21x21 modules');
        assert.equal(shortMatrix.ecc, 'M');
        assert(shortMatrix.mask >= 0 && shortMatrix.mask <= 7, 'Mask index must be between 0 and 7');
        assert.equal(shortMatrix.modules.length, 21);

        const v2Matrix = qrCode.encodeQrMatrix('https://mise.app');
        assert.equal(v2Matrix.version, 2, '16-byte URL must escalate to QR Version 2 at ECC M');
        assert.equal(v2Matrix.size, 25, 'Version 2 QR code must be 25x25 modules');

        // Verify 7x7 finder pattern structure at top-left, top-right, and bottom-left corners
        const checkFinderAt = (startRow, startCol) => {
            for (let r = 0; r < 7; r += 1) {
                for (let c = 0; c < 7; c += 1) {
                    const isEdge = r === 0 || r === 6 || c === 0 || c === 6;
                    const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
                    const expected = (isEdge || isCenter) ? 1 : 0;
                    assert.equal(
                        shortMatrix.modules[startRow + r][startCol + c],
                        expected,
                        `Finder module mismatch at (${startRow + r}, ${startCol + c})`
                    );
                }
            }
        };

        checkFinderAt(0, 0);
        checkFinderAt(0, shortMatrix.size - 7);
        checkFinderAt(shortMatrix.size - 7, 0);

        // Verify dark module fixed at (size - 8, 8)
        assert.equal(shortMatrix.modules[shortMatrix.size - 8][8], 1, 'Dark module must be 1');

        // Verify deterministic output
        const shortMatrixRepeat = qrCode.encodeQrMatrix('https://m.io');
        assert.deepEqual(shortMatrix.modules, shortMatrixRepeat.modules, 'QR generation must be deterministic');

        // Medium URL (Version 2 to 9)
        const mediumUrl = 'https://github.com/Rakosn1cek/Mise-browser/blob/main/ROADMAP.md?tab=readme-ov-file#milestone-5';
        const mediumMatrix = qrCode.encodeQrMatrix(mediumUrl);
        assert(mediumMatrix.version >= 2 && mediumMatrix.version <= 9, 'Medium URL should select version 2 to 9');
        assert.equal(mediumMatrix.size, 17 + 4 * mediumMatrix.version);

        // Long URL (>= Version 10, triggers 16-bit byte count and version info blocks)
        const longUrl = 'https://example.org/search?q=' + 'mise-browser-zero-cloud-qr-test-'.repeat(12);
        const longMatrix = qrCode.encodeQrMatrix(longUrl);
        assert(longMatrix.version >= 10, `Long URL must select version >= 10 (got ${longMatrix.version})`);
        assert.equal(longMatrix.size, 17 + 4 * longMatrix.version);

        // Higher ECC level requires same or higher version
        const lowEcc = qrCode.encodeQrMatrix(mediumUrl, { ecc: 'L' });
        const highEcc = qrCode.encodeQrMatrix(mediumUrl, { ecc: 'H' });
        assert(highEcc.version >= lowEcc.version, 'ECC H must select version >= ECC L');

        // Empty or oversized inputs throw cleanly
        assert.throws(() => qrCode.encodeQrMatrix(''), /non-empty string/);
        assert.throws(() => qrCode.encodeQrMatrix('x'.repeat(4000)), /capacity/);

        // Independent ISO/IEC 18004 decoder verification (Format Info, Version Info, Unmasking, De-interleaving, Payload)
        const DECODER_EC_PER_BLOCK = {
            L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
            M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
            Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
            H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
        };
        const DECODER_NUM_BLOCKS = {
            L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
            M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
            Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
            H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
        };

        function decodeQrMatrixForTest(matrix) {
            const { size, modules } = matrix;
            const version = (size - 17) / 4;

            // Read both 15-bit Format Information copies at ISO/IEC 18004 (row, col) positions
            let copy1 = 0;
            for (let i = 0; i <= 5; i += 1) copy1 |= (modules[i][8] & 1) << i;
            copy1 |= (modules[7][8] & 1) << 6;
            copy1 |= (modules[8][8] & 1) << 7;
            copy1 |= (modules[8][7] & 1) << 8;
            for (let i = 9; i < 15; i += 1) copy1 |= (modules[8][14 - i] & 1) << i;

            let copy2 = 0;
            for (let i = 0; i < 8; i += 1) copy2 |= (modules[8][size - 1 - i] & 1) << i;
            for (let i = 8; i < 15; i += 1) copy2 |= (modules[size - 15 + i][8] & 1) << i;

            assert.equal(copy1, copy2, 'Both Format Information copies in the QR matrix must match');

            const unmaskedFormat = copy1 ^ 0x5412;
            let syndrome = unmaskedFormat;
            for (let i = 14; i >= 10; i -= 1) {
                if ((syndrome >>> i) & 1) {
                    syndrome ^= 0x537 << (i - 10);
                }
            }
            assert.equal(syndrome, 0, 'Format Information BCH(15, 5) syndrome must equal 0');

            const eccMap = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };
            const eccBits = (unmaskedFormat >>> 13) & 0b11;
            const mask = (unmaskedFormat >>> 10) & 0b111;
            const decodedEcc = eccMap[eccBits];
            assert.equal(decodedEcc, matrix.ecc, 'Decoded ECC level must match matrix.ecc');
            assert.equal(mask, matrix.mask, 'Decoded mask pattern must match matrix.mask');

            // Mark all function modules
            const isFunc = Array.from({ length: size }, () => Array(size).fill(false));
            for (let i = 0; i < size; i += 1) {
                isFunc[6][i] = true;
                isFunc[i][6] = true;
            }
            const markRect = (r0, c0, h, w) => {
                for (let r = r0; r < r0 + h; r += 1) {
                    for (let c = c0; c < c0 + w; c += 1) {
                        isFunc[r][c] = true;
                    }
                }
            };
            markRect(0, 0, 9, 9);
            markRect(0, size - 8, 9, 8);
            markRect(size - 8, 0, 8, 9);

            if (version >= 2) {
                const numAlign = Math.floor(version / 7) + 2;
                const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
                const alignPos = [6];
                for (let pos = version * 4 + 10; alignPos.length < numAlign; pos -= step) {
                    alignPos.splice(1, 0, pos);
                }
                for (let i = 0; i < numAlign; i += 1) {
                    for (let j = 0; j < numAlign; j += 1) {
                        const isCorner = (i === 0 && j === 0) || (i === 0 && j === numAlign - 1) || (i === numAlign - 1 && j === 0);
                        if (!isCorner) {
                            markRect(alignPos[i] - 2, alignPos[j] - 2, 5, 5);
                        }
                    }
                }
            }
            if (version >= 7) {
                markRect(size - 11, 0, 3, 6);
                markRect(0, size - 11, 6, 3);
            }

            // Read unmasked data bits in zigzag order
            const isMaskBit = (r, c) => {
                switch (mask) {
                    case 0: return (r + c) % 2 === 0;
                    case 1: return r % 2 === 0;
                    case 2: return c % 3 === 0;
                    case 3: return (r + c) % 3 === 0;
                    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
                    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
                    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
                    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
                }
                return false;
            };

            const rawBits = [];
            for (let right = size - 1; right >= 1; right -= 2) {
                if (right === 6) right = 5;
                for (let vert = 0; vert < size; vert += 1) {
                    for (let j = 0; j < 2; j += 1) {
                        const col = right - j;
                        const upward = ((right + 1) & 2) === 0;
                        const row = upward ? size - 1 - vert : vert;
                        if (!isFunc[row][col]) {
                            const bit = (modules[row][col] ^ (isMaskBit(row, col) ? 1 : 0)) & 1;
                            rawBits.push(bit);
                        }
                    }
                }
            }

            const rawCodewords = Math.floor(rawBits.length / 8);
            const codewords = [];
            for (let i = 0; i < rawCodewords; i += 1) {
                let b = 0;
                for (let k = 0; k < 8; k += 1) {
                    b = (b << 1) | rawBits[i * 8 + k];
                }
                codewords.push(b);
            }

            // De-interleave data blocks
            const numBlocks = DECODER_NUM_BLOCKS[decodedEcc][version];
            const blockEccLen = DECODER_EC_PER_BLOCK[decodedEcc][version];
            const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
            const shortBlockDataLen = Math.floor(rawCodewords / numBlocks) - blockEccLen;
            const blocks = Array.from({ length: numBlocks }, () => []);
            let cwIdx = 0;
            for (let i = 0; i < shortBlockDataLen; i += 1) {
                for (let b = 0; b < numBlocks; b += 1) {
                    blocks[b].push(codewords[cwIdx]);
                    cwIdx += 1;
                }
            }
            for (let b = numShortBlocks; b < numBlocks; b += 1) {
                blocks[b].push(codewords[cwIdx]);
                cwIdx += 1;
            }
            const dataStream = blocks.flat();
            const dataBits = [];
            for (const b of dataStream) {
                for (let k = 7; k >= 0; k -= 1) {
                    dataBits.push((b >>> k) & 1);
                }
            }

            const readBits = (pos, len) => {
                let v = 0;
                for (let i = 0; i < len; i += 1) {
                    v = (v << 1) | dataBits[pos + i];
                }
                return v;
            };

            const mode = readBits(0, 4);
            assert.equal(mode, 0b0100, 'QR mode indicator must be Byte Mode (0100)');
            const countLen = version <= 9 ? 8 : 16;
            const byteCount = readBits(4, countLen);
            const payload = new Uint8Array(byteCount);
            let bitCursor = 4 + countLen;
            for (let i = 0; i < byteCount; i += 1) {
                payload[i] = readBits(bitCursor, 8);
                bitCursor += 8;
            }
            return new TextDecoder().decode(payload);
        }

        const roundTripUrls = [
            'https://m.io',
            'https://mise.app',
            'https://github.com/Rakosn1cek/Mise-browser',
            'https://example.org/search?q=' + 'mise-browser-zero-cloud-qr-test-'.repeat(12)
        ];

        for (const target of roundTripUrls) {
            for (const eccLevel of ['L', 'M', 'Q', 'H']) {
                const encoded = qrCode.encodeQrMatrix(target, { ecc: eccLevel });
                const decoded = decodeQrMatrixForTest(encoded);
                assert.equal(decoded, target, `Round-trip QR decode failed for ${target} at ECC ${eccLevel}`);
            }
        }

        console.log('✓ ISO/IEC 18004 QR matrix encoding, format BCH(15, 5) placement, and round-trip decode verified');
    }

    // 3. Zero-Cloud SVG Markup Generation
    {
        const defaultSvg = qrCode.generateQrSvg('https://mise.app');
        assert(defaultSvg.includes('fill="#000000"'), 'Default foreground module colour must be high-contrast #000000');
        assert(defaultSvg.includes('fill="#ffffff"'), 'Default quiet zone background colour must be #ffffff');

        const svg = qrCode.generateQrSvg('https://duckduckgo.com/?q=mise', {
            size: 240,
            margin: 4,
            fgColor: '#1a1b26',
            bgColor: '#ffffff'
        });

        assert(svg.startsWith('<svg '), 'SVG output must begin with <svg tag');
        assert(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'SVG must declare standard XML namespace');
        assert(svg.includes('width="240" height="240"'), 'SVG must apply requested pixel dimensions');
        assert(svg.includes('shape-rendering="crispEdges"'), 'SVG must render crisp edges for reliable scanning');
        assert(svg.includes('<rect width="100%" height="100%" fill="#ffffff"'), 'SVG must render quiet zone background');
        assert(svg.includes('<path d="M'), 'SVG must render compound module path');
        assert(!svg.includes('duckduckgo'), 'SVG markup must encode matrix bits rather than plain URL text');
        assert(!svg.includes('<text'), 'SVG markup must not embed raw text elements');
        assert(!/href=["']https?:\/\//i.test(svg), 'SVG must not reference any external HTTP/HTTPS assets');

        console.log('✓ Pure vanilla SVG QR rendering verified with zero external network assets');
    }

    // 4. Template, CSS, Keybind, Command Palette, and Context Menu Integration
    {
        const tplPath = path.join(__dirname, '../templates/qr-modal.html');
        assert(fs.existsSync(tplPath), 'templates/qr-modal.html must exist on disk');
        const tplContent = fs.readFileSync(tplPath, 'utf8');
        assert(tplContent.includes('id="QrModalOverlay"'), 'Template must define #QrModalOverlay');
        assert(tplContent.includes('id="QrModalSvgContainer"'), 'Template must define #QrModalSvgContainer');
        assert(tplContent.includes('id="QrModalPageTitle"'), 'Template must define #QrModalPageTitle');
        assert(tplContent.includes('id="QrModalUrlText"'), 'Template must define #QrModalUrlText');
        assert(tplContent.includes('id="QrModalCopyUrlBtn"'), 'Template must define #QrModalCopyUrlBtn');
        assert(tplContent.includes('id="CloseQrModalBtn"'), 'Template must define #CloseQrModalBtn');

        const loaderSource = fs.readFileSync(path.join(__dirname, '../modules/templateLoader.js'), 'utf8');
        assert(
            loaderSource.includes("'qr-modal': 'templates/qr-modal.html'"),
            'modules/templateLoader.js must register qr-modal template'
        );

        const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
        assert(indexHtml.includes('id="StatusBarQr"'), 'index.html status bar must include #StatusBarQr');

        const prefHtml = fs.readFileSync(path.join(__dirname, '../templates/preferences.html'), 'utf8');
        assert(prefHtml.includes('data-action="send-to-mobile"'), 'preferences.html must list send-to-mobile shortcut');

        const statusCss = fs.readFileSync(path.join(__dirname, '../styles/statusbar.css'), 'utf8');
        assert(statusCss.includes('.status-badge-qr'), 'statusbar.css must define .status-badge-qr');

        const compCss = fs.readFileSync(path.join(__dirname, '../styles/components.css'), 'utf8');
        assert(compCss.includes('.qr-modal-overlay'), 'components.css must define .qr-modal-overlay');
        assert(compCss.includes('.qr-modal-svg-frame'), 'components.css must define .qr-modal-svg-frame');

        const keybinds = require('../keybinds.js');
        assert.equal(keybinds.DEFAULT_KEYBINDS['send-to-mobile'], 'Ctrl+Shift+M', 'Default keybind must be Ctrl+Shift+M');
        assert.ok(keybinds.ACTION_METADATA['send-to-mobile'], 'ACTION_METADATA must include send-to-mobile');
        assert.equal(keybinds.ACTION_METADATA['send-to-mobile'].category, 'Web Interaction');

        for (const [act, bind] of Object.entries(keybinds.DEFAULT_KEYBINDS)) {
            const list = Array.isArray(bind) ? bind : [bind];
            for (const item of list) {
                assert(!String(item).toLowerCase().includes('alt'), `Keybind for ${act} must not use Alt modifier`);
            }
        }

        const paletteSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/commandPalette.js'), 'utf8');
        assert(paletteSource.includes("id: 'send-to-mobile'"), 'Command Palette must include send-to-mobile entry');

        const contextMenus = require('../main/contextMenus.js');
        const sentMessages = [];
        contextMenus.setMainWindowGetter(() => ({
            webContents: {
                send: (...args) => sentMessages.push(args)
            }
        }));

        const mockWebContents = {
            getURL: () => 'https://example.org/article',
            getTitle: () => 'Example Article',
            send: () => {}
        };
        const menuValid = contextMenus.buildWebviewContextMenu({
            pageURL: 'https://example.org/article'
        }, mockWebContents);
        const shareParent = menuValid.items.find((i) => i.label === 'Share...');
        assert.ok(shareParent && shareParent.submenu, 'Context menu must include Share... submenu');
        const qrItem = shareParent.submenu.items.find((i) => i.label === 'Send to Mobile (QR Code)');
        assert.ok(qrItem, 'Share... submenu must include Send to Mobile (QR Code) for HTTPS pages');
        qrItem.click();
        assert.equal(sentMessages.length, 1);
        assert.deepEqual(sentMessages[0], ['master-shortcut', 'send-to-mobile', 'https://example.org/article', 'Example Article']);

        const menuFile = contextMenus.buildWebviewContextMenu({
            pageURL: 'file:///home/user/local.html'
        }, { getURL: () => 'file:///home/user/local.html', getTitle: () => 'Local' });
        const shareFileParent = menuFile.items.find((i) => i.label === 'Share...');
        const qrFileItem = shareFileParent.submenu.items.find((i) => i.label === 'Send to Mobile (QR Code)');
        assert.equal(qrFileItem, undefined, 'Send to Mobile (QR Code) must be omitted for non-HTTP/HTTPS URLs');

        console.log('✓ Templates, stylesheets, keybinds, Command Palette, and context menu integration verified');
    }

    // 5. Modal Lifecycle, XSS Immunity, Clipboard Copy, and Status Bar Integration
    {
        class MockElement {
            constructor(id = '', tagName = 'div') {
                this.id = id;
                this.tagName = tagName.toUpperCase();
                this.style = { display: id === 'QrModalOverlay' ? 'none' : '' };
                this.innerHTML = '';
                this.textContent = '';
                this.title = '';
                this.attrs = {};
                this._listeners = {};
                this.classList = {
                    classes: new Set(),
                    add: (c) => this.classList.classes.add(c),
                    remove: (c) => this.classList.classes.delete(c),
                    contains: (c) => this.classList.classes.has(c),
                    toggle: (c, force) => {
                        if (force === undefined) {
                            if (this.classList.classes.has(c)) this.classList.classes.delete(c);
                            else this.classList.classes.add(c);
                        } else if (force) {
                            this.classList.classes.add(c);
                        } else {
                            this.classList.classes.delete(c);
                        }
                    }
                };
            }
            setAttribute(k, v) { this.attrs[k] = String(v); }
            getAttribute(k) { return this.attrs[k] ?? null; }
            addEventListener(type, fn) {
                if (!this._listeners[type]) this._listeners[type] = [];
                this._listeners[type].push(fn);
            }
            focus() {
                global.document.activeElement = this;
            }
            click() {
                const handlers = this._listeners.click || [];
                handlers.forEach((fn) => fn({ stopPropagation: () => {} }));
                if (typeof this.onclick === 'function') this.onclick({ target: this });
            }
        }

        const elements = {
            QrModalOverlay: new MockElement('QrModalOverlay'),
            QrModalSvgContainer: new MockElement('QrModalSvgContainer'),
            QrModalPageTitle: new MockElement('QrModalPageTitle'),
            QrModalUrlText: new MockElement('QrModalUrlText'),
            QrModalCopyUrlBtn: new MockElement('QrModalCopyUrlBtn', 'button'),
            QrModalCopyBtnText: new MockElement('QrModalCopyBtnText', 'span'),
            CloseQrModalBtn: new MockElement('CloseQrModalBtn', 'button'),
            StatusBar: new MockElement('StatusBar'),
            StatusBarQr: new MockElement('StatusBarQr', 'span'),
            TabList: new MockElement('TabList', 'ul')
        };

        const mockSelectedTab = new MockElement('', 'li');
        mockSelectedTab.classList.add('selected');

        const windowListeners = new Map();
        const copiedTexts = [];
        let webviewFocused = false;
        const mockWebview = {
            getURL: () => 'https://mise.browser/docs?q=1',
            getTitle: () => '<img src=x onerror=alert(1)> Mise Docs',
            focus: () => { webviewFocused = true; }
        };

        global.document = {
            activeElement: null,
            body: {
                classList: { contains: () => true, add: () => {}, remove: () => {} },
                appendChild: () => {}
            },
            getElementById: (id) => elements[id] || null,
            querySelector: (sel) => (sel === '#TabList li.selected' ? mockSelectedTab : null),
            querySelectorAll: (sel) => (sel === '#TabList li' ? [mockSelectedTab] : []),
            createElement: (tag) => new MockElement('', tag)
        };

        global.window = {
            addEventListener: (type, fn, capture) => {
                if (!windowListeners.has(type)) windowListeners.set(type, []);
                windowListeners.get(type).push(fn);
            },
            removeEventListener: (type, fn, capture) => {
                const list = windowListeners.get(type) || [];
                const idx = list.indexOf(fn);
                if (idx !== -1) list.splice(idx, 1);
            },
            dispatchEvent: (event) => {
                const list = [...(windowListeners.get(event.type) || [])];
                list.forEach((fn) => fn(event));
            }
        };

        const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                clipboard: {
                    writeText: async (txt) => {
                        copiedTexts.push(txt);
                    }
                }
            }
        });

        try {
            const { state } = await import('../modules/state.js');
            state.sessionState = {
                current_workspace: 'Workspace 1',
                workspaces: { 'Workspace 1': ['https://mise.browser/docs?q=1'] }
            };
            state.activeViewsCache = { 'Workspace 1': [mockWebview] };
            state.activeTitlesCache = { 'Workspace 1': ['Mise Docs'] };

            const statusBar = await import('../modules/statusBar.js');
            statusBar.updateQrStatus('https://mise.browser/docs?q=1');
            assert.equal(elements.StatusBarQr.style.display, 'inline-flex', '#StatusBarQr must be visible on HTTPS pages');

            statusBar.updateQrStatus('about:blank');
            assert.equal(elements.StatusBarQr.style.display, 'none', '#StatusBarQr must hide on about:blank');

            statusBar.updateQrStatus('file:///etc/hosts');
            assert.equal(elements.StatusBarQr.style.display, 'none', '#StatusBarQr must hide on file:// URLs');

            const qrModal = await import('../modules/overlays/qrModal.js');

            // Opening modal for active tab renders SVG and escapes title safely via textContent
            const opened = qrModal.openQrModal();
            assert.equal(opened, true, 'openQrModal must succeed for valid HTTPS tab');
            assert.equal(qrModal.isQrModalActive(), true);
            assert.equal(state.qrModalActive, true);
            assert.equal(elements.QrModalOverlay.style.display, 'flex');
            assert(elements.QrModalSvgContainer.innerHTML.startsWith('<svg '), 'SVG QR code must be mounted into container');
            assert.equal(elements.QrModalPageTitle.textContent, '<img src=x onerror=alert(1)> Mise Docs', 'Title must use textContent without HTML parsing');
            assert.equal(elements.QrModalUrlText.textContent, 'https://mise.browser/docs?q=1');
            assert.equal(elements.StatusBarQr.getAttribute('aria-expanded'), 'true');
            assert.equal(elements.StatusBarQr.classList.contains('active'), true);

            // Pressing y copies URL to clipboard
            global.window.dispatchEvent({
                type: 'keydown',
                key: 'y',
                ctrlKey: false,
                metaKey: false,
                altKey: false,
                preventDefault: () => {},
                stopPropagation: () => {}
            });
            assert.deepEqual(copiedTexts, ['https://mise.browser/docs?q=1'], 'Pressing y must copy share URL');
            assert.equal(elements.QrModalCopyBtnText.textContent, 'Copied!');

            // Pressing Escape closes modal and restores webview focus
            webviewFocused = false;
            global.window.dispatchEvent({
                type: 'keydown',
                key: 'Escape',
                preventDefault: () => {},
                stopPropagation: () => {}
            });
            assert.equal(qrModal.isQrModalActive(), false);
            assert.equal(state.qrModalActive, false);
            assert.equal(elements.QrModalOverlay.style.display, 'none');
            assert.equal(elements.StatusBarQr.getAttribute('aria-expanded'), 'false');
            assert.equal(webviewFocused, true, 'Closing QR modal must return focus to active webview');

            // Reject non-HTTP URLs cleanly
            mockWebview.getURL = () => 'about:blank';
            state.sessionState.workspaces['Workspace 1'] = ['about:blank'];
            const rejected = qrModal.openQrModal();
            assert.equal(rejected, false, 'openQrModal must reject about:blank');
            assert.equal(qrModal.isQrModalActive(), false);
        } finally {
            if (originalNavigatorDesc) {
                Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
            }
        }

        console.log('✓ QR modal lifecycle, status bar badge state, keyboard handling, and XSS safety verified');
    }

    // 6. Strict Line Budgets & Project Style Rules
    {
        const rendererLines = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').split('\n').length;
        const mainLines = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8').split('\n').length;
        const indexLines = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').split('\n').length;

        assert(rendererLines <= 250, `renderer.js must remain <= 250 lines (currently ${rendererLines})`);
        assert(mainLines <= 550, `main.js must remain <= 550 lines (currently ${mainLines})`);
        assert(indexLines <= 260, `index.html must remain <= 260 lines (currently ${indexLines})`);

        const qrCodeSource = fs.readFileSync(path.join(__dirname, '../modules/qrCode.js'), 'utf8');
        const qrModalSource = fs.readFileSync(path.join(__dirname, '../modules/overlays/qrModal.js'), 'utf8');
        assert(!qrCodeSource.includes('—') && !qrCodeSource.includes('--'), 'modules/qrCode.js must not contain double dashes');
        assert(!qrModalSource.includes('—') && !qrModalSource.includes('--'), 'modules/overlays/qrModal.js must not contain double dashes');

        console.log(`✓ Line budgets and style rules verified (renderer.js: ${rendererLines}/250, main.js: ${mainLines}/550, index.html: ${indexLines}/260)`);
    }

    console.log('All Zero-Cloud Send to Mobile (QR Code) regression tests passed successfully!');
})();
