from app.checker import check_dnsbl

def test_check_dnsbl_clean():
    # 127.0.0.1 is a standard clean IP for testing DNSBL logic locally
    assert check_dnsbl("127.0.0.1") == False
