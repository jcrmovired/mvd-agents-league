import uuid
import pandas as pd
import os
import argparse
from io import StringIO
from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_openai import AzureOpenAIEmbeddings
from langchain_core.documents import Document

# ---------------- CONFIG ----------------
CSV = True
MAX_ELEMS = 5000
SEPARADOR = ","

# Ruta fija a la carpeta de excels
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_RAW_PATH = os.path.join(BASE_DIR, "Data", "Data raw")
DATA_PROCESSED_PATH = os.path.join(BASE_DIR, "Data", "Data processed")

# Ruta fija a la carpeta de knowledge base
KNOWLEDGE_BASE_PATH = os.path.join(BASE_DIR, "Data", "KnowledgeBase")
ENV_PATH = os.path.join(BASE_DIR, "env", ".env.playground.user")

load_dotenv(ENV_PATH)

# ----------------------------------------
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

try:
    db = Chroma(persist_directory = KNOWLEDGE_BASE_PATH, embedding_function = embedding)
    print("Chroma cargado correctamente.")
except Exception as e:
    print(f"Error al cargar chroma: {e}")

def partir_excel(nombre_excel):

    ruta_excel = os.path.join(DATA_RAW_PATH, nombre_excel)

    if not os.path.exists(ruta_excel):
        raise FileNotFoundError(f"No se encontró el archivo: {ruta_excel}")

    nombre_base = os.path.splitext(nombre_excel)[0]

    carpeta_salida = os.path.join(DATA_PROCESSED_PATH, nombre_base)
    os.makedirs(carpeta_salida, exist_ok=True)

    xls = pd.ExcelFile(ruta_excel)

    for nombre_pestaña in xls.sheet_names:

        df = pd.read_excel(xls, sheet_name=nombre_pestaña)
        nombre_pestaña_limpio = nombre_pestaña.replace("/", "_").replace("\\", "_")

        partes = []
        filas_actuales = []

        header_actual = []
        header_part = []

        col3_actual = None
        col4_actual = None

        for i in range(len(df)):

            fila = df.iloc[i].copy()

            fila_no_vacia = any(
                pd.notna(v) and str(v).strip() != ""
                for v in fila.values
            )

            # -------- FIX COLUMNA 3 --------
            if fila_no_vacia and len(fila) > 2:
                valor_col3 = fila.iloc[2]

                if pd.notna(valor_col3) and str(valor_col3).strip() != "":
                    col3_actual = valor_col3
                elif col3_actual is not None:
                    fila.iloc[2] = col3_actual

            # -------- FIX COLUMNA 4 --------
            valor_col3 = fila.iloc[2] if len(fila) > 2 else None
            es_total = (
                isinstance(valor_col3, str)
                and "total" in valor_col3.strip().lower()
            )

            if fila_no_vacia and not es_total and len(fila) > 3:
                valor_col4 = fila.iloc[3]

                if pd.notna(valor_col4) and str(valor_col4).strip() != "":
                    col4_actual = valor_col4
                elif col4_actual is not None:
                    fila.iloc[3] = col4_actual

            # -------- detectar header --------
            es_header = any(
                isinstance(v, str) and "measure" in v.lower()
                for v in fila.values
            )

            if es_header:
                inicio = max(0, i - 3)
                header_actual = [df.iloc[j] for j in range(inicio, i + 1)]

            filas_actuales.append(fila)

            filas_tmp = []
            if header_part:
                filas_tmp.extend(header_part)
            filas_tmp.extend(filas_actuales)

            df_tmp = pd.DataFrame(filas_tmp)
            buffer = StringIO()
            df_tmp.to_csv(buffer, index=False, sep=SEPARADOR)

            if len(buffer.getvalue()) > MAX_ELEMS:

                filas_actuales.pop()

                filas_parte = []
                if header_part:
                    filas_parte.extend(header_part)
                filas_parte.extend(filas_actuales)

                partes.append(pd.DataFrame(filas_parte))

                filas_actuales = [fila]
                header_part = header_actual.copy()

        if filas_actuales:
            filas_parte = []
            if header_part:
                filas_parte.extend(header_part)
            filas_parte.extend(filas_actuales)

            partes.append(pd.DataFrame(filas_parte))

        # -------- guardar archivos --------
        for i, df_parte in enumerate(partes):

            if CSV:
                nombre_archivo = f"{nombre_base}_{nombre_pestaña_limpio}_parte{i+1}.csv"
                ruta_salida = os.path.join(carpeta_salida, nombre_archivo)

                df_parte.to_csv(
                    ruta_salida,
                    index=False,
                    encoding="utf-8-sig",
                    sep=SEPARADOR
                )

                # 🧠 INGESTA EN CHROMA
                ingest_dataframe_to_chroma(
                    df=df_parte,
                    csv_path=ruta_salida,
                    db=db
                )

            else:
                nombre_archivo = f"{nombre_base}_{nombre_pestaña_limpio}_parte{i+1}.xlsx"
                ruta_salida = os.path.join(carpeta_salida, nombre_archivo)

                df_parte.to_excel(ruta_salida, index=False)

    print("Proceso completado")

def ingest_dataframe_to_chroma(df, csv_path: str, db):
    """
    Guarda todo el contenido del DataFrame como un único Document en Chroma
    """

    # convertir dataframe a texto
    content = df.to_csv(index=False,
                        encoding = "utf-8-sig",
                        sep = SEPARADOR)
    content = str(content)

    doc = Document(
        page_content=content,
        metadata={
            "source": csv_path,   # nombre del archivo o ruta
            "type": "csv_full"
        }
    )

    db.add_documents([doc], ids=[str(uuid.uuid4())])

    print(f"✅ CSV completo indexado en Chroma → {csv_path}")

# ---------------- MAIN ----------------

if __name__ == "__main__":

    parser = argparse.ArgumentParser(
        description="Particionar un Excel desde /Data/Data raw"
    )

    parser.add_argument(
        "excel",
        help="Nombre del archivo Excel (ej: ventas.xlsx)"
    )

    args = parser.parse_args()

    partir_excel(args.excel)

    # 🔹 imprimir número de vectores
    total_vectores = db._collection.count()
    print(f"\n🔢 Total de vectores en la base: {total_vectores}")