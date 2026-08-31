"""Explicit public-pilot pytest plugin; keeps the repository's original tests."""
import os
import socket
from email import message_from_string

from pydantic_settings import BaseSettings
from emails.backend.smtp.backend import SMTPBackend
from emails.backend.response import SMTPResponse

_settings_init = BaseSettings.__init__


def _without_dotenv(self, *args, **kwargs):
    kwargs["_env_file"] = None
    _settings_init(self, *args, **kwargs)


BaseSettings.__init__ = _without_dotenv
_connect = socket.socket.connect
_connect_ex = socket.socket.connect_ex


def _local_only(address):
    if not isinstance(address, tuple) or address[0] != "127.0.0.1" or address[1] != int(os.environ["BTH_ORACLE_DB_PORT"]):
        raise RuntimeError("Public pilot forbids non-test socket connections")


def _local_connect(self, address):
    _local_only(address)
    return _connect(self, address)


def _local_connect_ex(self, address):
    _local_only(address)
    return _connect_ex(self, address)


socket.socket.connect = _local_connect
socket.socket.connect_ex = _local_connect_ex


def _in_memory_mail(self, from_addr, to_addrs, msg, mail_options=None, rcpt_options=None):
    """Keep Message.send/MIME assembly; replace only actual SMTP delivery."""
    addresses = [from_addr, *(to_addrs if isinstance(to_addrs, (list, tuple)) else [to_addrs])]
    if not 2 <= len(addresses) <= 10 or any(
        not isinstance(address, str) or not address.endswith("@example.com") or
        len(address) > 254 or any(character in address for character in "\r\n")
        for address in addresses
    ):
        raise RuntimeError("Public pilot mail accepts only synthetic example.com addresses")
    content = msg.as_string()
    if len(content.encode("utf-8")) > 1024 * 1024:
        raise RuntimeError("Public pilot mail exceeds the message budget")
    message = message_from_string(content)
    if not message.get("Subject") or not message.get("From") or not message.get("To"):
        raise RuntimeError("Public pilot mail must contain actual MIME headers")
    response = SMTPResponse(backend="bth-in-memory-public-fixture")
    response.set_status("DATA", 250, "synthetic delivery accepted")
    response._finished = True
    response.from_addr = from_addr
    response.to_addrs = list(addresses[1:])
    return response


SMTPBackend.sendmail = _in_memory_mail


def pytest_sessionstart(session):
    from sqlmodel import Session, SQLModel, text
    from app.core.db import engine
    from app import models  # noqa: F401 -- register the real application's tables

    assert engine.dialect.name == "postgresql"
    assert engine.url.host == "127.0.0.1"
    assert engine.url.port == int(os.environ["BTH_ORACLE_DB_PORT"])
    assert engine.url.database == "bth_oracle"
    with Session(engine) as db:
        version = db.exec(text("SHOW server_version_num")).scalar_one()
        assert 160000 <= int(version) < 170000
    # This is ordinary test provisioning, not proof of Alembic migration safety.
    SQLModel.metadata.create_all(engine)
