"""
app/schemas/schemas.py
Schemas Pydantic v2 para validación de entrada y serialización de salida.
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field, model_validator


# ═══════════════════════════════════════════════════════════
# SUPERMERCADOS
# ═══════════════════════════════════════════════════════════
class SupermercadoOut(BaseModel):
    id: int
    nombre: str
    nombre_corto: str
    url_base: Optional[str]
    logo_url: Optional[str]
    activo: bool

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════
# CATEGORÍAS
# ═══════════════════════════════════════════════════════════
class CategoriaOut(BaseModel):
    id: int
    nombre: str
    slug: str
    icono: Optional[str]
    parent_id: Optional[int]

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════
# PRECIOS
# ═══════════════════════════════════════════════════════════
class PrecioOut(BaseModel):
    precio_normal: Decimal
    precio_oferta: Optional[Decimal]
    en_oferta: bool
    descuento_pct: Optional[Decimal]
    disponible: bool
    condicion_oferta: Optional[str]
    fecha_hora: datetime
    supermercado: SupermercadoOut

    model_config = {"from_attributes": True}


class PrecioHistoricoOut(BaseModel):
    fecha_hora: datetime
    precio_normal: Decimal
    precio_oferta: Optional[Decimal]
    en_oferta: bool

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════
# PRODUCTOS
# ═══════════════════════════════════════════════════════════
class ProductoResumen(BaseModel):
    """Para listas y búsquedas — sin histórico completo."""
    id: int
    nombre_normalizado: str
    marca: Optional[str]
    imagen_url: Optional[str]
    unidad: Optional[str]
    cantidad: Optional[Decimal]
    categoria: Optional[CategoriaOut]
    precio_min: Optional[Decimal] = None           # calculado
    precio_max: Optional[Decimal] = None           # calculado
    supermercado_mas_barato: Optional[str] = None  # calculado

    model_config = {"from_attributes": True}


class ProductoComparativa(BaseModel):
    """Detalle con precio actual en cada supermercado."""
    id: int
    nombre_normalizado: str
    marca: Optional[str]
    descripcion: Optional[str]
    imagen_url: Optional[str]
    ean: Optional[str]
    unidad: Optional[str]
    cantidad: Optional[Decimal]
    categoria: Optional[CategoriaOut]
    precios_actuales: List[PrecioOut]              # uno por supermercado

    model_config = {"from_attributes": True}


class ProductoCreate(BaseModel):
    nombre_normalizado: str = Field(min_length=3, max_length=300)
    marca: Optional[str] = Field(None, max_length=100)
    categoria_id: Optional[int] = None
    descripcion: Optional[str] = None
    imagen_url: Optional[str] = None
    ean: Optional[str] = Field(None, max_length=20)
    unidad: Optional[str] = Field(None, max_length=20)
    cantidad: Optional[Decimal] = None


# ═══════════════════════════════════════════════════════════
# AUTENTICACIÓN
# ═══════════════════════════════════════════════════════════
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    nombre: Optional[str]


class UsuarioCreate(BaseModel):
    email: EmailStr
    nombre: Optional[str] = None
    password: str = Field(min_length=8)
    role: str = "usuario"


class UsuarioOut(BaseModel):
    id: int
    email: str
    nombre: Optional[str]
    role: str
    activo: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════
# ALERTAS USUARIO
# ═══════════════════════════════════════════════════════════
class AlertaCreate(BaseModel):
    producto_id: int
    precio_objetivo: Decimal = Field(gt=0)
    supermercado_id: Optional[int] = None   # None = cualquier supermercado


class AlertaOut(BaseModel):
    id: int
    producto: ProductoResumen
    precio_objetivo: Decimal
    activa: bool
    notificada: bool
    ultima_notificacion: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════
# SCRAPERS (admin)
# ═══════════════════════════════════════════════════════════
class EjecucionOut(BaseModel):
    id: int
    supermercado: SupermercadoOut
    inicio: datetime
    fin: Optional[datetime]
    estado: str
    productos_encontrados: int
    productos_nuevos: int
    productos_actualizados: int
    errores: int
    mensaje_error: Optional[str]
    duracion_segundos: Optional[int]

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════
# ANALÍTICAS (admin & proveedor)
# ═══════════════════════════════════════════════════════════
class PuntoInflacion(BaseModel):
    mes: str
    variacion_pct: float
    canasta_valor: Decimal


class ComparativaMarca(BaseModel):
    marca: str
    precio_promedio: Decimal
    posicion_promedio: float
    supermercados_presentes: int
    en_oferta_count: int


class ResumenAdmin(BaseModel):
    total_productos: int
    total_supermercados: int
    total_usuarios: int
    total_proveedores: int
    alertas_activas: int
    ultimo_scrape: Optional[datetime]
    uptime_scrapers: float


# ═══════════════════════════════════════════════════════════
# PAGINACIÓN
# ═══════════════════════════════════════════════════════════
class PaginatedResponse(BaseModel):
    items: list
    total: int
    page: int
    page_size: int
    pages: int

    @model_validator(mode="after")
    def calc_pages(self):
        if self.page_size > 0:
            self.pages = -(-self.total // self.page_size)  # ceil division
        return self
