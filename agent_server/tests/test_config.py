import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import Settings


def test_database_url_is_supported_as_standard_alias(monkeypatch):
    monkeypatch.delenv("DATABASE_URI", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://example-from-database-url")

    settings = Settings(_env_file=None)

    assert settings.database_uri == "postgresql://example-from-database-url"


def test_database_uri_takes_precedence_over_database_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URI", "postgresql://example-from-database-uri")
    monkeypatch.setenv("DATABASE_URL", "postgresql://example-from-database-url")

    settings = Settings(_env_file=None)

    assert settings.database_uri == "postgresql://example-from-database-uri"
