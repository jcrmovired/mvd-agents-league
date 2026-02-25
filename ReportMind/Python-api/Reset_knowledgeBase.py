import os
import shutil
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

def reset_chroma_db(persist_directory: str, embedding_function):

    # 1️⃣ borrar carpeta si existe
    if os.path.exists(persist_directory):
        shutil.rmtree(persist_directory)
        print(f"🗑️ Carpeta eliminada → {persist_directory}")

    # 2️⃣ recrear carpeta vacía
    os.makedirs(persist_directory, exist_ok=True)
    print(f"📁 Carpeta recreada → {persist_directory}")

    # 3️⃣ crear DB vacía
    db = Chroma(
        persist_directory=persist_directory,
        embedding_function=embedding_function
    )

    print("✅ Chroma reiniciada y lista para usar")

    return db

if __name__ == "__main__":

    print("\n⚠️  RESETEANDO KNOWLEDGE BASE...\n")

    try:
        db = reset_chroma_db(
            persist_directory=KNOWLEDGE_BASE_PATH,
            embedding_function=embedding
        )

        # 🔎 comprobar que está vacía
        total_vectores = db._collection.count()

        print(f"\n🧹 Total de vectores tras el reset: {total_vectores}")

        if total_vectores == 0:
            print("✅ Knowledge base reseteada correctamente\n")
        else:
            print("⚠️ La base no quedó vacía\n")

    except Exception as e:
        print(f"❌ Error durante el reset: {e}")