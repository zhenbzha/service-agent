"""Shared helpers for the agent scripts: azd environment, credentials and agent definitions."""

import json
import os
import subprocess
from pathlib import Path

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    AgentDetails,
    LiveInitialSessionAudioOutputParam,
    LiveInitialSessionAudioParam,
    LiveSessionAudioFormatPCMParam,
    MCPTool,
    PromptAgentDefinition,
    PromptAgentDefinitionTextOptions,
    TextResponseFormatText,
    VoiceAgentLiveDefinition,
    VoiceAgentLiveManagedAgentDelegation,
    VoiceAgentTemplateGreetingConfig,
    VoiceModelType,
)
from azure.identity import AzureDeveloperCliCredential
from azure.identity.aio import AzureDeveloperCliCredential as AsyncAzureDeveloperCliCredential
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
AGENTS_DIR = REPO_ROOT / "agents"

SPECIALIST_NAME = "billing-specialist"
VOICE_AGENT_NAME = "voice-agent"

AUDIO_SAMPLE_RATE = 24000
VOICE_NAME = "marin"

END_CONVERSATION_TOOL = {
    "name": "end_conversation",
    "description": (
        "End the conversation when the customer says goodbye or confirms they "
        "need nothing else. Say a brief, friendly farewell first."
    ),
}


class ConfigError(Exception):
    """Local setup or a deployed agent is not as expected."""


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


def azd_credential_async() -> AsyncAzureDeveloperCliCredential:
    """Async version of azd_credential(), for the GPT-Live WebSocket client."""
    return AsyncAzureDeveloperCliCredential(tenant_id=require_env("AZURE_TENANT_ID"), process_timeout=60)


def delegated_specialist_version(voice_agent: AgentDetails) -> str:
    """The specialist version that the latest voice-agent version delegates to."""
    return str(voice_agent.versions.latest.definition["delegation"]["agent_version"])


def pinned_specialist_version(project: AIProjectClient) -> str:
    """The specialist version that callers actually reach through the voice agent."""
    return delegated_specialist_version(project.agents.get(VOICE_AGENT_NAME))


def read_agent_file(agent_name: str, file_name: str) -> str:
    return (AGENTS_DIR / agent_name / file_name).read_text(encoding="utf-8").strip()


def knowledge_base_tool(mcp_endpoint: str, connection_name: str) -> MCPTool:
    """MCP tool for the handbook knowledge base, as in Learn "Connect agents to Foundry IQ knowledge bases".

    knowledge_base_retrieve is the only tool Agent Service supports on that endpoint. Foundry-managed
    delegation fails on MCP calls that need approval, so approval is never required.
    """
    return MCPTool(
        server_label="knowledge-base",
        server_url=mcp_endpoint,
        require_approval="never",
        allowed_tools=["knowledge_base_retrieve"],
        project_connection_id=connection_name,
    )


def specialist_definition(model: str, handbook_tool: MCPTool) -> PromptAgentDefinition:
    """Billing specialist prompt agent: customer records in its instructions, rules from the handbook tool."""
    account_data = json.loads(read_agent_file(SPECIALIST_NAME, "data.json"))
    instructions = (
        read_agent_file(SPECIALIST_NAME, "instructions.md")
        + "\n\nData\nSynthetic customer account records (JSON):\n"
        + json.dumps(account_data, ensure_ascii=False, separators=(",", ":"))
    )
    return PromptAgentDefinition(
        model=model,
        instructions=instructions,
        tools=[handbook_tool],
        # Foundry-managed delegation rejects JSON output formats; answers must be plain text.
        text=PromptAgentDefinitionTextOptions(format=TextResponseFormatText()),
    )


def voice_agent_definition(model: str, specialist_version: str) -> VoiceAgentLiveDefinition:
    """GPT-Live voice agent that delegates billing work to a pinned specialist version."""
    definition = VoiceAgentLiveDefinition(
        model=model,
        model_type=VoiceModelType.SELF_DEPLOYED,
        instructions=read_agent_file(VOICE_AGENT_NAME, "instructions.md"),
        greeting=VoiceAgentTemplateGreetingConfig(text=read_agent_file(VOICE_AGENT_NAME, "greeting.txt")),
        audio=LiveInitialSessionAudioParam(
            format=LiveSessionAudioFormatPCMParam(rate=AUDIO_SAMPLE_RATE),
            output=LiveInitialSessionAudioOutputParam(voice=VOICE_NAME),
        ),
        delegation=VoiceAgentLiveManagedAgentDelegation(agent_name=SPECIALIST_NAME, agent_version=specialist_version),
        store=True,
    )
    # system_tools is a documented GPT-Live field (Learn: "Let the agent end the conversation")
    # that azure-ai-projects 2.11.0 does not model yet. SDK models are mutable mappings, which
    # the SDK samples also use to set fields the models do not expose.
    definition["system_tools"] = [END_CONVERSATION_TOOL]
    return definition
