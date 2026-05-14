"""
app/api/v1/endpoints/auth.py
Registro, login y gestión de usuarios.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    hash_password, verify_password,
    create_access_token, get_current_user,
)
from app.db.database import get_db
from app.models.models import Usuario
from app.schemas.schemas import LoginRequest, TokenOut, UsuarioCreate, UsuarioOut

router = APIRouter(prefix="/auth", tags=["Autenticación"])


@router.post("/registro", response_model=UsuarioOut, status_code=201)
async def registro(payload: UsuarioCreate, db: AsyncSession = Depends(get_db)):
    """Registra un nuevo usuario (rol: usuario por defecto)."""
    existente = await db.execute(
        select(Usuario).where(Usuario.email == payload.email)
    )
    if existente.scalar_one_or_none():
        raise HTTPException(409, "El email ya está registrado")

    usuario = Usuario(
        email=payload.email,
        nombre=payload.nombre,
        hashed_password=hash_password(payload.password),
        role="usuario",  # solo admin puede crear proveedores/admins
    )
    db.add(usuario)
    await db.flush()
    return usuario


@router.post("/login", response_model=TokenOut)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Autentica y retorna JWT."""
    result = await db.execute(
        select(Usuario).where(Usuario.email == payload.email)
    )
    usuario = result.scalar_one_or_none()

    if not usuario or not verify_password(payload.password, usuario.hashed_password):
        raise HTTPException(401, "Credenciales incorrectas")

    if not usuario.activo:
        raise HTTPException(403, "Cuenta desactivada")

    # Actualizar último login
    usuario.ultimo_login = datetime.now(timezone.utc)

    token = create_access_token(
        subject=str(usuario.id),
        role=usuario.role,
    )
    return TokenOut(access_token=token, role=usuario.role, nombre=usuario.nombre)


@router.get("/me", response_model=UsuarioOut)
async def perfil(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retorna el perfil del usuario autenticado."""
    result = await db.execute(
        select(Usuario).where(Usuario.id == int(current_user["sub"]))
    )
    usuario = result.scalar_one_or_none()
    if not usuario:
        raise HTTPException(404, "Usuario no encontrado")
    return usuario
