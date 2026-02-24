from fastapi import FastAPI
from pydantic import BaseModel

from Script_particion_excel_to_csv import partir_excel  # importamos tu función

app = FastAPI()


# 📦 modelo de entrada
class ExcelRequest(BaseModel):
    file_name: str


# 🧪 endpoint de prueba
@app.get("/health")
def health():
    return {"status": "ok"}


# 🛠️ endpoint que llama a tu función
@app.post("/partir-excel")
def ejecutar_particion(request: ExcelRequest):
    try:
        partir_excel(request.file_name)
        return {"message": f"Archivo {request.file_name} procesado correctamente"}
    except Exception as e:
        return {"error": str(e)}