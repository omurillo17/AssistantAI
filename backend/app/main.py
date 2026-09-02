import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.db import close_pool, init_pool
from app.oauth_store import CredencialesNoEncontradas
from app.routers import citas, documentos, eventos_calendario, meta_whatsapp, whatsapp
from app.scheduler import start_scheduler, stop_scheduler

# uvicorn no configura el logging raíz por defecto; sin esto, logger.info()
# en scheduler.py y otros módulos queda silenciado (root logger a WARNING).
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    start_scheduler()
    yield
    stop_scheduler()
    await close_pool()


app = FastAPI(title="Virgo Backend", lifespan=lifespan)

app.include_router(eventos_calendario.router)
app.include_router(citas.router)
app.include_router(documentos.router)
app.include_router(whatsapp.router)
app.include_router(meta_whatsapp.router)


@app.exception_handler(CredencialesNoEncontradas)
async def credenciales_no_encontradas_handler(request: Request, exc: CredencialesNoEncontradas):
    return JSONResponse(status_code=424, content={"error": str(exc)})


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
