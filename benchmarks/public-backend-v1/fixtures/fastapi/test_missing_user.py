import uuid


def test_superuser_missing_user_is_404(client, headers):
    response = client.get("/api/v1/users/" + str(uuid.uuid4()), headers=headers["admin"])
    assert response.status_code == 404
    assert response.json() == {"detail": "User not found"}


def test_superuser_existing_user_is_readable(client, accounts, headers):
    response = client.get("/api/v1/users/" + accounts["alice"]["id"], headers=headers["admin"])
    assert response.status_code == 200
    assert response.json()["id"] == accounts["alice"]["id"]
    assert response.json()["email"] == accounts["alice"]["email"]
    assert "hashed_password" not in response.json()


def test_ordinary_user_can_read_self(client, accounts, headers):
    response = client.get("/api/v1/users/" + accounts["alice"]["id"], headers=headers["alice"])
    assert response.status_code == 200
    assert response.json()["id"] == accounts["alice"]["id"]


def test_ordinary_user_cannot_read_another_user(client, accounts, headers):
    response = client.get("/api/v1/users/" + accounts["bob"]["id"], headers=headers["alice"])
    assert response.status_code == 403
    assert response.json() == {"detail": "The user doesn't have enough privileges"}


def test_ordinary_user_missing_id_still_returns_403(client, headers):
    response = client.get("/api/v1/users/" + str(uuid.uuid4()), headers=headers["alice"])
    assert response.status_code == 403
    assert response.json() == {"detail": "The user doesn't have enough privileges"}


def test_missing_id_without_authentication_is_not_public(client, accounts):
    response = client.get("/api/v1/users/" + str(uuid.uuid4()))
    assert response.status_code in (401, 403)


def test_invalid_id_preserves_validation(client, headers):
    response = client.get("/api/v1/users/not-a-uuid", headers=headers["admin"])
    assert response.status_code == 422
