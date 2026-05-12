import socket
from unittest.mock import patch
from app.checker import check_dnsbl, check_target

def test_check_dnsbl_clean():
    assert check_dnsbl("127.0.0.1") == False

def test_check_target_ip_delegates_to_check_dnsbl():
    with patch("app.checker.check_dnsbl", return_value=False) as mock:
        result = check_target("1.2.3.4", "ip")
        assert result == False
        mock.assert_called_once_with("1.2.3.4")

def test_check_target_domain_resolves_and_checks_each_ip():
    with patch("app.checker.socket.gethostbyname_ex") as mock_resolve:
        mock_resolve.return_value = ("example.com", [], ["1.2.3.4", "5.6.7.8"])
        with patch("app.checker.check_dnsbl", return_value=False) as mock_dnsbl:
            result = check_target("example.com", "domain")
            assert result == False
            assert mock_dnsbl.call_count == 2

def test_check_target_domain_listed_if_any_ip_listed():
    with patch("app.checker.socket.gethostbyname_ex") as mock_resolve:
        mock_resolve.return_value = ("spam.example.com", [], ["1.2.3.4"])
        with patch("app.checker.check_dnsbl", return_value=True):
            assert check_target("spam.example.com", "domain") == True

def test_check_target_domain_resolution_failure_returns_false():
    with patch("app.checker.socket.gethostbyname_ex", side_effect=socket.gaierror):
        assert check_target("nonexistent.invalid", "domain") == False
