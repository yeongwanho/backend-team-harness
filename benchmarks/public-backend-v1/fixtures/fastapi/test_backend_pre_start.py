# Evaluation-only repair of the pinned upstream test, not a production change.
from unittest.mock import MagicMock, patch

from app.backend_pre_start import init, logger


def test_init_successful_connection() -> None:
    engine_mock = MagicMock()
    session_mock = MagicMock()
    session_mock.exec.return_value = True
    with (
        patch("app.backend_pre_start.Session") as session_factory,
        patch.object(logger, "info"),
        patch.object(logger, "error"),
        patch.object(logger, "warn"),
    ):
        session_factory.return_value.__enter__.return_value = session_mock
        init(engine_mock)
        session_factory.assert_called_once_with(engine_mock)
        session_mock.exec.assert_called_once()
        assert len(session_mock.exec.call_args.args) == 1
        assert str(session_mock.exec.call_args.args[0]) == "SELECT 1"
        session_factory.return_value.__exit__.assert_called_once_with(None, None, None)
