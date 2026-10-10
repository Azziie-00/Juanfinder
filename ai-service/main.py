import os
from pathlib import Path
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from document_parser import extract_document
from ai_service import AIServiceError, analyze_member, generate_titles

app = FastAPI(title="JuanFinder AI Service", version="0.1.0")
MAX_FILE_BYTES = 10 * 1024 * 1024

class TitleRequest(BaseModel):
    member_profiles: list[dict] = Field(min_length=1, max_length=4)

@app.get("/health")
def health():
    return {"status": "ok", "model": os.getenv("OLLAMA_MODEL", "llama3.2:1b")}

@app.post("/analyze-member")
async def analyze_member_endpoint(file: UploadFile = File(...)):
    filename = Path(file.filename or "upload.txt").name
    content = await file.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 10 MB limit.")
    try:
        text = extract_document(filename, content)
        profile = analyze_member(text)
        return {"member_profile": profile, "filename": filename}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except AIServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Document analysis failed.") from exc

@app.post("/generate-titles")
def generate_titles_endpoint(request: TitleRequest):
    try:
        return generate_titles(request.member_profiles)
    except AIServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
