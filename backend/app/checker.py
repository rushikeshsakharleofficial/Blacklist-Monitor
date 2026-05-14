from __future__ import annotations
import threading
import ipaddress
from concurrent.futures import ThreadPoolExecutor, as_completed
import dns.resolver
import dns.exception

COMMON_DNSBLS = [
    "zen.spamhaus.org",
    "bl.spamcop.net",
    "b.barracudacentral.org",
    "bl.blocklist.de",
    "dnsbl-1.uceprotect.net",
    "dnsbl-2.uceprotect.net",
    "dnsbl-3.uceprotect.net",
    "dyna.spamrats.com",
    "noptr.spamrats.com",
    "spam.spamrats.com",
    "bl.spameatingmonkey.net",
    "backscatter.spameatingmonkey.net",
    "bl.mailspike.net",
    "z.mailspike.net",
    "psbl.surriel.com",
    "ubl.lashback.com",
    "spam.rbl.msrbl.net",
    "phishing.rbl.msrbl.net",
    "ips.backscatterer.org",
    "bl.0spam.org",
    "rbl.0spam.org",
    "relays.nether.net",
    "unsure.nether.net",
    "bl.nordspam.com",
    "dnsbl.suomispam.net",
    "dnsbl.swinog.ch",
    "tor.dan.me.uk",
    "torexit.dan.me.uk",
    "bogons.cymru.com",
    "dnsbl.dronebl.org",
    "spamsources.fabel.dk",
    "blacklist.woody.ch",
    "dnsbl.zapbl.net",
    "filterdb.iss.net",
    "hostkarma.junkemailfilter.com",
    "blacklist.jippg.org",
    "bl.konstant.no",
    "all.s5h.net",
    "spam.dnsbl.anonmails.de",
    "dnsbl.calivent.com.pe",
    "rbl.interserver.net",
    "truncate.gbudb.net",
    "rbl.schulte.org",
    # Additional MXToolbox-verified zones
    "bl.drmx.org",
    "spamrbl.imp.ch",
    "wormrbl.imp.ch",
    "dnsbl.kempt.net",
    "bl.nosolicitado.org",
    "short.rbl.jp",
    "virus.rbl.jp",
    "korea.services.net",
    "rbl2.triumf.ca",
]

# Zones that return specific codes: only certain return IPs indicate listing.
# Key: zone, Value: set of 127.x.x.x strings that mean "listed".
# All other return codes from these zones are ignored.
_CODED_ZONES: dict[str, set[str]] = {
    # hostkarma: 127.0.0.1=whitelist(good), 127.0.0.2=blacklist, 127.0.0.3=yellow, 127.0.0.4=brown
    "hostkarma.junkemailfilter.com": {"127.0.0.2", "127.0.0.3", "127.0.0.4"},
}

_local = threading.local()


def _get_resolver() -> dns.resolver.Resolver:
    if not hasattr(_local, "resolver"):
        r = dns.resolver.Resolver()
        r.timeout = 5
        r.lifetime = 5
        _local.resolver = r
    return _local.resolver


def _check_one(reversed_ip: str, dnsbl: str) -> bool:
    try:
        answers = _get_resolver().resolve(f"{reversed_ip}.{dnsbl}", "A")
        if dnsbl in _CODED_ZONES:
            return any(str(r) in _CODED_ZONES[dnsbl] for r in answers)
        return True
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return False
    except Exception:
        return False


def check_dnsbl(ip: str) -> list[str]:
    """Check IP against all DNSBLs concurrently. Returns list of hit DNSBL zones."""
    try:
        reversed_ip = ".".join(reversed(ip.split(".")))
    except Exception:
        return []

    hits: list[str] = []
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {
            executor.submit(_check_one, reversed_ip, dnsbl): dnsbl
            for dnsbl in COMMON_DNSBLS
        }
        try:
            for future in as_completed(futures, timeout=40):
                dnsbl = futures[future]
                try:
                    if future.result():
                        hits.append(dnsbl)
                except Exception:
                    pass
        except Exception:
            pass
    return hits


def check_subnet_cidr(cidr: str) -> list[dict]:
    """Check every host IP in a subnet. Returns list of {ip, zones} for listed IPs only."""
    try:
        net = ipaddress.ip_network(cidr, strict=False)
        ips = [str(ip) for ip in net.hosts()] or [str(net.network_address)]
    except Exception:
        return []
    total = len(ips)
    workers = min(total, 32)
    results = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(check_dnsbl, ip): ip for ip in ips}
        try:
            for future in as_completed(futures, timeout=max(300, total * 2)):
                ip = futures[future]
                try:
                    hits = future.result()
                except Exception:
                    hits = []
                if hits:
                    results.append({"ip": ip, "zones": hits})
        except Exception:
            pass
    results.sort(key=lambda x: [int(p) for p in x["ip"].split(".")])
    return results


def _cymru_asn_name(ip: str) -> str | None:
    """ASN org name via Team Cymru DNS — fast fallback."""
    try:
        rev = ".".join(reversed(ip.split(".")))
        answers = _get_resolver().resolve(f"{rev}.origin.asn.cymru.com", "TXT")
        txt = str(answers[0]).strip('"')
        asn = txt.split("|")[0].strip()
        if not asn or asn == "NA":
            return None
        answers2 = _get_resolver().resolve(f"AS{asn}.asn.cymru.com", "TXT")
        txt2 = str(answers2[0]).strip('"')
        parts = [p.strip() for p in txt2.split("|")]
        if len(parts) >= 5:
            raw = parts[4].strip()
            # "GOOGLE - Google LLC, US" → "Google LLC"
            # "TATACOMM-AS TATA Communications..., IN" → strip AS prefix
            if " - " in raw:
                raw = raw.split(" - ", 1)[1]
            # strip trailing ", CC" country code
            if raw.count(",") >= 1:
                raw = raw.rsplit(",", 1)[0].strip()
            return raw[:100] or None
    except Exception:
        return None


_ORG_CACHE_TTL = 86400  # 24 hours


def lookup_org(ip: str) -> str | None:
    """Return registered owner/org for an IPv4 address. Results cached in Redis for 24h.
    Tries RDAP first (actual registrant name), falls back to cleaned Cymru ASN name."""
    try:
        addr = ipaddress.ip_address(ip)
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return None
    except Exception:
        return None

    cache_key = f"org:{ip}"
    try:
        from .redis_client import rclient
        cached = rclient.get(cache_key)
        if cached is not None:
            return cached or None  # empty string sentinel → None
    except Exception:
        pass

    result: str | None = None
    try:
        from ipwhois import IPWhois
        rdap = IPWhois(ip).lookup_rdap(depth=0, retry_count=1)
        remarks = rdap.get("network", {}).get("remarks") or []
        for rem in remarks:
            if rem.get("title") == "description" and rem.get("description"):
                first_line = rem["description"].split("\n")[0].strip()
                if first_line and len(first_line) > 2:
                    result = first_line[:100]
                    break
        if not result:
            asn_desc = rdap.get("asn_description", "") or ""
            if asn_desc:
                if " - " in asn_desc:
                    asn_desc = asn_desc.split(" - ", 1)[1]
                if "," in asn_desc:
                    asn_desc = asn_desc.rsplit(",", 1)[0].strip()
                if asn_desc and len(asn_desc) > 2:
                    result = asn_desc[:100]
    except Exception:
        pass

    if not result:
        result = _cymru_asn_name(ip)

    try:
        from .redis_client import rclient
        rclient.setex(cache_key, _ORG_CACHE_TTL, result or "")
    except Exception:
        pass

    return result


def lookup_org_for_target(address: str, target_type: str) -> str | None:
    """Resolve org for any target type (ip, domain, cidr/subnet)."""
    if target_type == "ip":
        return lookup_org(address)
    if target_type == "domain":
        try:
            answers = _get_resolver().resolve(address, "A")
            return lookup_org(answers[0].address)
        except Exception:
            return None
    if target_type in ("cidr", "subnet"):
        try:
            net = ipaddress.ip_network(address, strict=False)
            return lookup_org(str(net.network_address))
        except Exception:
            return None
    return None


def check_target(address: str, target_type: str) -> list[str]:
    """Returns list of DNSBL zones where address is listed (empty = clean)."""
    if target_type == "ip":
        return check_dnsbl(address)
    if target_type == "domain":
        try:
            answers = _get_resolver().resolve(address, "A")
            ips = [r.address for r in answers]
        except Exception:
            return []
        all_hits: list[str] = []
        for ip in ips:
            all_hits.extend(check_dnsbl(ip))
        return list(set(all_hits))
    return []
