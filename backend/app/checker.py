import dns.resolver
import dns.exception

COMMON_DNSBLS = ["zen.spamhaus.org", "bl.spamcop.net"]

_resolver = dns.resolver.Resolver()
_resolver.timeout = 5
_resolver.lifetime = 5


def check_dnsbl(ip: str) -> bool:
    try:
        reversed_ip = ".".join(reversed(ip.split(".")))
    except Exception:
        return False
    for dnsbl in COMMON_DNSBLS:
        try:
            _resolver.resolve(f"{reversed_ip}.{dnsbl}", "A")
            return True
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            continue
        except (dns.exception.Timeout, dns.resolver.NoNameservers):
            continue
        except Exception:
            continue
    return False


def check_target(address: str, target_type: str) -> bool:
    if target_type == "ip":
        return check_dnsbl(address)
    if target_type == "domain":
        try:
            answers = _resolver.resolve(address, "A")
            ips = [r.address for r in answers]
        except Exception:
            return False
        return any(check_dnsbl(ip) for ip in ips)
    return False
