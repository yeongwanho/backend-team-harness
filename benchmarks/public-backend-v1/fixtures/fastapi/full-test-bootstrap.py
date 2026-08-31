"""Explicit public-pilot pytest plugin; keeps the repository's original tests."""
import os
import socket

from pydantic_settings import BaseSettings

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
