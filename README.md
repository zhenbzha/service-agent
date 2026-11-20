# Zava Energy voice service agent

A voice customer-service agent for the fictional energy company Zava Energy, built on Microsoft Foundry.

- `voice-agent` is a GPT-Live voice agent. It talks with the customer in real time.
- `billing-specialist` is a prompt agent. The voice agent hands billing questions to it through Foundry-managed agent delegation.
- Phase 1 uses synthetic, hard-coded customer data (`agents/billing-specialist/data.json`).
- The billing handbook in `knowledge/` is indexed in Azure AI Search as a Foundry IQ knowledge base. The specialist searches it through the knowledge base's MCP tool.

## Repository layout

- `agents/` - instructions, greeting and data for each agent
- `knowledge/` - simulated internal billing handbook (PDF) that human advisors use; synced to the knowledge base by `scripts/sync_knowledge.py`
- `infra/` - Bicep with Azure Verified Modules, deployed with azd
- `scripts/` - deployment, knowledge sync and test scripts, run with uv
- `pyproject.toml`, `uv.lock`, `.python-version` - the Python project managed by uv

## Prerequisites

- An Azure subscription with GPT-Live quota in France Central
- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [uv](https://docs.astral.sh/uv/getting-started/installation/)

Python packages come from the Microsoft PyPI proxy, set as the default index in `pyproject.toml`. Outside the Microsoft network, remove the `[[tool.uv.index]]` entry and run `uv lock`.

## Deploy

```powershell
azd auth login
azd env new voice-agent
azd env set AZURE_LOCATION francecentral
azd provision
uv sync
uv run scripts/sync_knowledge.py
uv run scripts/deploy_agents.py
```

`deploy_agents.py` reads the outputs of the default azd environment. It creates a new agent version only when an agent's definition changes, so it is safe to re-run. Sync the knowledge base first, because the specialist searches it.

The billing specialist model must be listed in the model support table of [Foundry Agent Service quotas and limits](https://learn.microsoft.com/azure/ai-foundry/agents/concepts/limits-quotas-regions). Set it with the `responsesModel` parameter in `infra/main.bicep`.

## Sync the knowledge base

```powershell
uv run scripts/sync_knowledge.py
```

The script reads every PDF in `knowledge/`, embeds each page with the `text-embedding-3-large` deployment and pushes the pages to the `zava-energy-knowledge` index. Pages that no longer exist are removed. It then creates or updates the `zava-energy-knowledge-source` knowledge source and the `zava-energy-knowledge-base` knowledge base (minimal reasoning, extractive output), and asks one test question. Change the question with `--question "..."`.

Re-run it whenever a PDF in `knowledge/` changes. No storage account is involved.

## Test

- `uv run scripts/test_specialist.py` tests the specialist on its own and checks each answer against the tagged-text format that delegation requires. It exits with code 1 on any format problem.
- `uv run scripts/test_voice.py` runs a full voice session with typed customer turns, so no microphone is needed.
- Both scripts take `--scenario NAME`. The scenarios are in `scripts/scenarios.py`.

## Talk to the agent

To talk to the agent with a microphone, use the official Python sample `response_delegation.py` from [microsoft/voice-agent](https://github.com/microsoft/voice-agent/tree/main/samples/gpt_live/python). With `AGENT_NAME` set, it reuses an existing GPT-Live agent without changing it.

```powershell
git clone https://github.com/microsoft/voice-agent.git
cd voice-agent
uv venv samples\gpt_live\python\.venv
uv pip install --python samples\gpt_live\python\.venv\Scripts\python.exe -r samples\gpt_live\python\requirements.txt --default-index https://packagefeedproxy.microsoft.io/pypi/simple
Copy-Item samples\gpt_live\.env.example samples\gpt_live\.env
```

In `samples\gpt_live\.env`, set `FOUNDRY_PROJECT_ENDPOINT` to the value from `azd env get-value FOUNDRY_PROJECT_ENDPOINT`, and set `AGENT_NAME=voice-agent`. The sample signs in with `az login`. Then run it, wait for **Ready**, speak with a headset, and press **Ctrl+C** to stop:

```powershell
az login
samples\gpt_live\python\.venv\Scripts\python.exe samples\gpt_live\python\response_delegation.py
```

Demo customers (customer number, postcode):

- 100245, 00150 - high bill caused by an estimated meter reading
- 100318, 02100 - October bill paid twice
- 100472, 33100 - bill increase from spot price and higher usage
- 100533, 90100 - payment extension
