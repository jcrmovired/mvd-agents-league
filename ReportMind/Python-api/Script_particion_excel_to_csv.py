import pandas as pd
import os
import argparse
from io import StringIO

# ---------------- CONFIG ----------------
CSV = True
MAX_ELEMS = 5000
SEPARADOR = ","

# Ruta fija a la carpeta de excels
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_RAW_PATH = os.path.join(BASE_DIR, "Data", "Data raw")
DATA_PROCESSED_PATH = os.path.join(BASE_DIR, "Data", "Data processed")
# ----------------------------------------


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
            else:
                nombre_archivo = f"{nombre_base}_{nombre_pestaña_limpio}_parte{i+1}.xlsx"
                ruta_salida = os.path.join(carpeta_salida, nombre_archivo)

                df_parte.to_excel(ruta_salida, index=False)

    print("Proceso completado")


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