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


def _cymru_asn_name(ip: str) -> tuple[str | None, str | None]:
    """ASN org name + ASN number via Team Cymru DNS. Returns (org_name, 'ASxxxxx') or (None, None)."""
    try:
        rev = ".".join(reversed(ip.split(".")))
        answers = _get_resolver().resolve(f"{rev}.origin.asn.cymru.com", "TXT")
        txt = str(answers[0]).strip('"')
        asn = txt.split("|")[0].strip()
        if not asn or asn == "NA":
            return None, None
        asn_str = f"AS{asn}"
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
            return raw[:100] or None, asn_str
        return None, asn_str
    except Exception:
        return None, None


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
        result, _ = _cymru_asn_name(ip)

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


def lookup_ptr(ip: str) -> tuple[str | None, bool]:
    """Returns (ptr_hostname, is_fcrdns). FCrDNS = PTR hostname resolves back to same IP."""
    try:
        rev = dns.reversename.from_address(ip)
        answers = dns.resolver.resolve(rev, 'PTR', lifetime=3)
        hostname = str(answers[0]).rstrip('.')
        # Forward-confirm: hostname must resolve back to the original IP
        try:
            fwd = dns.resolver.resolve(hostname, 'A', lifetime=3)
            is_fcrdns = any(str(r) == ip for r in fwd)
        except Exception:
            is_fcrdns = False
        return hostname, is_fcrdns
    except Exception:
        return None, False


def lookup_asn_number(ip: str) -> str | None:
    """Return ASN string like 'AS15169' for an IPv4. Uses Redis cache (24h TTL)."""
    try:
        addr = ipaddress.ip_address(ip)
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return None
    except Exception:
        return None
    cache_key = f"asn:{ip}"
    try:
        from .redis_client import rclient
        cached = rclient.get(cache_key)
        if cached is not None:
            return cached or None
    except Exception:
        pass
    try:
        rev = ".".join(reversed(ip.split(".")))
        answers = _get_resolver().resolve(f"{rev}.origin.asn.cymru.com", "TXT")
        txt = str(answers[0]).strip('"')
        asn = txt.split("|")[0].strip()
        if not asn or asn == "NA":
            result = ""
        else:
            result = f"AS{asn}"
    except Exception:
        result = ""
    try:
        from .redis_client import rclient
        rclient.setex(cache_key, _ORG_CACHE_TTL, result)
    except Exception:
        pass
    return result or None


_GEO_CACHE_TTL = 86400  # 24 hours


def lookup_ip_details(ip: str) -> dict:
    """
    Return comprehensive IP info using RDAP (ipwhois) + Cymru DNS + PTR.
    No external HTTP calls — all DNS/RDAP-based, works from any network.
    Returns: country_code, country_name, city, isp, reverse_dns, is_hosting, network_cidr, asn.
    Results cached in Redis for 24h.
    """
    import json as _json
    empty = {"country_code": None, "country_name": None, "city": None,
             "isp": None, "reverse_dns": None, "is_hosting": None,
             "network_cidr": None, "asn": None}
    try:
        addr = ipaddress.ip_address(ip)
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return empty
    except Exception:
        return empty

    cache_key = f"ipgeo:{ip}"
    try:
        from .redis_client import rclient
        cached = rclient.get(cache_key)
        if cached is not None:
            return _json.loads(cached) if cached else empty
    except Exception:
        pass

    result = dict(empty)

    # ── 1. ipwhois RDAP — country, network CIDR, ASN, ISP ─────────────────
    try:
        from ipwhois import IPWhois
        rdap = IPWhois(ip).lookup_rdap(depth=0, retry_count=1)

        result["asn"] = f"AS{rdap['asn']}" if rdap.get("asn") else None
        result["network_cidr"] = rdap.get("asn_cidr") or None
        result["country_code"] = rdap.get("asn_country_code") or None

        # ISP from asn_description: "WEBWERKSAS1 - Web Werks, US" → "Web Werks"
        asn_desc = rdap.get("asn_description", "") or ""
        if asn_desc:
            if " - " in asn_desc:
                asn_desc = asn_desc.split(" - ", 1)[1]
            if "," in asn_desc:
                asn_desc = asn_desc.rsplit(",", 1)[0].strip()
            if len(asn_desc) > 2:
                result["isp"] = asn_desc[:100]

    except Exception:
        pass

    # ── 2. Cymru DNS fallback for country_code + network_cidr ──────────────
    if not result["country_code"] or not result["network_cidr"]:
        try:
            rev = ".".join(reversed(ip.split(".")))
            answers = _get_resolver().resolve(f"{rev}.origin.asn.cymru.com", "TXT")
            txt = str(answers[0]).strip('"')
            # Format: "33480 | 202.162.239.0/24 | IN | apnic | 1997-08-22"
            parts = [p.strip() for p in txt.split("|")]
            if len(parts) >= 3:
                if not result["asn"] and parts[0]:
                    result["asn"] = f"AS{parts[0]}"
                if not result["network_cidr"] and parts[1]:
                    result["network_cidr"] = parts[1]
                if not result["country_code"] and parts[2]:
                    result["country_code"] = parts[2].upper()
        except Exception:
            pass

    # ── 3. PTR / reverse DNS ───────────────────────────────────────────────
    try:
        import dns.reversename
        ptr_name = dns.reversename.from_address(ip)
        ans = _get_resolver().resolve(ptr_name, "PTR", lifetime=3)
        result["reverse_dns"] = str(ans[0]).rstrip(".")
    except Exception:
        pass

    # ── 4. Country name from pycountry (ISO 3166-1 alpha-2) ────────────────
    cc = result.get("country_code")
    if cc:
        try:
            import pycountry
            country = pycountry.countries.get(alpha_2=cc)
            result["country_name"] = country.name if country else cc
        except Exception:
            result["country_name"] = cc

    try:
        from .redis_client import rclient
        rclient.setex(cache_key, _GEO_CACHE_TTL, _json.dumps(result))
    except Exception:
        pass

    return result


_DOMAIN_CACHE_TTL = 3600  # 1 hour (domains change less predictably)


def lookup_domain_details(domain: str) -> dict:
    """
    Enrich a domain target with: nameservers, registrar, domain age,
    SPF/DMARC/MX presence, and a 0-100 reputation score.
    Uses DNS (dnspython) + python-whois. Results cached in Redis for 1h.
    """
    import json as _json
    empty = {
        "nameservers": None, "registrar": None, "domain_age_days": None,
        "has_spf": None, "has_dmarc": None, "has_mx": None, "reputation_score": None,
    }
    domain = domain.lower().strip().rstrip(".")
    if not domain or "." not in domain:
        return empty

    cache_key = f"domgeo:{domain}"
    try:
        from .redis_client import rclient
        cached = rclient.get(cache_key)
        if cached is not None:
            return _json.loads(cached) if cached else empty
    except Exception:
        pass

    result = dict(empty)
    resolver = _get_resolver()

    # -- 1. Nameservers --------------------------------------------------
    try:
        ns_answers = resolver.resolve(domain, "NS", lifetime=5)
        result["nameservers"] = _json.dumps(
            sorted({str(r).rstrip(".").lower() for r in ns_answers})[:8]
        )
    except Exception:
        pass

    # -- 2. MX records ---------------------------------------------------
    try:
        mx_answers = resolver.resolve(domain, "MX", lifetime=5)
        result["has_mx"] = len(mx_answers) > 0
    except Exception:
        result["has_mx"] = False

    # -- 3. SPF (TXT record containing "v=spf1") -------------------------
    try:
        txt_answers = resolver.resolve(domain, "TXT", lifetime=5)
        spf_found = any(
            "v=spf1" in "".join(str(r) for r in rdata.strings).lower()
            for rdata in txt_answers
        )
        result["has_spf"] = spf_found
    except Exception:
        result["has_spf"] = False

    # -- 4. DMARC (_dmarc.domain TXT) -----------------------------------
    try:
        dmarc_answers = resolver.resolve(f"_dmarc.{domain}", "TXT", lifetime=5)
        dmarc_found = any(
            "v=dmarc1" in "".join(str(r) for r in rdata.strings).lower()
            for rdata in dmarc_answers
        )
        result["has_dmarc"] = dmarc_found
    except Exception:
        result["has_dmarc"] = False

    # -- 5. WHOIS - registrar + domain age -------------------------------
    try:
        import whois as _whois
        import datetime as _datetime
        w = _whois.whois(domain)
        if w.registrar:
            result["registrar"] = str(w.registrar)[:200]
        created = w.creation_date
        if isinstance(created, list):
            created = created[0]
        if created:
            if hasattr(created, 'replace'):
                now = _datetime.datetime.now(tz=_datetime.timezone.utc)
                if created.tzinfo is None:
                    created = created.replace(tzinfo=_datetime.timezone.utc)
                delta = now - created
                result["domain_age_days"] = max(0, delta.days)
    except Exception:
        pass

    # -- 6. Reputation score (0-100) ------------------------------------
    # Start at 70 (unknown domain, neutral). Adjust based on signals:
    score = 70
    if result["has_spf"]:
        score += 10
    if result["has_dmarc"]:
        score += 10
    if result["has_mx"]:
        score += 5
    age = result.get("domain_age_days") or 0
    if age > 730:    # > 2 years
        score += 10
    elif age > 365:  # > 1 year
        score += 5
    elif age > 0 and age < 30:  # brand new domain
        score -= 20
    elif age > 0 and age < 90:
        score -= 10
    result["reputation_score"] = max(0, min(100, score))

    try:
        from .redis_client import rclient
        rclient.setex(cache_key, _DOMAIN_CACHE_TTL, _json.dumps(result))
    except Exception:
        pass

    return result


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
