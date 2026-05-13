from unittest.mock import patch, MagicMock
import dns.resolver
from app.checker import check_dnsbl, check_target, _check_one, COMMON_DNSBLS


def test_check_dnsbl_clean():
    # 127.0.0.1 is not on any real DNSBL — run live as smoke test
    # (short-circuits quickly since NXDOMAIN is returned)
    result = check_dnsbl("127.0.0.1")
    assert result is False


def test_common_dnsbls_not_empty():
    assert len(COMMON_DNSBLS) >= 50


def test_check_one_listed():
    with patch("app.checker._get_resolver") as mock_res:
        mock_res.return_value.resolve.return_value = [MagicMock()]
        assert _check_one("1.2.3.4", "zen.spamhaus.org") is True


def test_check_one_clean():
    with patch("app.checker._get_resolver") as mock_res:
        mock_res.return_value.resolve.side_effect = dns.resolver.NXDOMAIN
        assert _check_one("1.2.3.4", "zen.spamhaus.org") is False


def test_check_one_timeout_returns_false():
    with patch("app.checker._get_resolver") as mock_res:
        mock_res.return_value.resolve.side_effect = dns.exception.Timeout
        assert _check_one("1.2.3.4", "zen.spamhaus.org") is False


def test_check_dnsbl_listed_when_any_dnsbl_returns_hit():
    with patch("app.checker._check_one", return_value=True):
        assert check_dnsbl("1.2.3.4") is True


def test_check_dnsbl_clean_when_all_miss():
    with patch("app.checker._check_one", return_value=False):
        assert check_dnsbl("1.2.3.4") is False


def test_check_target_ip_delegates_to_check_dnsbl():
    with patch("app.checker.check_dnsbl", return_value=False) as mock:
        result = check_target("1.2.3.4", "ip")
        assert result is False
        mock.assert_called_once_with("1.2.3.4")


def test_check_target_domain_resolves_and_checks_each_ip():
    answers = [MagicMock(address="1.2.3.4"), MagicMock(address="5.6.7.8")]
    with patch("app.checker._get_resolver") as mock_res:
        mock_res.return_value.resolve.return_value = answers
        with patch("app.checker.check_dnsbl", return_value=False) as mock_dnsbl:
            result = check_target("example.com", "domain")
            assert result is False
            assert mock_dnsbl.call_count == 2


def test_check_target_domain_listed_if_any_ip_listed():
    answers = [MagicMock(address="1.2.3.4")]
    with patch("app.checker._get_resolver") as mock_res:
        mock_res.return_value.resolve.return_value = answers
        with patch("app.checker.check_dnsbl", return_value=True):
            assert check_target("spam.example.com", "domain") is True


def test_check_target_domain_resolution_failure_returns_false():
    with patch("app.checker._get_resolver") as mock_res:
        mock_res.return_value.resolve.side_effect = dns.resolver.NXDOMAIN
        assert check_target("nonexistent.invalid", "domain") is False
