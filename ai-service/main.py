import os
import secrets
from pathlib import Path
from fastapi import (Depends, FastAPI, File, Header, HTTPException, UploadFile)
from pydantic import BaseModel, Field
from document_parser import extract_document
from ai_service import AIServiceError, analyze_member, chat_reply, generate_titles

app = FastAPI(title="JuanFinder AI Service", version="0.1.0")
AI_SERVICE_TOKEN = os.getenv("AI_SERVICE_TOKEN", "").strip()
def require_ai_service_token(
    x_ai_service_token: str | None = Header(default=None),
):
    if not AI_SERVICE_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="AI service token is not configured.",
        )

    if (
        not x_ai_service_token
        or not secrets.compare_digest(
            x_ai_service_token,
            AI_SERVICE_TOKEN,
        )
    ):
        raise HTTPException(
            status_code=401,
            detail="Unauthorized.",
        )
MAX_FILE_BYTES = 10 * 1024 * 1024

class TitleRequest(BaseModel):
    member_profiles: list[dict] = Field(min_length=1, max_length=4)

class ChatMessage(BaseModel):
    role: str
    content: str = Field(min_length=1, max_length=4000)

class ChatRequest(BaseModel):
    system_prompt: str = Field(min_length=1, max_length=8000)
    messages: list[ChatMessage] = Field(min_length=1, max_length=12)

@app.get("/health")
def health():
    return {"status": "ok", "model": os.getenv("OLLAMA_MODEL", "llama3.2:1b")}

@app.post("/analyze-member", dependencies=[Depends(require_ai_service_token)])
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

@app.post("/generate-titles", dependencies=[Depends(require_ai_service_token)])
def generate_titles_endpoint(request: TitleRequest):
    try:
        return generate_titles(request.member_profiles)
    except AIServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

@app.post("/chat", dependencies=[Depends(require_ai_service_token)])
def chat_endpoint(request: ChatRequest):
    if any(message.role not in {"user", "assistant"} for message in request.messages):
        raise HTTPException(status_code=400, detail="Invalid chat message role.")
    try:
        reply = chat_reply(
            request.system_prompt,
            [message.model_dump() for message in request.messages],
        )
        return {"reply": reply}
    except AIServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
