# The False Panacea of Encrypted DNS: Why Mise Keeps DNS-over-HTTPS Off by Default

Why mainstream browsers pushed DoH to centralise query routing, the persistent myth of complete lookup anonymity, and how Mise balances protocol privacy with network sovereignty.

`Perspectives` · `Open Source` · `Browser Security` · `Privacy Architecture` · `Mise Browser`

---

## 1. The Marketing of a "Magic" Privacy Shield

When DNS-over-HTTPS (DoH, RFC 8484) emerged, mainstream browser vendors hailed it as an unreserved triumph for consumer privacy. For decades, the foundation of web navigation had rested on unencrypted UDP port 53 packets, allowing commercial internet service providers, local network administrators, and passive eavesdroppers to catalogue every domain a user queried in cleartext.

By encapsulating DNS lookups within standard TLS-encrypted HTTPS sessions over port 443, DoH promised to slam that window shut. Domain name resolutions would blend indistinguishably into the background hum of regular web traffic.

Yet shortly after the protocol matured, corporate browsers shifted from offering an optional capability to quietly flipping the switch by default. Millions of everyday users had their local operating system DNS settings bypassed, redirecting their lookup streams into a small cartel of massive cloud infrastructure providers.

What had begun as a cryptographic enhancement rapidly evolved into an aggressive centralisation of core internet plumbing. Under the banner of user protection, corporate vendors seized the opportunity to wrest control of the resolution pipeline away from the local operating system, trading local network visibility for centralised platform influence.

---

## 2. The Operational Security Blind Spot: What DoH Cannot Hide

The greatest hazard of modern privacy features is not that they fail to work, but that they instil a false sense of operational security. In many technical communities, DoH is casually discussed as if it were a cryptographic cloak that renders browsing untraceable.

The reality of modern networking is far more sober. While DoH protects the specific request asking for an IP address, it leaves several critical vectors entirely exposed:

* **Cleartext Server Name Indication (SNI):** Before a browser can establish a secure TLS connection to an external website, it performs an initial handshake. Unless both the client, the intermediate network, and the destination web server support Encrypted Client Hello (ECH), the destination hostname is transmitted openly in the SNI header. Any ISP or state filter inspecting traffic sees the visited domain immediately, rendering the preceding encrypted DNS lookup redundant for concealment.
* **Destination IP Address Routing:** Even in a theoretical world of ubiquitous ECH, IP packets must physically travel across network infrastructure to reach their destination. An ISP or network eavesdropper monitoring packet flows knows the exact IP address of every server contacted. For distinct websites, dedicated hosts, or smaller services, destination IP tracking reveals identity just as readily as cleartext DNS.
* **The Transferred Trust Boundary:** DoH does not eliminate the need to trust a DNS provider; it merely shifts that trust from a local entity to a remote corporate aggregator. Instead of trusting a local gateway, a regional ISP, or a self-hosted caching resolver, the user hands a consolidated, real-time index of their digital life to an external cloud platform.

To present DoH as complete anonymity is a dangerous distortion. It protects against passive local network sniffing and ISP query injection, but it does not conceal visited services from disciplined traffic analysis or determined network observers.

---

## 3. The Threat to Local Network Sovereignty

Beyond traffic analysis, the trend of forcing DoH by default strikes at a foundational tenet of modern computing: user sovereignty over local infrastructure.

In Linux and homelab environments, technical users deliberately design their local network architectures. They configure local recursive resolvers using Unbound, implement domain-level protection through Pi-hole or AdGuard Home, map internal subnets (.internal, .local), and audit outgoing traffic to identify misbehaving IoT devices or errant background daemons.

When a browser unilaterally bypasses system DNS settings to route queries out-of-band to a remote corporate server:

1. **Local Filtering is Neutralised:** Network-wide ad blockers and malicious domain filters are silently stripped of their ability to inspect and intercept dangerous lookups.
2. **Internal Topologies Break:** Local development environments, homelab services, and internal intranet hosts fail to resolve, causing inexplicable connection timeouts.
3. **Network Telemetry is Blindfolded:** Network administrators lose the ability to detect malware beacons, compromised containers, or anomalous lateral movement within their own perimeter.

This paternalistic posture, the assumption that an application vendor knows better than the user who owns and administers the physical host machine, is incompatible with deliberate, transparent software design.

---

## 4. The Mise Position: Neutrality, Transparency, and Deliberate Choice

Mise Browser approaches privacy not as a marketing catchphrase, but as an engineering discipline centered on user autonomy. We believe a browser must provide robust privacy tooling without arrogating the right to dictate how a user interacts with the internet.

In Mise, the DNS-over-HTTPS selector is built around four fundamental architectural pillars:

* **Disabled by Default:** Mise ships with DoH turned `off` out of the box (`doh_provider: 'off'`). Out of the box, the browser strictly honours the local operating system's network configuration and resolver settings.
* **Curated Privacy Champions:** When users elect to enable DoH, they can choose from established, privacy-respecting European and global providers:
  * **Quad9:** Swiss-based non-profit foundation operating under strict Swiss privacy statutes, with automated threat intelligence blocking.
  * **Mullvad:** Swedish-based privacy stalwart adhering to a rigorous zero-logging policy.
  * **Cloudflare:** High-performance 1.1.1.1 anycast resolution for users prioritising global query speed.
* **Open Endpoint Sovereignty:** Through the `custom` selector, users can specify any valid HTTPS endpoint template, seamlessly connecting Mise to their self-hosted NextDNS profile, personal AdGuard instance, or bespoke corporate resolver.
* **Zero Intermediation:** Mise Browser never acts as a middleman. There is zero telemetry, zero query logging, and zero server-side proxying. Lookups flow directly and exclusively between the local device and the configured resolver.

---

## 5. Engineering with Respect

By placing the selector exclusively within Preferences under **Privacy & Protection** and presenting clear operational security notices directly alongside the controls, Mise ensures users understand both the strengths and the inherent limitations of encrypted lookup protocols.

Genuine privacy is never achieved through opaque corporate defaults or paternalistic overrides. It is forged through transparent engineering, auditable code, and giving users the precise controls needed to defend their own threat models.
