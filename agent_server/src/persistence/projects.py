"""Project persistence for machine-scoped Atlas workspaces."""

from __future__ import annotations

import re
import uuid
from typing import Any

from src.persistence.database import get_pool

DEFAULT_PROJECT_ID = uuid.UUID("00000000-0000-4000-8000-000000001650")


def normalize_project_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "machine-project"


async def list_projects() -> list[dict[str, Any]]:
    pool = await get_pool()
    async with pool.connection() as conn:
        rows = await conn.execute(
            """
            SELECT
                project_id,
                machine_id,
                display_name,
                slug,
                status,
                metadata,
                created_at,
                updated_at
            FROM projects
            ORDER BY updated_at DESC, created_at DESC
            """
        )
        results = await rows.fetchall()
    return [_project_row(row) for row in results]


async def get_project(project_id: uuid.UUID) -> dict[str, Any] | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        row = await conn.execute(
            """
            SELECT
                project_id,
                machine_id,
                display_name,
                slug,
                status,
                metadata,
                created_at,
                updated_at
            FROM projects
            WHERE project_id = %s
            """,
            (project_id,),
        )
        result = await row.fetchone()
    return _project_row(result) if result else None


async def get_default_project() -> dict[str, Any]:
    project = await get_project(DEFAULT_PROJECT_ID)
    if project is None:
        pool = await get_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                INSERT INTO projects (project_id, machine_id, display_name, slug, metadata)
                VALUES (
                    %s,
                    'the reference machine-1',
                    'the reference machine',
                    'the reference machine-1',
                    '{"source": "default-project"}'::jsonb
                )
                ON CONFLICT (project_id) DO NOTHING
                """,
                (DEFAULT_PROJECT_ID,),
            )
            await conn.commit()
        project = await get_project(DEFAULT_PROJECT_ID)
    if project is None:
        raise RuntimeError("default Atlas project could not be created")
    return project


async def find_similar_projects(machine_id: str) -> list[dict[str, Any]]:
    """R15/G51 sibling guard: surface near-identical machines BEFORE a blind
    insert — identity comes from human declaration, and 'Machine 7 unit #2'
    reusing a machine id must get a continue-or-sibling choice, not a raw 409."""
    needle = machine_id.strip().lower()
    if not needle:
        return []
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT project_id, machine_id, display_name, slug FROM projects "
            "WHERE lower(machine_id) = %s OR lower(machine_id) LIKE %s OR %s LIKE lower(machine_id) || '%%'",
            (needle, needle + "%", needle))
        rows = await cur.fetchall()
    return [{"project_id": str(r[0]), "machine_id": r[1], "display_name": r[2], "slug": r[3]}
            for r in rows]


async def create_project(
    *,
    machine_id: str,
    display_name: str | None = None,
    metadata: dict[str, Any] | None = None,
    manufacturer: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    machine = machine_id.strip()
    if not machine:
        raise ValueError("machine_id is required")
    name = (display_name or machine).strip()
    slug = normalize_project_slug(machine)
    pool = await get_pool()
    async with pool.connection() as conn:
        family_id = None
        if manufacturer and model:
            cur = await conn.execute(
                "INSERT INTO machine_families (manufacturer, model) VALUES (%s, %s) "
                "ON CONFLICT (manufacturer, model) DO UPDATE SET model = EXCLUDED.model "
                "RETURNING family_id",
                (manufacturer.strip(), model.strip()))
            family_id = (await cur.fetchone())[0]
        row = await conn.execute(
            """
            INSERT INTO projects (machine_id, display_name, slug, metadata, family_id)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING
                project_id,
                machine_id,
                display_name,
                slug,
                status,
                metadata,
                created_at,
                updated_at
            """,
            (machine, name, slug, metadata or {}, family_id),
        )
        result = await row.fetchone()
        await conn.commit()
    return _project_row(result)


def _project_row(row: Any) -> dict[str, Any]:
    return {
        "project_id": str(row[0]),
        "machine_id": row[1],
        "display_name": row[2],
        "slug": row[3],
        "status": row[4],
        "metadata": row[5] or {},
        "created_at": row[6].isoformat() if row[6] else None,
        "updated_at": row[7].isoformat() if row[7] else None,
    }
