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
