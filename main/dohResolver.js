// main/dohResolver.js
// DNS-over-HTTPS (DoH) resolver manager and host resolver integration

const DOH_PROVIDERS = {
    quad9: 'https://dns.quad9.net/dns-query',
    mullvad: 'https://dns.mullvad.net/dns-query',
    cloudflare: 'https://cloudflare-dns.com/dns-query'
};

function isValidDoHUrl(urlString) {
    if (typeof urlString !== 'string' || urlString.length === 0 || urlString.length > 512) {
        return false;
    }
    try {
        const parsed = new URL(urlString);
        return parsed.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function applyDoHConfiguration(app, provider, customUrl) {
    if (!app || typeof app.configureHostResolver !== 'function') {
        return;
    }

    if (provider === 'custom') {
        if (isValidDoHUrl(customUrl)) {
            app.configureHostResolver({
                enableBuiltInResolver: true,
                secureDnsMode: 'secure',
                secureDnsServers: [customUrl],
                secureDnsServerTemplates: [customUrl]
            });
            return;
        }
        // Invalid custom URL safely falls back to system resolver
        app.configureHostResolver({
            enableBuiltInResolver: true,
            secureDnsMode: 'off'
        });
        return;
    }

    const template = DOH_PROVIDERS[provider];
    if (template) {
        app.configureHostResolver({
            enableBuiltInResolver: true,
            secureDnsMode: 'secure',
            secureDnsServers: [template],
            secureDnsServerTemplates: [template]
        });
        return;
    }

    // Default or off: use standard operating system DNS resolution
    app.configureHostResolver({
        enableBuiltInResolver: true,
        secureDnsMode: 'off'
    });
}

module.exports = {
    DOH_PROVIDERS,
    isValidDoHUrl,
    applyDoHConfiguration
};
