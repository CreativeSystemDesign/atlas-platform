"""Proxy OpenRouter /models for the dashboard (no API key in browser)."""

from __future__ import annotations

import time

import httpx
from fastapi import APIRouter, HTTPException, Request

from src.config import settings

router = APIRouter(tags=["Integrations"])

_OR_MODELS_CACHE: dict[str, tuple[float, dict]] = {}
_OR_ENDPOINTS_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_TTL_SEC = 600.0


@router.get("/integrations/openrouter/models")
async def list_openrouter_models(request: Request):
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY is not configured")

    cache_key = request.url.query or ""
    now = time.monotonic()
    hit = _OR_MODELS_CACHE.get(cache_key)
    if hit and (now - hit[0]) < _CACHE_TTL_SEC:
        return hit[1]

    url = "https://openrouter.ai/api/v1/models"
    q = request.url.query
    if q:
        url = f"{url}?{q}"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.get(
                url,
                headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"OpenRouter request failed: {e}") from e

    if res.status_code >= 400:
        raise HTTPException(status_code=res.status_code, detail=res.text[:2000])

    try:
        data = res.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Invalid JSON from OpenRouter: {e}") from e

    _OR_MODELS_CACHE[cache_key] = (now, data)
    return data


@router.get("/integrations/openrouter/models/{author}/{slug}/endpoints")
async def list_openrouter_model_endpoints(author: str, slug: str):
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY is not configured")

    cache_key = f"{author}/{slug}"
    now = time.monotonic()
    hit = _OR_ENDPOINTS_CACHE.get(cache_key)
    if hit and (now - hit[0]) < _CACHE_TTL_SEC:
        return hit[1]

    url = f"https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.get(
                url,
                headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"OpenRouter request failed: {e}") from e

    if res.status_code >= 400:
        raise HTTPException(status_code=res.status_code, detail=res.text[:2000])

    try:
        data = res.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Invalid JSON from OpenRouter: {e}") from e

    _OR_ENDPOINTS_CACHE[cache_key] = (now, data)
    return data
