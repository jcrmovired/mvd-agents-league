import os
import argparse
from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_openai import AzureOpenAIEmbeddings

# Ruta fija a la carpeta de excels
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ruta fija a la carpeta de knowledge base
KNOWLEDGE_BASE_PATH = os.path.join(BASE_DIR, "Data", "KnowledgeBase")
ENV_PATH = os.path.join(BASE_DIR, "env", ".env.playground.user")

load_dotenv(ENV_PATH)

try:
    embedding = AzureOpenAIEmbeddings(
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT"),
        api_key = os.getenv("SECRET_AZURE_OPENAI_API_KEY"),
        azure_deployment = os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME"),
        chunk_size = 1,
        check_embedding_ctx_length=False
    )
    print("Embedding cargado correctamente.")

except Exception as e:
    print(f"Error al cargar el embedding: {e}")

def retrieve_top_k(query: str, k: int = 10):

    db = Chroma(
        persist_directory=KNOWLEDGE_BASE_PATH,
        embedding_function=embedding
    )

    results = db.similarity_search(query, k=k)

    print(f"\n🔎 Query: {query}")
    print(f"📊 Top {k} resultados:\n")

    for i, doc in enumerate(results, 1):
        print(f"RESULTADO {i}")
        print("📄 Source:", doc.metadata.get("source"))
        print("🧠 Contenido:")
        print(doc.page_content[:500])  # mostramos solo un preview
        print("-" * 60)


# 🏁 MAIN
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Buscar en la Knowledge Base (Top-K vectores)"
    )

    parser.add_argument(
        "query",
        type=str,
        help="Texto para hacer la búsqueda semántica"
    )

    parser.add_argument(
        "--k",
        type=int,
        default=10,
        help="Número de resultados (default=10)"
    )

    args = parser.parse_args()

    retrieve_top_k(args.query, args.k)