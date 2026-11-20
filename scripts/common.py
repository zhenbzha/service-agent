"""Shared helpers for the scripts: azd environment and credentials."""

import json
import os
import subprocess
from pathlib import Path

from azure.identity import AzureDeveloperCliCredential
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]


class ConfigError(Exception):
    """Local setup is not as expected."""


def load_azd_env() -> None:
    """Load the default azd environment's .env file into os.environ.

    Same approach as Azure-Samples/aisearch-openai-rag-audio (app/backend/setup_intvect.py).
    """
    try:
        result = subprocess.run(
            ["azd", "env", "list", "-o", "json"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise ConfigError("Could not read the azd environment. Run 'azd provision' first.") from error
    default_env = next((env for env in json.loads(result.stdout) if env.get("IsDefault")), None)
    if not default_env:
        raise ConfigError("No default azd environment. Run 'azd env select <name>'.")
    load_dotenv(default_env["DotEnvPath"], override=True)


def require_env(name: str) -> str:
    """Return a non-empty environment variable, or raise ConfigError."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"{name} is not set in the azd environment.")
    return value


def azd_credential() -> AzureDeveloperCliCredential:
    """Sign in as the azd user, in the tenant the environment was provisioned to."""
    return AzureDeveloperCliCredential(tenant_id=require_env("AZURE_TENANT_ID"), process_timeout=60)
