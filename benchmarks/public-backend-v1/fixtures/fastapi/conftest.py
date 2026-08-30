"""Real HTTP/JWT/SQLModel/PostgreSQL; only mail and dotenv loading are isolated."""
import os
import socket
from datetime import timedelta

import pytest
from pydantic_settings import BaseSettings

_original_settings_init = BaseSettings.__init__


def _settings_without_dotenv(self, *args, **kwargs):
    kwargs["_env_file"] = None
    _original_settings_init(self, *args, **kwargs)


# This is evaluator isolation, not an alternative application configuration.
BaseSettings.__init__ = _settings_without_dotenv
_connect = socket.socket.connect
_connect_ex = socket.socket.connect_ex


def _assert_local(address):
    if not isinstance(address, tuple) or address[0] != "127.0.0.1" or address[1] != int(os.environ["BTH_ORACLE_DB_PORT"]):
        raise RuntimeError("Evaluator forbids non-oracle socket connections")


def _local_connect(self, address):
    _assert_local(address)
    return _connect(self, address)


def _local_connect_ex(self, address):
    _assert_local(address)
    return _connect_ex(self, address)


socket.socket.connect = _local_connect
socket.socket.connect_ex = _local_connect_ex

from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session, SQLModel, delete, text  # noqa: E402

from app.core import security  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Item, User  # noqa: E402

PASSWORD = "Public-fixture-password-123"


@pytest.fixture(scope="session", autouse=True)
def database(record_testsuite_property):
    assert engine.dialect.name == "postgresql"
    assert engine.url.host == "127.0.0.1"
    assert engine.url.port == int(os.environ["BTH_ORACLE_DB_PORT"])
    assert engine.url.database == "bth_oracle"
    with Session(engine) as session:
        version = session.exec(text("SHOW server_version_num")).scalar_one()
        assert 160000 <= int(version) < 170000
        record_testsuite_property("database", "PostgreSQL " + version)
    SQLModel.metadata.create_all(engine)
    yield
    SQLModel.metadata.drop_all(engine)
    engine.dispose()
    BaseSettings.__init__ = _original_settings_init
    socket.socket.connect = _connect
    socket.socket.connect_ex = _connect_ex


@pytest.fixture
def db(database):
    with Session(engine) as session:
        session.exec(delete(Item))
        session.exec(delete(User))
        session.commit()
        yield session
        session.rollback()


@pytest.fixture(scope="session")
def password_hash():
    return security.get_password_hash(PASSWORD)


@pytest.fixture
def accounts(db, password_hash):
    values = {}
    for name, superuser in [("admin", True), ("alice", False), ("bob", False)]:
        user = User(email=name + "@example.com", full_name=name, is_superuser=superuser, hashed_password=password_hash)
        db.add(user)
        db.commit()
        db.refresh(user)
        values[name] = {"id": str(user.id), "email": user.email}
    return values


@pytest.fixture
def client():
    # HTTP exceptions/response validation must be visible as HTTP responses,
    # not confused with environment setup errors in the oracle.
    with TestClient(app, raise_server_exceptions=False) as value:
        yield value


@pytest.fixture
def headers(accounts):
    return {name: {"Authorization": "Bearer " + security.create_access_token(value["id"], expires_delta=timedelta(minutes=5))}
            for name, value in accounts.items()}


@pytest.fixture
def mail(monkeypatch):
    from app.api.routes import login
    sent = []
    monkeypatch.setattr(login, "send_email", lambda **message: sent.append(message))
    return sent
