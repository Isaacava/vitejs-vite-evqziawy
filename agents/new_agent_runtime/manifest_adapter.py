from __future__ import annotations

import importlib
from typing import Any

import runtime.service as service


_original_manifest = service._manifest


def _schema() -> dict[str, Any] | None:
    try:
        implementation = importlib.import_module(service.IMPL)
    except Exception:
        return None
    value = getattr(implementation, "CAPABILITY_SCHEMA", None)
    return value if isinstance(value, dict) else None


def _manifest(base: str) -> dict[str, Any]:
    manifest = _original_manifest(base)
    schema = _schema()
    if not schema:
        return manifest

    capabilities = manifest.get("capabilities")
    if isinstance(capabilities, list):
        updated = []
        for capability in capabilities:
            if isinstance(capability, dict):
                item = dict(capability)
                metadata = dict(item.get("metadata") or {}) if isinstance(item.get("metadata"), dict) else {}
                metadata["input_schema"] = schema
                item["metadata"] = metadata
                updated.append(item)
            else:
                updated.append(capability)
        manifest["capabilities"] = updated

    metadata = dict(manifest.get("metadata") or {}) if isinstance(manifest.get("metadata"), dict) else {}
    metadata["capability_schema"] = schema
    manifest["metadata"] = metadata
    manifest["capability_schema"] = schema
    return manifest


service._manifest = _manifest
app = service.app
