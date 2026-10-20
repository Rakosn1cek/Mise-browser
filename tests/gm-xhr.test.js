// tests/gm-xhr.test.js
// Automated regression tests for GM_xmlhttpRequest security hardening

const assert = require('assert');
const userContent = require('../userContent.js');
const { executeGmXmlHttpRequest } = userContent;

console.log('Running Mise GM_xmlhttpRequest regression tests...');

const baseValidate = async (u) => Object.assign(new URL(u), { pinnedIp: '93.184.216.34', pinnedFamily: 4 });
const baseDispatcher = () => ({ destroy() {} });

(async () => {
    // 1. Cross-origin redirect strips sensitive headers and keeps them removed on third hop
    {
        const recordedRequests = [];
        const fetchFn = async (url, init) => {
            recordedRequests.push({ url, headers: Object.assign({}, init.headers) });
            if (url === 'https://a.com/start') {
                return new Response('redirect 1', {
                    status: 302,
                    headers: { location: 'https://b.com/mid' }
                });
            }
            if (url === 'https://b.com/mid') {
                return new Response('redirect 2', {
                    status: 302,
                    headers: { location: 'https://c.com/end' }
                });
            }
            return new Response('ok', { status: 200 });
        };

        const res = await executeGmXmlHttpRequest(
            {
                url: 'https://a.com/start',
                headers: {
                    'Authorization': 'Bearer token123',
                    'COOKIE': 'session=abc',
                    'proxy-authorization': 'Basic secret',
                    'X-Custom-Header': 'keep-me'
                }
            },
            null,
            { fetchFn, validate: baseValidate, createDispatcher: baseDispatcher }
        );

        assert.strictEqual(res.status, 200);
        assert.strictEqual(recordedRequests.length, 3);

        // Hop 1: same initial origin retains headers
        assert.strictEqual(recordedRequests[0].headers['Authorization'], 'Bearer token123');
        assert.strictEqual(recordedRequests[0].headers['COOKIE'], 'session=abc');
        assert.strictEqual(recordedRequests[0].headers['proxy-authorization'], 'Basic secret');
        assert.strictEqual(recordedRequests[0].headers['X-Custom-Header'], 'keep-me');

        // Hop 2: cross-origin hop strips sensitive headers
        assert.strictEqual(recordedRequests[1].headers['Authorization'], undefined);
        assert.strictEqual(recordedRequests[1].headers['COOKIE'], undefined);
        assert.strictEqual(recordedRequests[1].headers['proxy-authorization'], undefined);
        assert.strictEqual(recordedRequests[1].headers['X-Custom-Header'], 'keep-me');

        // Hop 3: sensitive headers stay removed on subsequent hop
        assert.strictEqual(recordedRequests[2].headers['Authorization'], undefined);
        assert.strictEqual(recordedRequests[2].headers['COOKIE'], undefined);
        assert.strictEqual(recordedRequests[2].headers['proxy-authorization'], undefined);
        assert.strictEqual(recordedRequests[2].headers['X-Custom-Header'], 'keep-me');

        // Same-origin redirect keeps sensitive headers
        const sameOriginRequests = [];
        const sameOriginFetch = async (url, init) => {
            sameOriginRequests.push({ url, headers: Object.assign({}, init.headers) });
            if (url === 'https://a.com/start') {
                return new Response('redirect', {
                    status: 302,
                    headers: { location: 'https://a.com/next' }
                });
            }
            return new Response('ok', { status: 200 });
        };

        await executeGmXmlHttpRequest(
            {
                url: 'https://a.com/start',
                headers: {
                    'Authorization': 'Bearer token123',
                    'COOKIE': 'session=abc',
                    'proxy-authorization': 'Basic secret'
                }
            },
            null,
            { fetchFn: sameOriginFetch, validate: baseValidate, createDispatcher: baseDispatcher }
        );

        assert.strictEqual(sameOriginRequests.length, 2);
        assert.strictEqual(sameOriginRequests[1].headers['Authorization'], 'Bearer token123');
        assert.strictEqual(sameOriginRequests[1].headers['COOKIE'], 'session=abc');
        assert.strictEqual(sameOriginRequests[1].headers['proxy-authorization'], 'Basic secret');

        console.log('✓ Cross-origin and same-origin redirect header handling verified');
    }

    // 2. HTTP method changes on redirect (302/301 POST -> GET with body/content-type dropped, 307 preserves POST and body)
    {
        // 302 on POST
        const reqs302 = [];
        const fetch302 = async (url, init) => {
            reqs302.push({ url, method: init.method, body: init.body, headers: Object.assign({}, init.headers) });
            if (url === 'https://a.com/post') {
                return new Response('found', {
                    status: 302,
                    headers: { location: 'https://a.com/get' }
                });
            }
            return new Response('ok', { status: 200 });
        };

        await executeGmXmlHttpRequest(
            {
                url: 'https://a.com/post',
                method: 'POST',
                data: 'post payload',
                headers: { 'content-type': 'text/plain', 'X-Test': '1' }
            },
            null,
            { fetchFn: fetch302, validate: baseValidate, createDispatcher: baseDispatcher }
        );

        assert.strictEqual(reqs302[1].method, 'GET');
        assert.strictEqual(reqs302[1].body, undefined);
        assert.strictEqual(reqs302[1].headers['content-type'], undefined);
        assert.strictEqual(reqs302[1].headers['X-Test'], '1');

        // 301 on POST
        const reqs301 = [];
        const fetch301 = async (url, init) => {
            reqs301.push({ url, method: init.method, body: init.body, headers: Object.assign({}, init.headers) });
            if (url === 'https://a.com/post') {
                return new Response('moved', {
                    status: 301,
                    headers: { location: 'https://a.com/get' }
                });
            }
            return new Response('ok', { status: 200 });
        };

        await executeGmXmlHttpRequest(
            {
                url: 'https://a.com/post',
                method: 'POST',
                data: 'post payload'
            },
            null,
            { fetchFn: fetch301, validate: baseValidate, createDispatcher: baseDispatcher }
        );

        assert.strictEqual(reqs301[1].method, 'GET');
        assert.strictEqual(reqs301[1].body, undefined);

        // 307 on POST preserves method and body
        const reqs307 = [];
        const fetch307 = async (url, init) => {
            reqs307.push({ url, method: init.method, body: init.body, headers: Object.assign({}, init.headers) });
            if (url === 'https://a.com/post') {
                return new Response('temporary', {
                    status: 307,
                    headers: { location: 'https://a.com/target' }
                });
            }
            return new Response('ok', { status: 200 });
        };

        await executeGmXmlHttpRequest(
            {
                url: 'https://a.com/post',
                method: 'POST',
                data: 'post payload'
            },
            null,
            { fetchFn: fetch307, validate: baseValidate, createDispatcher: baseDispatcher }
        );

        assert.strictEqual(reqs307[1].method, 'POST');
        assert.strictEqual(reqs307[1].body, 'post payload');

        console.log('✓ Redirect status method and body rewrite rules verified');
    }

    // 3. More than 5 redirects throws; redirect: 'manual' returns 3xx; redirect: 'error' throws
    {
        let redirectIndex = 0;
        const infiniteRedirectFetch = async () => {
            redirectIndex++;
            return new Response('redirecting', {
                status: 302,
                headers: { location: `https://a.com/hop${redirectIndex}` }
            });
        };

        await assert.rejects(
            async () => {
                await executeGmXmlHttpRequest(
                    { url: 'https://a.com/hop0' },
                    null,
                    { fetchFn: infiniteRedirectFetch, validate: baseValidate, createDispatcher: baseDispatcher }
                );
            },
            (err) => err.message && err.message.includes('Too many redirects')
        );

        // redirect: 'manual' returns 3xx response
        const manualFetch = async () => {
            return new Response('manual 302', {
                status: 302,
                headers: { location: 'https://a.com/dest' }
            });
        };

        const manualRes = await executeGmXmlHttpRequest(
            { url: 'https://a.com/entry', redirect: 'manual' },
            null,
            { fetchFn: manualFetch, validate: baseValidate, createDispatcher: baseDispatcher }
        );
        assert.strictEqual(manualRes.status, 302);

        // redirect: 'error' throws
        await assert.rejects(
            async () => {
                await executeGmXmlHttpRequest(
                    { url: 'https://a.com/entry', redirect: 'error' },
                    null,
                    { fetchFn: manualFetch, validate: baseValidate, createDispatcher: baseDispatcher }
                );
            },
            (err) => err.message && err.message.includes('redirect=error')
        );

        console.log('✓ Redirect limit and manual/error handling verified');
    }

    // 4. Response body limits and UTF-8 streaming decoding
    {
        // Body exceeding maxResponseBytes rejects with a message containing "size"
        const chunkStream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(10));
                controller.enqueue(new Uint8Array(10));
                controller.close();
            }
        });

        await assert.rejects(
            async () => {
                await executeGmXmlHttpRequest(
                    { url: 'https://a.com/stream' },
                    null,
                    {
                        fetchFn: async () => new Response(chunkStream),
                        validate: baseValidate,
                        createDispatcher: baseDispatcher,
                        maxResponseBytes: 15
                    }
                );
            },
            (err) => err.message && err.message.includes('size')
        );

        // Content-length over limit rejects WITHOUT reading the body
        let bodyReadStarted = false;
        let readerAcquired = false;
        const guardedStream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(5));
                controller.close();
            }
        });
        const guardedResponse = new Response(guardedStream, {
            headers: { 'content-length': '200' }
        });
        const origGetReader = guardedResponse.body.getReader.bind(guardedResponse.body);
        guardedResponse.body.getReader = () => {
            readerAcquired = true;
            const r = origGetReader();
            const origRead = r.read.bind(r);
            r.read = () => {
                bodyReadStarted = true;
                return origRead();
            };
            return r;
        };
        guardedResponse.text = async () => {
            bodyReadStarted = true;
            return 'should not be called';
        };

        await assert.rejects(
            async () => {
                await executeGmXmlHttpRequest(
                    { url: 'https://a.com/cl-check' },
                    null,
                    {
                        fetchFn: async () => guardedResponse,
                        validate: baseValidate,
                        createDispatcher: baseDispatcher,
                        maxResponseBytes: 100
                    }
                );
            },
            (err) => err.message && err.message.includes('size')
        );
        assert.strictEqual(readerAcquired, false, 'Reader must not be acquired when content-length exceeds limit');
        assert.strictEqual(bodyReadStarted, false, 'Body stream must not be read when content-length exceeds limit');

        // Under-limit body returns text
        const okRes = await executeGmXmlHttpRequest(
            { url: 'https://a.com/under-limit' },
            null,
            {
                fetchFn: async () => new Response('hello world'),
                validate: baseValidate,
                createDispatcher: baseDispatcher,
                maxResponseBytes: 100
            }
        );
        assert.strictEqual(okRes.responseText, 'hello world');

        // Euro sign "€" split across two chunk boundaries decodes correctly
        const euroBytes = Buffer.from('€', 'utf8');
        const splitEuroStream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(euroBytes.subarray(0, 1)));
                controller.enqueue(new Uint8Array(euroBytes.subarray(1)));
                controller.close();
            }
        });

        const euroRes = await executeGmXmlHttpRequest(
            { url: 'https://a.com/euro' },
            null,
            {
                fetchFn: async () => new Response(splitEuroStream),
                validate: baseValidate,
                createDispatcher: baseDispatcher,
                maxResponseBytes: 100
            }
        );
        assert.strictEqual(euroRes.responseText, '€');

        console.log('✓ Response bounded reader, content-length cap, and UTF-8 multi-byte decoding verified');
    }

    // 5. Timeout clamping [1000, 120000] ms
    {
        const capturedDelays = [];
        const captureTimeoutFn = (cb, delay) => {
            capturedDelays.push(delay);
            return setTimeout(cb, delay);
        };

        const dummyFetch = async () => new Response('ok');

        await executeGmXmlHttpRequest(
            { url: 'https://a.com/t1', timeout: 1e12 },
            null,
            { fetchFn: dummyFetch, validate: baseValidate, createDispatcher: baseDispatcher, setTimeoutFn: captureTimeoutFn }
        );

        await executeGmXmlHttpRequest(
            { url: 'https://a.com/t2', timeout: 5 },
            null,
            { fetchFn: dummyFetch, validate: baseValidate, createDispatcher: baseDispatcher, setTimeoutFn: captureTimeoutFn }
        );

        await executeGmXmlHttpRequest(
            { url: 'https://a.com/t3' },
            null,
            { fetchFn: dummyFetch, validate: baseValidate, createDispatcher: baseDispatcher, setTimeoutFn: captureTimeoutFn }
        );

        assert.deepStrictEqual(capturedDelays, [120000, 1000, 30000]);
        console.log('✓ Timeout clamping logic verified');
    }

    // 6. HTTP method validation
    {
        for (const badMethod of ['TRACE', 'CONNECT']) {
            await assert.rejects(
                async () => {
                    await executeGmXmlHttpRequest(
                        { url: 'https://a.com/method', method: badMethod },
                        null,
                        { fetchFn: async () => new Response('ok'), validate: baseValidate, createDispatcher: baseDispatcher }
                    );
                },
                /Unsupported HTTP method/
            );
        }

        let executedMethod = null;
        const methodFetch = async (url, init) => {
            executedMethod = init.method;
            return new Response('ok');
        };

        await executeGmXmlHttpRequest(
            { url: 'https://a.com/method', method: 'post' },
            null,
            { fetchFn: methodFetch, validate: baseValidate, createDispatcher: baseDispatcher }
        );
        assert.strictEqual(executedMethod, 'POST');

        console.log('✓ Method allowlist and normalisation verified');
    }

    // 7. Request body larger than 5 MB throws before fetchFn is called
    {
        let fetchInvoked = false;
        const guardedFetch = async () => {
            fetchInvoked = true;
            return new Response('ok');
        };

        const oversizedData = 'x'.repeat(5 * 1024 * 1024 + 1);

        await assert.rejects(
            async () => {
                await executeGmXmlHttpRequest(
                    { url: 'https://a.com/oversized', method: 'POST', data: oversizedData },
                    null,
                    { fetchFn: guardedFetch, validate: baseValidate, createDispatcher: baseDispatcher }
                );
            },
            /Request body too large/
        );

        assert.strictEqual(fetchInvoked, false, 'fetchFn must not be called when request body is too large');
        console.log('✓ Oversized request body rejection verified');
    }

    // 8. User-Agent defaults and overrides
    {
        let sentHeaders = null;
        const uaFetch = async (url, init) => {
            sentHeaders = init.headers;
            return new Response('ok');
        };

        await executeGmXmlHttpRequest(
            { url: 'https://a.com/ua-default' },
            null,
            { fetchFn: uaFetch, validate: baseValidate, createDispatcher: baseDispatcher, userAgent: 'CustomUA/42.0' }
        );
        assert.strictEqual(sentHeaders['User-Agent'], 'CustomUA/42.0');

        sentHeaders = null;
        await executeGmXmlHttpRequest(
            { url: 'https://a.com/ua-custom', headers: { 'user-agent': 'ScriptUA/1.0' } },
            null,
            { fetchFn: uaFetch, validate: baseValidate, createDispatcher: baseDispatcher, userAgent: 'CustomUA/42.0' }
        );
        assert.strictEqual(sentHeaders['user-agent'], 'ScriptUA/1.0');
        assert.strictEqual(sentHeaders['User-Agent'], undefined);

        console.log('✓ User-Agent resolution and script header preservation verified');
    }

    // 9. module.exports verification
    {
        const requiredExports = [
            'initializeUserContent',
            'reloadScripts',
            'reloadStyles',
            'getMatchingUserContent',
            'loadScriptStorage',
            'saveScriptStorage',
            'setScriptValue',
            'deleteScriptValue',
            'generateScriptToken',
            'executeGmXmlHttpRequest',
            'isPrivateOrBlockedIP',
            'isHostAllowed',
            'validateRequestDestination',
            'createPinnedDispatcher'
        ];

        for (const name of requiredExports) {
            assert.strictEqual(
                typeof userContent[name],
                'function',
                `Export ${name} must be preserved as a function`
            );
        }

        console.log('✓ Module exports integrity verified');
    }

    console.log('\nAll GM_xmlhttpRequest regression tests passed successfully!');
})();
