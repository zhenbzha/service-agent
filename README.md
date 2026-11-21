# Zava Energy voice service agent

A voice customer-service agent for the fictional energy company Zava Energy, built on Microsoft Foundry.

- `voice-agent` is a GPT-Live voice agent. It talks with the customer in real time.
- `billing-specialist` is a prompt agent. The voice agent hands billing questions to it through Foundry-managed agent delegation.
- Phase 1 uses synthetic, hard-coded customer data (`agents/billing-specialist/data.json`).
- The billing handbook in `knowledge/` is indexed in Azure AI Search as a Foundry IQ knowledge base. The specialist searches it through the knowledge base's MCP tool.

## Repository layout

- `agents/` - instructions, greeting and data for each agent
- `knowledge/` - simulated internal billing handbook (PDF, printed from the HTML next to it) that advisors and the virtual assistant use; synced to the knowledge base by `scripts/sync_knowledge.py`
- `evals/` - evaluation cases for the billing specialist
- `web/` - the web app for talking to the voice agent (Next.js), deployed to Azure Container Apps
- `infra/` - Bicep with Azure Verified Modules, deployed with azd (`azure.yaml`)
- `scripts/` - deployment, knowledge sync, test and evaluation scripts, run with uv
- `tests/` - pytest unit tests for the script logic
- `pyproject.toml`, `uv.lock`, `.python-version` - the Python project managed by uv

## Prerequisites

- An Azure subscription with quota in France Central for GPT-Live, `gpt-5.5` (Data Zone Standard) and `text-embedding-3-large` (Data Zone Standard). The amounts are in `infra/main.bicep`.
- The Entra role Cloud Application Administrator or Application Administrator, because provisioning grants tenant-wide admin consent for the web app
- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- [pnpm](https://pnpm.io/installation), for the web app

Python packages come from the Microsoft PyPI proxy, set as the default index in `pyproject.toml`. Outside the Microsoft network, remove the `[[tool.uv.index]]` entry and run `uv lock`.

The web app's npm packages come from the Microsoft npm proxy, declared in `web/pnpm-workspace.yaml`. The container image build uses it too, because `pnpm-lock.yaml` pins the proxy's tarball URLs and pnpm rejects a lockfile whose URLs don't match the registry. To install from another registry, change that entry and create a new lockfile.

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

`azd provision` also creates the web app's hosting and its Entra app registration. Deploy the app itself as described in [Web app](#web-app).

The billing specialist model must be listed in the model support table of [Foundry Agent Service quotas and limits](https://learn.microsoft.com/azure/foundry/agents/concepts/limits-quotas-regions). Set it with the `responsesModel` parameter in `infra/main.bicep`.

The scripts sign in with your `azd auth login` account.

### Clean up

`azd down` deletes the resource group but not the web app's Entra app registration, which is a tenant-level object. Delete it with the Azure CLI:

```powershell
$clientId = azd env get-value ENTRA_WEB_CLIENT_ID
azd down
az ad app delete --id $clientId
```

## Sync the knowledge base

```powershell
uv run scripts/sync_knowledge.py
```

The script reads every PDF in `knowledge/`, embeds each page with the `text-embedding-3-large` deployment and pushes the pages to the `zava-energy-knowledge` index. Pages that no longer exist are removed. It then creates or updates the `zava-energy-knowledge-source` knowledge source and the `zava-energy-knowledge-base` knowledge base (minimal reasoning, extractive output), and asks one test question. Change the question with `--question "..."`.

Re-run it whenever a PDF in `knowledge/` changes. No storage account is involved.

To change the handbook, edit `knowledge/zava-energy-billing-handbook.html` and print it to PDF with headless Edge, then re-run the sync:

```powershell
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$html = (Resolve-Path knowledge\zava-energy-billing-handbook.html).Path
& $edge --headless --user-data-dir="$env:TEMP\handbook-edge" --no-pdf-header-footer --print-to-pdf="$PWD\knowledge\zava-energy-billing-handbook.pdf" ([uri]$html).AbsoluteUri
```

The specialist has no write tools. In this demo it only says that it applied an action the handbook allows, after the customer agrees; nothing in `data.json` changes.

## Test

- `uv run scripts/test_specialist.py` tests the specialist on its own and checks each answer against the tagged-text format that delegation requires. It runs every scenario and exits with code 1 on any format problem.
- `uv run scripts/test_voice.py` runs a full voice session with typed customer turns, so no microphone is needed. It runs the `high-bill` scenario and exits with code 1 if the specialist doesn't answer.
- Both scripts take `--scenario NAME`. The scenarios are in `scripts/scenarios.py`.
- `uv run pytest` runs the unit tests in `tests/`, which need no Azure resources. Lint and format with `uv run ruff check` and `uv run ruff format`.

## Evaluate the specialist

```powershell
uv run scripts/evaluate_specialist.py
```

The script runs a Foundry cloud evaluation of the specialist version that the voice agent uses. It sends each case in `evals/billing-specialist.jsonl` to the specialist and judges the answers with:

- `builtin.response_completeness` (preview) - covers the key points of the case's `ground_truth`
- `builtin.groundedness` - makes no claim that the handbook or the customer records don't support
- `builtin.tool_call_accuracy` - searches the handbook when a billing rule is needed, with a fitting query
- `builtin.tool_call_success` - handbook searches run without errors
- `billing-specialist-policy`, a safety rubric (preview) - identity checks, privacy, and account actions only after the customer agrees
- `billing-specialist-voice-quality`, a quality rubric (preview) - short spoken answers with a clear next step

The rubrics are defined in `scripts/rubrics.py`. The script publishes a new rubric version only when a definition changes.

`RESPONSES_DEPLOYMENT` judges all evaluators except the safety rubric, which Microsoft-hosted models score. That's the same model as the specialist, so a model may rate its own answers too kindly.

Each run stays in the Foundry portal under **Evaluations**, so you can compare specialist versions there. The script prints each case's results and the report link. It exits with code 1 if any case fails or errors. Tool-call evaluators skip cases where the specialist made no tool call.

To add a case, add a line with `name`, `query` and `ground_truth` to the JSONL file. Put expected facts only in `ground_truth`, never in the agent instructions.

## Web app

`web/` is a Next.js app where a signed-in user calls `voice-agent` from the browser and reads the live transcript, including each hand-off to the billing specialist and its handbook searches. The browser signs the user in with MSAL and connects to GPT-Live directly through `@azure/ai-projects`, with the user's own Entra token. There is no backend relay.

### Deploy the web app

After `azd provision`:

```powershell
azd deploy web
azd env get-value WEB_URI
```

azd builds the image in the container registry (ACR Tasks) and deploys it to Azure Container Apps.

- Provisioning grants tenant-wide admin consent for the app's Foundry permission (`user_impersonation` on `https://ai.azure.com`). The deployer needs Cloud Application Administrator or Application Administrator.
- Everyone who uses the app needs the **Foundry User** role. Provisioning assigns it to the deployer only, on the Foundry account.
- Until the first `azd deploy web`, the container app runs a placeholder image on the wrong port, so its first revision is unhealthy. That is expected.
- Container logs are in the `ContainerAppConsoleLogs` and `ContainerAppSystemLogs` tables of the Log Analytics workspace.

### Run the web app locally

Create `web/.env.local` with the values from `azd env get-values`:

```text
FOUNDRY_PROJECT_ENDPOINT=<FOUNDRY_PROJECT_ENDPOINT>
VOICE_AGENT_NAME=voice-agent
ENTRA_WEB_CLIENT_ID=<ENTRA_WEB_CLIENT_ID>
AZURE_TENANT_ID=<AZURE_TENANT_ID>
```

Then run:

```powershell
cd web
pnpm install
pnpm dev
```

Open http://localhost:3000. Keep port 3000, because the app registration allows only `http://localhost:3000/redirect` as the local redirect URI. The app reads these settings at request time, so the same image works in every environment; without them the page lists what is missing.

`package.json` pins Node.js 24 LTS through `devEngines`, and pnpm downloads that version, so the Node.js on your PATH doesn't matter. Run everything through `pnpm`.

### Test the web app

Run these in `web/`:

- `pnpm lint` - ESLint.
- `pnpm exec next typegen` and then `pnpm exec tsc --noEmit` - type-check. `next typegen` creates the route types that `tsc` needs.
- `pnpm test` - Vitest unit tests of the call logic. They replay a recorded GPT-Live call (`lib/live/fixtures/recorded-call.json`).

## Talk to the agent

Open the [web app](#web-app) (`azd env get-value WEB_URI`), select **Sign in with Microsoft**, then **Start call**, and allow the microphone. You can also type in the message box. The info button in the header lists the demo customers.

To talk to the agent from a terminal, use the official Python sample `response_delegation.py` from [microsoft/voice-agent](https://github.com/microsoft/voice-agent/tree/main/samples/gpt_live/python). With `AGENT_NAME` set, it reuses an existing GPT-Live agent without changing it.

```powershell
git clone https://github.com/microsoft/voice-agent.git
cd voice-agent
uv venv samples\gpt_live\python\.venv
uv pip install --python samples\gpt_live\python\.venv\Scripts\python.exe -r samples\gpt_live\python\requirements.txt --default-index https://packagefeedproxy.microsoft.io/pypi/simple
Copy-Item samples\gpt_live\.env.example samples\gpt_live\.env
```

In `samples\gpt_live\.env`, set `FOUNDRY_PROJECT_ENDPOINT` to the value from `azd env get-value FOUNDRY_PROJECT_ENDPOINT`, and set `AGENT_NAME=voice-agent`. The sample signs in with the Azure CLI (`az login`). Then run it, wait for **Ready**, speak with a headset, and press **Ctrl+C** to stop:

```powershell
az login
samples\gpt_live\python\.venv\Scripts\python.exe samples\gpt_live\python\response_delegation.py
```

Demo customers (customer number, postcode):

- 100245, 00150 - high bill caused by an estimated meter reading; the agent corrects it
- 100318, 02100 - October bill paid twice; the agent refunds the credit
- 100472, 33100 - bill increase from spot price and higher usage
- 100533, 90100 - payment extension; also a disconnection notice, where the agent arranges an advisor callback
