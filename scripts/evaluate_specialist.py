"""Evaluate the billing specialist with a Foundry cloud evaluation.

Sends every case in evals/billing-specialist.jsonl to the specialist version the voice agent is
pinned to (Learn: "Run evaluations from the SDK", agent target), then judges each answer with:
- completeness (builtin.response_completeness, preview): covers the key points of the case's ground truth.
- groundedness (builtin.groundedness): makes no claim the handbook or customer records don't support.
- tool_call_accuracy (builtin.tool_call_accuracy): searches the handbook when it needs a billing
  rule, with a fitting query and no needless calls.
- tool_call_success (builtin.tool_call_success): handbook searches return results without errors.
- billing-specialist-policy (safety rubric, preview): identity, privacy and account-action rules.
  Microsoft-hosted models score it; it doesn't use the judge deployment.
- billing-specialist-voice-quality (quality rubric, preview): a short, plain spoken answer with a
  clear next step.

The judge for every other evaluator is RESPONSES_DEPLOYMENT. The rubric evaluators are defined in
scripts/rubrics.py and get a new version only when their definition changes. Each run creates an
evaluation that stays in the Foundry portal (Evaluations), so results for different specialist
versions can be compared there.

Usage: uv run scripts/evaluate_specialist.py
Exits with code 1 if any case fails or errors.
"""

import hashlib
import json
import sys
import time
from datetime import datetime, timezone

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    AzureAIAgentTargetParam,
    TargetCompletionEvalRunDataSource,
    TestingCriterionAzureAIEvaluator,
)
from azure.core.exceptions import HttpResponseError, ResourceNotFoundError
from openai import APIError
from openai.types.eval_create_params import DataSourceConfigCustom
from openai.types.evals.create_eval_completions_run_data_source_param import (
    SourceFileContent,
    SourceFileContentContent,
)

from common import (
    REPO_ROOT,
    SPECIALIST_NAME,
    ConfigError,
    azd_credential,
    load_azd_env,
    pinned_specialist_version,
    read_agent_file,
    require_env,
)
from rubrics import RUBRICS, Rubric
from sync_knowledge import read_knowledge_documents

DATASET_PATH = REPO_ROOT / "evals" / "billing-specialist.jsonl"

# Evaluator metadata key holding a hash of the rubric that created the version.
DEFINITION_HASH_KEY = "definition_sha256"

POLL_SECONDS = 15
FINISHED_STATUSES = {"completed", "failed", "canceled"}

# Run-time fields that an agent target adds to each row (azd azure.ai.evaluations extension, build.go).
QUERY = "{{item.query}}"
ANSWER_TEXT = "{{sample.output_text}}"
ANSWER_WITH_TOOL_CALLS = "{{sample.output_items}}"
TOOL_DEFINITIONS = "{{sample.tool_definitions}}"

CASE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "query": {"type": "string"},
        "ground_truth": {"type": "string"},
        "context": {"type": "string"},
    },
    "required": ["name", "query", "ground_truth", "context"],
}


def read_cases() -> list[dict]:
    lines = DATASET_PATH.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def grounding_context() -> str:
    """Everything the specialist may base an answer on: the handbook and the customer records.

    The customer records live in the specialist's instructions, not in a tool result, so the
    groundedness judge gets them as explicit context.
    """
    handbook = "\n".join(page["content"] for page in read_knowledge_documents())
    customer_records = read_agent_file(SPECIALIST_NAME, "data.json")
    return f"Billing handbook:\n{handbook}\n\nCustomer records (JSON):\n{customer_records}"


def rubric_hash(rubric: Rubric) -> str:
    payload = json.dumps(rubric.evaluator_version(), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def latest_evaluator_version(project: AIProjectClient, name: str):
    """Return the evaluator's newest version, or None if the evaluator doesn't exist yet."""
    try:
        versions = list(project.evaluators.list_versions(name, type="custom", limit=100))
    except ResourceNotFoundError:
        return None
    return max(versions, key=lambda version: version.created_at, default=None)


def create_rubric_if_changed(project: AIProjectClient, rubric: Rubric) -> str:
    """Return the rubric evaluator version to use, creating one only when the rubric changed."""
    new_hash = rubric_hash(rubric)
    latest = latest_evaluator_version(project, rubric.name)
    if latest is not None and (latest.metadata or {}).get(DEFINITION_HASH_KEY) == new_hash:
        print(f"Unchanged: evaluator {rubric.name}:{latest.version}")
        return str(latest.version)
    created = project.evaluators.create_version(
        name=rubric.name,
        evaluator_version={**rubric.evaluator_version(), "metadata": {DEFINITION_HASH_KEY: new_hash}},
    )
    print(f"Created:   evaluator {rubric.name}:{created.version}")
    return str(created.version)


def criterion(name: str, evaluator: str, judge: str | None, data_mapping: dict, version: str | None = None):
    testing_criterion = TestingCriterionAzureAIEvaluator(
        type="azure_ai_evaluator", name=name, evaluator_name=evaluator, data_mapping=data_mapping
    )
    if judge:
        testing_criterion["initialization_parameters"] = {"deployment_name": judge}
    if version:
        testing_criterion["evaluator_version"] = version
    return testing_criterion


def testing_criteria(judge: str, rubric_versions: dict[str, str]) -> list:
    builtin_criteria = [
        criterion(
            "completeness",
            "builtin.response_completeness",
            judge,
            {"ground_truth": "{{item.ground_truth}}", "response": ANSWER_TEXT},
        ),
        criterion(
            "groundedness",
            "builtin.groundedness",
            judge,
            {"query": QUERY, "context": "{{item.context}}", "response": ANSWER_TEXT},
        ),
        criterion(
            "tool_call_accuracy",
            "builtin.tool_call_accuracy",
            judge,
            {"query": QUERY, "response": ANSWER_WITH_TOOL_CALLS, "tool_definitions": TOOL_DEFINITIONS},
        ),
        criterion(
            "tool_call_success",
            "builtin.tool_call_success",
            judge,
            {"response": ANSWER_WITH_TOOL_CALLS, "tool_definitions": TOOL_DEFINITIONS},
        ),
    ]
    rubric_criteria = [
        criterion(
            rubric.name,
            rubric.name,
            judge if rubric.uses_own_judge_deployment else None,
            {"query": QUERY, "response": ANSWER_TEXT},
            rubric_versions[rubric.name],
        )
        for rubric in RUBRICS
    ]
    return builtin_criteria + rubric_criteria


def create_evaluation(openai_client, specialist_version: str, criteria: list):
    return openai_client.evals.create(
        name=f"{SPECIALIST_NAME}:{specialist_version}",
        data_source_config=DataSourceConfigCustom(type="custom", item_schema=CASE_SCHEMA, include_sample_schema=True),
        testing_criteria=criteria,
    )


def start_run(openai_client, evaluation_id: str, specialist_version: str, cases: list[dict], context: str):
    """Send each case's query to the pinned specialist version, as in the SDK sample_agent_evaluation.py."""
    rows = [SourceFileContentContent(item={**case, "context": context}) for case in cases]
    data_source = TargetCompletionEvalRunDataSource(
        type="azure_ai_target_completions",
        source=SourceFileContent(type="file_content", content=rows),
        input_messages={
            "type": "template",
            "template": [{"type": "message", "role": "user", "content": {"type": "input_text", "text": QUERY}}],
        },
        target=AzureAIAgentTargetParam(type="azure_ai_agent", name=SPECIALIST_NAME, version=specialist_version),
    )
    started = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return openai_client.evals.runs.create(
        eval_id=evaluation_id,
        name=f"{SPECIALIST_NAME}:{specialist_version} {started}",
        metadata={"agent_name": SPECIALIST_NAME, "agent_version": specialist_version},
        data_source=data_source,
    )


def wait_for_run(openai_client, evaluation_id: str, run):
    status = run.status
    print(f"Run {run.id}: {status}")
    while run.status not in FINISHED_STATUSES:
        time.sleep(POLL_SECONDS)
        run = openai_client.evals.runs.retrieve(run_id=run.id, eval_id=evaluation_id)
        if run.status != status:
            status = run.status
            print(f"Run {run.id}: {status}")
    return run


def result_label(result: dict) -> str:
    metric = result.get("metric")
    name = result.get("name")
    return f"{name} ({metric})" if metric and metric != name else str(name)


def verdict(result: dict) -> str:
    passed = result.get("passed")
    if passed is None:
        return str(result.get("status") or "n/a")
    return "pass" if passed else "FAIL"


def low_rubric_dimensions(result: dict) -> list[str]:
    """Quality rubric dimensions rated 3 or lower (Learn: "Quality rubric evaluators", example output)."""
    dimensions = (result.get("properties") or {}).get("dimension_results") or []
    return [
        f"{dimension['id']} {dimension['raw_score']}/5: {dimension.get('reason')}"
        for dimension in dimensions
        if dimension.get("applicable") and dimension.get("raw_score") is not None and dimension["raw_score"] <= 3
    ]


def print_case(output_item: dict) -> None:
    case_name = output_item["datasource_item"].get("name", output_item["datasource_item_id"])
    results = output_item.get("results") or []
    problems = [result for result in results if verdict(result) in ("FAIL", "error")]
    print(f"\n=== {case_name}: {'FAIL' if problems else 'pass'} ===")
    for result in results:
        print(f"  {result_label(result)}: {verdict(result)} (score {result.get('score')})")
    if not problems:
        return
    print("  Agent output:")
    # sample.output also holds the system prompt and tool results, which are long and not the answer.
    for message in (output_item.get("sample") or {}).get("output") or []:
        if message.get("role") == "assistant":
            print(f"    {message.get('content')}")
    for result in problems:
        print(f"  Why {result_label(result)} is {verdict(result)}: {result.get('reason') or 'no reason given'}")
        for dimension in low_rubric_dimensions(result):
            print(f"    - {dimension}")


def print_summary(run: dict) -> None:
    print(f"\nRun status: {run['status']}")
    if (run.get("error") or {}).get("message"):
        print(f"Run error: {run['error']['message']}")
    counts = run.get("result_counts")
    if counts:
        print(f"Cases: {counts['passed']} passed, {counts['failed']} failed, {counts['errored']} errored of {counts['total']}")
    # Each criterion counts only the cases it applied to; skipped cases count as neither passed nor failed.
    for criterion_result in run.get("per_testing_criteria_results") or []:
        label = result_label({"name": criterion_result["testing_criteria"], "metric": criterion_result.get("metric")})
        print(
            f"  {label}: {criterion_result['passed']} passed, {criterion_result['failed']} failed, "
            f"{criterion_result.get('errored', 0)} errored, {criterion_result.get('skipped', 0)} skipped"
        )
    print(f"Report: {run.get('report_url')}")


def main() -> int:
    # Answers can hold characters the Windows console code page can't encode.
    sys.stdout.reconfigure(encoding="utf-8")
    load_azd_env()
    judge = require_env("RESPONSES_DEPLOYMENT")
    cases = read_cases()
    context = grounding_context()
    with azd_credential() as credential, AIProjectClient(
        endpoint=require_env("FOUNDRY_PROJECT_ENDPOINT"), credential=credential, allow_preview=True
    ) as project, project.get_openai_client() as openai_client:
        specialist_version = pinned_specialist_version(project)
        rubric_versions = {rubric.name: create_rubric_if_changed(project, rubric) for rubric in RUBRICS}
        evaluation = create_evaluation(openai_client, specialist_version, testing_criteria(judge, rubric_versions))
        print(f"Evaluating {SPECIALIST_NAME}:{specialist_version} on {len(cases)} cases, judged by {judge}")
        run = start_run(openai_client, evaluation.id, specialist_version, cases, context)
        run = wait_for_run(openai_client, evaluation.id, run)
        if run.status == "completed":
            for output_item in openai_client.evals.runs.output_items.list(run_id=run.id, eval_id=evaluation.id):
                print_case(output_item.to_dict())
    # to_dict() also returns optional fields that the typed model doesn't declare (Learn: "Cloud evaluation results").
    # The OpenAI SDK has no type for the Azure agent-target data source, so skip that serializer warning.
    print_summary(run.to_dict(warnings=False))
    counts = run.result_counts
    all_passed = run.status == "completed" and counts and not counts.failed and not counts.errored
    return 0 if all_passed else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ConfigError as error:
        sys.exit(f"Error: {error}")
    except HttpResponseError as error:
        sys.exit(f"Foundry request failed (HTTP {error.status_code}): {error.message}")
    except APIError as error:
        sys.exit(f"Evaluation request failed: {error.message}")
