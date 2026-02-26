import pandas as pd
import os
import json
import argparse

# Base paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PROCESSED_PATH = os.path.join(BASE_DIR, "Data", "Data processed")


def consultar_csv(nombre_archivo, consulta_tipo, parametros=None):
    """
    Run queries over a single CSV file.
    """

    ruta_csv = os.path.join(DATA_PROCESSED_PATH, nombre_archivo)

    if not os.path.exists(ruta_csv):
        raise FileNotFoundError(f"CSV file not found: {ruta_csv}")

    df = pd.read_csv(ruta_csv)

    resultado = {}

    # ---------------- COUNT ----------------
    if consulta_tipo == "count":
        resultado["total_registros"] = len(df)
        resultado["columnas"] = list(df.columns)
        resultado["mensaje"] = f"The file has {len(df)} rows and {len(df.columns)} columns"

    # ---------------- DESCRIBE ----------------
    elif consulta_tipo == "describe":
        desc = df.describe(include="all").to_dict()
        resultado["estadisticas"] = desc
        resultado["mensaje"] = "Descriptive statistics"

    # ---------------- HEAD ----------------
    elif consulta_tipo == "head":
        n = parametros.get("n", 10) if parametros else 10
        resultado["datos"] = df.head(n).to_dict(orient="records")
        resultado["mensaje"] = f"First {n} rows"

    # ---------------- TOP ----------------
    elif consulta_tipo == "top":
        columna = parametros.get("columna") if parametros else None
        n = parametros.get("n", 10) if parametros else 10

        if columna and columna in df.columns:
            df[columna] = pd.to_numeric(df[columna], errors="coerce")
            top_data = df.nlargest(n, columna).to_dict(orient="records")
            resultado["datos"] = top_data
            resultado["mensaje"] = f"Top {n} rows by '{columna}'"
        else:
            resultado["error"] = f"Column '{columna}' not found. Available: {list(df.columns)}"

    # ---------------- SUM ----------------
    elif consulta_tipo == "sum":
        columna = parametros.get("columna") if parametros else None

        if columna and columna in df.columns:
            df[columna] = pd.to_numeric(df[columna], errors="coerce")
            total = df[columna].sum()
            resultado["total"] = float(total)
            resultado["mensaje"] = f"Sum of '{columna}': {total}"
        else:
            resultado["error"] = f"Column '{columna}' not found"

    # ---------------- SAMPLE ----------------
    elif consulta_tipo == "sample":
        n = parametros.get("n", 100) if parametros else 100

        resultado["datos"] = df.head(n).to_dict(orient="records")
        resultado["columnas"] = list(df.columns)
        resultado["total_registros"] = len(df)
        resultado["mensaje"] = f"Sample of {min(n, len(df))} rows from {len(df)}"

    else:
        resultado["error"] = f"Query type '{consulta_tipo}' not supported"

    return resultado


# ---------------- CLI ----------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser()

    parser.add_argument("archivo", help="CSV file name (with .csv)")
    parser.add_argument("consulta", help="count, describe, head, top, sum, sample")

    parser.add_argument("--columna", help="Column name (for top, sum)")
    parser.add_argument("--n", type=int, default=10, help="Number of rows")

    args = parser.parse_args()

    parametros = {}

    if args.columna:
        parametros["columna"] = args.columna

    if args.n:
        parametros["n"] = args.n

    try:
        resultado = consultar_csv(args.archivo, args.consulta, parametros)
        print(json.dumps(resultado, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))