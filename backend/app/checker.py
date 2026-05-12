import socket

# Common test DNSBLs (Spamhaus usually has a test record for 127.0.0.2)
COMMON_DNSBLS = ["zen.spamhaus.org", "bl.spamcop.net"]

def check_dnsbl(ip: str):
    """
    Checks if an IP is listed on common DNSBLs.
    Returns True if listed, False if clean.
    """
    try:
        # Reverse IP for DNSBL query (e.g., 1.2.3.4 -> 4.3.2.1)
        reversed_ip = ".".join(reversed(ip.split(".")))
    except Exception:
        return False # Invalid IP format

    for dnsbl in COMMON_DNSBLS:
        try:
            # A DNS query for <reversed_ip>.<dnsbl> returns an A record if listed
            socket.gethostbyname(f"{reversed_ip}.{dnsbl}")
            return True
        except socket.gaierror:
            # socket.gaierror: [Errno -2] Name or service not known means NOT listed
            continue
        except Exception:
            continue
    return False
