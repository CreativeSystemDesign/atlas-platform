from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Mapping

from src.config import settings

JsonObject = dict[str, object]

DEFAULT_HOSTS_BY_LANE = {
    "live": "atlas-platform.cloud",
    "preview": "preview.atlas-platform.cloud",
    "dev": "dev.atlas-platform.cloud",
}
DEFAULT_DASHBOARD_URLS_BY_LANE = {
    "live": "http://127.0.0.1:3002/codex",
    "preview": "http://127.0.0.1:3010/codex",
    "dev": "http://127.0.0.1:3003/codex",
}
DEFAULT_FRONTEND_SERVICES_BY_LANE = {
    "live": "atlas-dashboard-prod.service",
    "preview": "atlas-codex-preview-dashboard.service",
    "dev": "atlas-dev-dashboard.service",
}
DEFAULT_BACKEND_SERVICES_BY_LANE = {
    "live": "atlas-server.service",
    "preview": "atlas-codex-preview-server.service",
    "dev": "atlas-dev-server.service",
}


def codex_environment_payload(headers: Mapping[str, str] | None = None) -> JsonObject:
    lane = codex_lane()
    repo_root = Path(settings.atlas_root).resolve()
    expected_host = codex_public_host(lane)
    request_host = _request_host(headers or {})
    host_matches_lane = _host_matches_lane(request_host, expected_host)
    dashboard_url = codex_dashboard_url(lane)
    drafts_root = codex_interface_drafts_root(repo_root)
    interface_mutation_enabled = bool(settings.codex_interface_mutation_enabled)

    return {
        "lane": lane,
        "repoRoot": repo_root.as_posix(),
        "branch": _git_branch(repo_root),
        "expectedHost": expected_host,
        "requestHost": request_host,
        "hostMatchesLane": host_matches_lane,
        "dashboardUrl": dashboard_url,
        "draftsRoot": drafts_root.as_posix(),
        "frontendRestartService": codex_frontend_restart_service(lane),
        "backendRestartService": codex_backend_restart_service(lane),
        "interfaceMutationEnabled": interface_mutation_enabled,
        "interfaceMutationSafe": interface_mutation_enabled and host_matches_lane,
    }


def codex_lane() -> str:
    lane = (settings.codex_lane or "live").strip().lower()
    return lane or "live"


def codex_public_host(lane: str | None = None) -> str:
    configured = settings.codex_public_host.strip()
    if configured:
        return _strip_port(configured).lower()
    return DEFAULT_HOSTS_BY_LANE.get(lane or codex_lane(), "")


def codex_dashboard_url(lane: str | None = None) -> str:
    configured = settings.codex_dashboard_url.strip()
    if configured:
        return configured
    return DEFAULT_DASHBOARD_URLS_BY_LANE.get(lane or codex_lane(), "")


def codex_interface_drafts_root(repo_root: Path | None = None) -> Path:
    configured = settings.codex_interface_drafts_root.strip()
    if configured:
        return Path(configured).resolve()
    root = repo_root or Path(settings.atlas_root).resolve()
    return root.parent / ".codex-interface-drafts"


def codex_frontend_restart_service(lane: str | None = None) -> str:
    configured = settings.codex_frontend_restart_service.strip()
    if configured:
        return configured
    return DEFAULT_FRONTEND_SERVICES_BY_LANE.get(lane or codex_lane(), "")


def codex_backend_restart_service(lane: str | None = None) -> str:
    configured = settings.codex_backend_restart_service.strip()
    if configured:
        return configured
    return DEFAULT_BACKEND_SERVICES_BY_LANE.get(lane or codex_lane(), "")


def _request_host(headers: Mapping[str, str]) -> str:
    candidates = [
        headers.get("host", ""),
        _url_host(headers.get("origin", "")),
        _url_host(headers.get("referer", "")),
    ]
    for candidate in candidates:
        host = _strip_port(candidate).lower()
        if host:
            return host
    return ""


def _host_matches_lane(request_host: str, expected_host: str) -> bool:
    if not request_host:
        return True
    if not expected_host:
        return True
    return request_host == expected_host


def _strip_port(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if value.startswith("["):
        return value.split("]", 1)[0].lstrip("[")
    return value.split(":", 1)[0]


def _url_host(value: str) -> str:
    if "://" not in value:
        return value
    return value.split("://", 1)[1].split("/", 1)[0]


def _git_branch(repo_root: Path) -> str | None:
    try:
        process = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=repo_root,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        )
    except Exception:
        return None
    branch = process.stdout.strip()
    return branch or None
