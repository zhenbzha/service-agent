"""Push the PDFs in knowledge/ into Azure AI Search and expose them as a Foundry IQ knowledge base.

Follows Azure-Samples/azure-search-python-samples (agentic-retrieval-pipeline-example): one
search document per PDF page, an index with an Azure OpenAI vectorizer and a default semantic
configuration, a search index knowledge source and a minimal, extractive knowledge base.

Re-run it whenever a PDF in knowledge/ changes. Pages that no longer exist are removed.

Usage: uv run scripts/sync_knowledge.py [--question "..."]
"""

import argparse
import re
import sys
from itertools import batched
from pathlib import Path

from azure.core.exceptions import HttpResponseError
from azure.identity import get_bearer_token_provider
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    AzureOpenAIVectorizer,
    AzureOpenAIVectorizerParameters,
    HnswAlgorithmConfiguration,
    KnowledgeBase,
    KnowledgeSourceReference,
    SearchField,
    SearchIndex,
    SearchIndexFieldReference,
    SearchIndexKnowledgeSource,
    SearchIndexKnowledgeSourceParameters,
    SemanticConfiguration,
    SemanticField,
    SemanticPrioritizedFields,
    SemanticSearch,
    VectorSearch,
    VectorSearchProfile,
)
from azure.search.documents.knowledgebases import KnowledgeBaseRetrievalClient
from azure.search.documents.knowledgebases.models import (
    KnowledgeBaseRetrievalRequest,
    KnowledgeRetrievalMinimalReasoningEffort,
    KnowledgeRetrievalOutputMode,
    KnowledgeRetrievalSemanticIntent,
)
from openai import APIStatusError, OpenAI
from pypdf import PdfReader

from common import REPO_ROOT, ConfigError, azd_credential, load_azd_env, require_env

KNOWLEDGE_DIR = REPO_ROOT / "knowledge"

INDEX_NAME = "zava-energy-knowledge"
KNOWLEDGE_SOURCE_NAME = "zava-energy-knowledge-source"
KNOWLEDGE_DESCRIPTION = "Zava Energy internal customer service handbooks, such as billing and payments."

# The deployment name comes from azd; the model and its default vector size are fixed by the infra.
EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSIONS = 3072
# Learn "Quotas and limits": at most 8,192 tokens per input and 300,000 per request, so 32 pages fit.
EMBEDDING_BATCH_SIZE = 32

VECTOR_PROFILE = "content-vector-profile"
VECTORIZER = "content-vectorizer"
SEMANTIC_CONFIGURATION = "content-semantic"

DEFAULT_QUESTION = "Can a customer get more time to pay an invoice?"


def document_key(pdf_path: Path, page_number: int) -> str:
    """Stable search key for a PDF page. Keys may only contain letters, digits, '_', '-' and '='."""
    safe_stem = re.sub(r"[^A-Za-z0-9_-]", "-", pdf_path.stem)
    return f"{safe_stem}-page-{page_number}"


def read_pdf_pages(pdf_path: Path) -> list[dict]:
    """One search document per page that has text."""
    documents = []
    for page_number, page in enumerate(PdfReader(pdf_path).pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            documents.append(
                {
                    "id": document_key(pdf_path, page_number),
                    "file_name": pdf_path.name,
                    "page_number": page_number,
                    "content": text,
                }
            )
    return documents


def read_knowledge_documents() -> list[dict]:
    pdf_paths = sorted(KNOWLEDGE_DIR.glob("*.pdf"))
    if not pdf_paths:
        raise ConfigError(f"No PDF files found in {KNOWLEDGE_DIR}.")
    return [document for pdf_path in pdf_paths for document in read_pdf_pages(pdf_path)]


def embedding_client(openai_endpoint: str, credential) -> OpenAI:
    """OpenAI v1 client with Microsoft Entra ID auth, as in the Learn "Azure OpenAI v1 API" guide."""
    token_provider = get_bearer_token_provider(credential, "https://ai.azure.com/.default")
    return OpenAI(base_url=f"{openai_endpoint.rstrip('/')}/openai/v1/", api_key=token_provider)


def add_content_vectors(documents: list[dict], client: OpenAI, deployment: str) -> None:
    for batch in batched(documents, EMBEDDING_BATCH_SIZE, strict=False):
        response = client.embeddings.create(model=deployment, input=[document["content"] for document in batch])
        for document, item in zip(batch, response.data, strict=True):
            document["content_vector"] = item.embedding


def search_index(openai_endpoint: str, embedding_deployment: str) -> SearchIndex:
    """Index for page chunks. The vectorizer lets the knowledge base turn queries into vectors."""
    return SearchIndex(
        name=INDEX_NAME,
        fields=[
            SearchField(name="id", type="Edm.String", key=True, filterable=True),
            SearchField(name="file_name", type="Edm.String", filterable=True),
            SearchField(name="page_number", type="Edm.Int32", filterable=True, sortable=True),
            SearchField(name="content", type="Edm.String", searchable=True),
            SearchField(
                name="content_vector",
                type="Collection(Edm.Single)",
                stored=False,
                vector_search_dimensions=EMBEDDING_DIMENSIONS,
                vector_search_profile_name=VECTOR_PROFILE,
            ),
        ],
        vector_search=VectorSearch(
            profiles=[
                VectorSearchProfile(
                    name=VECTOR_PROFILE, algorithm_configuration_name="hnsw", vectorizer_name=VECTORIZER
                )
            ],
            algorithms=[HnswAlgorithmConfiguration(name="hnsw")],
            vectorizers=[
                AzureOpenAIVectorizer(
                    vectorizer_name=VECTORIZER,
                    # No key: the search service calls the model with its managed identity.
                    parameters=AzureOpenAIVectorizerParameters(
                        resource_url=openai_endpoint.rstrip("/"),
                        deployment_name=embedding_deployment,
                        model_name=EMBEDDING_MODEL,
                    ),
                )
            ],
        ),
        semantic_search=SemanticSearch(
            default_configuration_name=SEMANTIC_CONFIGURATION,
            configurations=[
                SemanticConfiguration(
                    name=SEMANTIC_CONFIGURATION,
                    prioritized_fields=SemanticPrioritizedFields(content_fields=[SemanticField(field_name="content")]),
                )
            ],
        ),
    )


def upload_documents(search_client: SearchClient, documents: list[dict]) -> None:
    results = search_client.upload_documents(documents=documents)
    failed = [f"{result.key}: {result.error_message}" for result in results if not result.succeeded]
    if failed:
        raise ConfigError("Search rejected documents:\n" + "\n".join(failed))


def delete_stale_documents(search_client: SearchClient, current_keys: set[str]) -> int:
    """Remove pages that are no longer in knowledge/, such as a deleted PDF or a shorter version."""
    indexed_keys = {result["id"] for result in search_client.search(search_text="*", select=["id"])}
    stale_keys = indexed_keys - current_keys
    if stale_keys:
        search_client.delete_documents(documents=[{"id": key} for key in stale_keys])
    return len(stale_keys)


def knowledge_source() -> SearchIndexKnowledgeSource:
    """Knowledge source over the index. It uses the index's default semantic configuration."""
    return SearchIndexKnowledgeSource(
        name=KNOWLEDGE_SOURCE_NAME,
        description=KNOWLEDGE_DESCRIPTION,
        search_index_parameters=SearchIndexKnowledgeSourceParameters(
            search_index_name=INDEX_NAME,
            source_data_fields=[
                SearchIndexFieldReference(name="file_name"),
                SearchIndexFieldReference(name="page_number"),
            ],
        ),
    )


def knowledge_base(name: str) -> KnowledgeBase:
    """Minimal reasoning and extractive output: no LLM in the knowledge base, the agent writes the answer."""
    return KnowledgeBase(
        name=name,
        description=KNOWLEDGE_DESCRIPTION,
        knowledge_sources=[KnowledgeSourceReference(name=KNOWLEDGE_SOURCE_NAME)],
        output_mode=KnowledgeRetrievalOutputMode.EXTRACTIVE_DATA,
        retrieval_reasoning_effort=KnowledgeRetrievalMinimalReasoningEffort(),
    )


def print_retrieved_pages(search_endpoint: str, knowledge_base_name: str, credential, question: str) -> None:
    """Ask the knowledge base one question and list the pages it returns."""
    with KnowledgeBaseRetrievalClient(
        endpoint=search_endpoint, knowledge_base_name=knowledge_base_name, credential=credential
    ) as client:
        # Minimal reasoning takes search intents instead of chat messages.
        request = KnowledgeBaseRetrievalRequest(intents=[KnowledgeRetrievalSemanticIntent(search=question)])
        response = client.retrieve(request)
    print(f"\nCheck: {question}")
    for reference in response.references or []:
        score = "" if reference.reranker_score is None else f"  (reranker score {reference.reranker_score:.2f})"
        print(f"  {reference.doc_key}{score}")
    if not response.references:
        print("  No pages returned.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--question", default=DEFAULT_QUESTION, help="Question for the retrieval check.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    load_azd_env()
    search_endpoint = require_env("AZURE_SEARCH_ENDPOINT")
    openai_endpoint = require_env("AZURE_OPENAI_ENDPOINT")
    embedding_deployment = require_env("EMBEDDING_DEPLOYMENT")
    # The name is set in infra/resources.bicep, which also points the agents' MCP connection at it.
    knowledge_base_name = require_env("KNOWLEDGE_BASE_NAME")

    documents = read_knowledge_documents()
    with azd_credential() as credential:
        add_content_vectors(documents, embedding_client(openai_endpoint, credential), embedding_deployment)

        with SearchIndexClient(endpoint=search_endpoint, credential=credential) as index_client:
            index_client.create_or_update_index(search_index(openai_endpoint, embedding_deployment))
            with SearchClient(endpoint=search_endpoint, index_name=INDEX_NAME, credential=credential) as search_client:
                upload_documents(search_client, documents)
                deleted = delete_stale_documents(search_client, {document["id"] for document in documents})
            index_client.create_or_update_knowledge_source(knowledge_source=knowledge_source())
            index_client.create_or_update_knowledge_base(knowledge_base=knowledge_base(knowledge_base_name))

        print(f"Index '{INDEX_NAME}': {len(documents)} pages uploaded, {deleted} stale pages removed.")
        print(f"Knowledge base '{knowledge_base_name}' is ready.")
        print_retrieved_pages(search_endpoint, knowledge_base_name, credential, args.question)


if __name__ == "__main__":
    try:
        main()
    except ConfigError as error:
        sys.exit(f"Error: {error}")
    except HttpResponseError as error:
        sys.exit(f"Azure AI Search request failed (HTTP {error.status_code}): {error.message}")
    except APIStatusError as error:
        sys.exit(f"Embedding request failed (HTTP {error.status_code}): {error.message}")
