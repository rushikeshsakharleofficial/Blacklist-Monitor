import socket

COMMON_DNSBLS = ["zen.spamhaus.org", "bl.spamcop.net"]

def check_dnsbl(ip: str) -> bool:
    try:
        reversed_ip = ".".join(reversed(ip.split(".")))
    except Exception:
        return False
    for dnsbl in COMMON_DNSBLS:
        try:
            socket.gethostbyname(f"{reversed_ip}.{dnsbl}")
            return True
        except socket.gaierror:
            continue
        except Exception:
            continue
    return False

def check_target(address: str, target_type: str) -> bool:
    if target_type == "ip":
        return check_dnsbl(address)
    if target_type == "domain":
        try:
            _, _, ips = socket.gethostbyname_ex(address)
        except socket.gaierror:
            return False
        return any(check_dnsbl(ip) for ip in ips)
    return False
