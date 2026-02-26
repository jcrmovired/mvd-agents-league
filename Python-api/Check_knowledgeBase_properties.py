import os
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


def count_embeddings():

    db = Chroma(
        persist_directory=KNOWLEDGE_BASE_PATH,
        embedding_function=embedding
    )

    total = db._collection.count()

    print(f"\n🔢 Número total de embeddings en la KB: {total}\n")


# 🏁 MAIN
if __name__ == "__main__":
    count_embeddings()