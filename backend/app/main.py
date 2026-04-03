from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api import projects, documents, extracted_items, dashboard, chat, generate, auth


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup — seed control point templates
    from app.db.session import async_session
    from app.db.seed import seed_control_points
    async with async_session() as db:
        try:
            await seed_control_points(db)
        except Exception:
            pass  # DB might not exist yet during initial setup

    yield

    # Shutdown
    from app.db.session import engine
    await engine.dispose()


app = FastAPI(
    title="Discovery AI Assistant",
    description="AI-powered tool for structured client discovery",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(documents.router)
app.include_router(extracted_items.router)
app.include_router(dashboard.router)
app.include_router(chat.router)
app.include_router(generate.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/")
async def root():
    return {
        "name": "Discovery AI Assistant",
        "version": "0.1.0",
        "docs": "/docs",
    }
