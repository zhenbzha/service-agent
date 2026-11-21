"""Create or update the billing specialist and the GPT-Live voice agent in Foundry.

A new agent version is created only when its definition changes, so the script is safe to
re-run. The voice agent is pinned to the specialist version it was created with, as in the
Learn "Use Foundry-managed agent delegation" example.

Usage: uv run scripts/deploy_agents.py
"""

import hashlib
import json
import sys

from azure.ai.projects import AIProjectClient
from azure.core.exceptions import HttpResponseError, ResourceNotFoundError

from common import (
    END_CONVERSATION_TOOL,
    SPECIALIST_NAME,
    VOICE_AGENT_NAME,
    ConfigError,
    azd_credential,
    knowledge_base_tool,
    load_azd_env,
    require_env,
    specialist_definition,
    voice_agent_definition,
)

# Agent metadata key holding a hash of the definition that created the version.
DEFINITION_HASH_KEY = "definition_sha256"


def definition_hash(definition) -> str:
    payload = json.dumps(definition.as_dict(), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def latest_version(project: AIProjectClient, agent_name: str):
    """Return the agent's latest version, or None if the agent doesn't exist yet."""
    try:
        return project.agents.get(agent_name).versions.latest
    except ResourceNotFoundError:
        return None


def create_version_if_changed(project: AIProjectClient, agent_name: str, definition, description: str):
    """Create a new agent version unless the latest one was created from the same definition."""
    new_hash = definition_hash(definition)
    latest = latest_version(project, agent_name)
    if latest is not None and (latest.metadata or {}).get(DEFINITION_HASH_KEY) == new_hash:
        print(f"Unchanged: {agent_name}:{latest.version}")
        return latest
    created = project.agents.create_version(
        agent_name, definition=definition, description=description, metadata={DEFINITION_HASH_KEY: new_hash}
    )
    print(f"Created:   {agent_name}:{created.version}")
    return created


def check_deployments_exist(project: AIProjectClient, *deployment_names: str) -> None:
    for name in deployment_names:
        try:
            project.deployments.get(name)
        except ResourceNotFoundError as error:
            raise ConfigError(f"Model deployment '{name}' was not found. Run 'azd provision'.") from error


def check_saved_voice_agent(project: AIProjectClient, voice_version: str, specialist_version: str) -> None:
    """Read the saved voice agent back and confirm the service kept its delegation and system tool."""
    saved = project.agents.get_version(VOICE_AGENT_NAME, voice_version).definition
    delegation = saved.get("delegation") or {}
    expected_delegation = {
        "type": "foundry_managed_agent",
        "agent_name": SPECIALIST_NAME,
        "agent_version": specialist_version,
    }
    if any(delegation.get(key) != value for key, value in expected_delegation.items()):
        raise ConfigError(f"Saved voice agent has unexpected delegation: {dict(delegation)}")
    saved_tool_names = [tool.get("name") for tool in saved.get("system_tools") or []]
    if saved_tool_names != [END_CONVERSATION_TOOL["name"]]:
        raise ConfigError(f"Saved voice agent has unexpected system_tools: {saved_tool_names}")


def main() -> None:
    load_azd_env()
    endpoint = require_env("FOUNDRY_PROJECT_ENDPOINT")
    voice_model = require_env("GPT_LIVE_DEPLOYMENT")
    specialist_model = require_env("RESPONSES_DEPLOYMENT")
    handbook_tool = knowledge_base_tool(
        require_env("KNOWLEDGE_BASE_MCP_ENDPOINT"), require_env("KNOWLEDGE_BASE_CONNECTION_NAME")
    )

    # allow_preview sends the VoiceAgents=V1Preview feature header that voice agents require.
    with (
        azd_credential() as credential,
        AIProjectClient(endpoint=endpoint, credential=credential, allow_preview=True) as project,
    ):
        check_deployments_exist(project, voice_model, specialist_model)
        specialist = create_version_if_changed(
            project,
            SPECIALIST_NAME,
            specialist_definition(specialist_model, handbook_tool),
            "Zava Energy billing specialist with synthetic customer records and the billing handbook.",
        )
        specialist_version = str(specialist.version)
        voice_agent = create_version_if_changed(
            project,
            VOICE_AGENT_NAME,
            voice_agent_definition(voice_model, specialist_version),
            "Zava Energy GPT-Live voice agent that delegates billing questions.",
        )
        check_saved_voice_agent(project, str(voice_agent.version), specialist_version)

    print(
        f"\nReady: {VOICE_AGENT_NAME}:{voice_agent.version} -> {SPECIALIST_NAME}:{specialist_version}"
        "\nTest it in the Foundry portal: Build > Agents > voice-agent > Open in playground."
    )


if __name__ == "__main__":
    try:
        main()
    except ConfigError as error:
        sys.exit(f"Error: {error}")
    except HttpResponseError as error:
        sys.exit(f"Foundry request failed (HTTP {error.status_code}): {error.message}")
