from unittest.mock import patch, MagicMock
import dns.resolver
from app.checker import check_dnsbl, check_target


def test_check_dnsbl_clean():
    assert check_dnsbl("127.0.0.1") == False


def test_check_target_ip_delegates_to_check_dnsbl():
    with patch("app.checker.check_dnsbl", return_value=False) as mock:
        result = check_target("1.2.3.4", "ip")
        assert result == False
        mock.assert_called_once_with("1.2.3.4")


def test_check_target_domain_resolves_and_checks_each_ip():
    answers = [MagicMock(address="1.2.3.4"), MagicMock(address="5.6.7.8")]
    with patch("app.checker._resolver.resolve", return_value=answers) as mock_resolve:
        with patch("app.checker.check_dnsbl", return_value=False) as mock_dnsbl:
            result = check_target("example.com", "domain")
            assert result == False
            mock_resolve.assert_called_once_with("example.com", "A")
            assert mock_dnsbl.call_count == 2


def test_check_target_domain_listed_if_any_ip_listed():
    answers = [MagicMock(address="1.2.3.4")]
    with patch("app.checker._resolver.resolve", return_value=answers):
        with patch("app.checker.check_dnsbl", return_value=True):
            assert check_target("spam.example.com", "domain") == True


def test_check_target_domain_resolution_failure_returns_false():
    with patch("app.checker._resolver.resolve", side_effect=dns.resolver.NXDOMAIN):
        assert check_target("nonexistent.invalid", "domain") == False
