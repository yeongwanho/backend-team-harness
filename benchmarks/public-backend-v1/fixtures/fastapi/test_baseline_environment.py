import emails
import pytest

from tests.bth_evaluation_bootstrap import _in_memory_mail


def test_synthetic_mail_builds_real_mime_without_using_smtp() -> None:
    message = emails.Message(subject="Public fixture", html="<p>synthetic</p>", mail_from="fixture@example.com")
    response = message.send(to="recipient@example.com", smtp={"host": "must-not-connect.invalid", "port": 1})
    assert response.success
    assert response.status_code == 250
    assert response.from_addr == "fixture@example.com"
    assert response.to_addrs == ["recipient@example.com"]


def test_synthetic_transport_rejects_non_test_addresses_before_reading_message() -> None:
    for address in ["person@company.invalid", "person@example.com\r\nInjected: value", "missing-domain"]:
        with pytest.raises(RuntimeError, match="synthetic example.com"):
            _in_memory_mail(None, "fixture@example.com", [address], object())
