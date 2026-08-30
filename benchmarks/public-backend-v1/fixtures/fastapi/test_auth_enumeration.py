import uuid

from app import crud
from app.core import security
from app.models import User
from app.utils import generate_password_reset_token

PASSWORD = "Public-fixture-password-123"


def test_unknown_login_executes_real_password_verification(client, accounts, monkeypatch):
    original = crud.verify_password
    calls = []

    def observed(password, hashed):
        calls.append((password, hashed))
        return original(password, hashed)

    monkeypatch.setattr(crud, "verify_password", observed)
    response = client.post("/api/v1/login/access-token", data={"username": "absent@example.com", "password": PASSWORD})
    assert len(calls) == 1
    assert calls[0][0] == PASSWORD
    assert isinstance(calls[0][1], str) and calls[0][1]
    assert response.status_code == 400
    assert response.json() == {"detail": "Incorrect email or password"}


def test_known_wrong_password_retains_same_login_response(client, accounts):
    response = client.post("/api/v1/login/access-token", data={"username": accounts["alice"]["email"], "password": "wrong-password"})
    assert response.status_code == 400
    assert response.json() == {"detail": "Incorrect email or password"}


def test_known_correct_password_still_returns_usable_token(client, accounts):
    response = client.post("/api/v1/login/access-token", data={"username": accounts["alice"]["email"], "password": PASSWORD})
    assert response.status_code == 200
    token = response.json()["access_token"]
    current = client.get("/api/v1/users/me", headers={"Authorization": "Bearer " + token})
    assert current.status_code == 200
    assert current.json()["id"] == accounts["alice"]["id"]


def test_recovery_response_does_not_reveal_registration(client, accounts, mail):
    known = client.post("/api/v1/password-recovery/" + accounts["alice"]["email"])
    unknown = client.post("/api/v1/password-recovery/absent@example.com")
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
    assert "message" in known.json()
    assert len(mail) == 1
    assert mail[0]["email_to"] == accounts["alice"]["email"]


def test_unknown_recovery_never_sends_mail(client, accounts, mail):
    response = client.post("/api/v1/password-recovery/absent@example.com")
    assert response.status_code == 200
    assert mail == []


def test_reset_token_for_absent_user_matches_invalid_token(client, accounts):
    absent = generate_password_reset_token(email="absent@example.com")
    missing = client.post("/api/v1/reset-password/", json={"token": absent, "new_password": "Another-test-password"})
    invalid = client.post("/api/v1/reset-password/", json={"token": "invalid-test-token", "new_password": "Another-test-password"})
    assert missing.status_code == invalid.status_code == 400
    assert missing.json() == invalid.json() == {"detail": "Invalid token"}


def test_reset_existing_user_changes_password_and_preserves_login(client, accounts):
    token = generate_password_reset_token(email=accounts["alice"]["email"])
    changed = client.post("/api/v1/reset-password/", json={"token": token, "new_password": "Another-test-password"})
    assert changed.status_code == 200
    old = client.post("/api/v1/login/access-token", data={"username": accounts["alice"]["email"], "password": PASSWORD})
    new = client.post("/api/v1/login/access-token", data={"username": accounts["alice"]["email"], "password": "Another-test-password"})
    assert old.status_code == 400
    assert new.status_code == 200


def test_inactive_user_login_remains_denied(client, accounts, db):
    user = db.get(User, uuid.UUID(accounts["alice"]["id"]))
    user.is_active = False
    db.add(user)
    db.commit()
    response = client.post("/api/v1/login/access-token", data={"username": user.email, "password": PASSWORD})
    assert response.status_code == 400
    assert response.json() == {"detail": "Inactive user"}


def test_inactive_user_reset_does_not_change_password(client, accounts, db):
    user = db.get(User, uuid.UUID(accounts["alice"]["id"]))
    user.is_active = False
    db.add(user)
    db.commit()
    original_hash = user.hashed_password
    token = generate_password_reset_token(email=user.email)
    response = client.post("/api/v1/reset-password/", json={"token": token, "new_password": "Another-test-password"})
    assert response.status_code == 400
    assert response.json() == {"detail": "Inactive user"}
    db.refresh(user)
    assert user.hashed_password == original_hash
    verified, _ = security.verify_password(PASSWORD, user.hashed_password)
    assert verified is True
