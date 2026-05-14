"""
app/models/models.py
Modelos SQLAlchemy que mapean exactamente el esquema diseñado
en la arquitectura de PrecioSV.
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, List

from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, ForeignKey,
    Integer, Numeric, String, Text, UniqueConstraint,
    Computed, Index,
)
from sqlalchemy.orm import relationship, Mapped, mapped_column

from app.db.database import Base


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ═══════════════════════════════════════════════════════════
# SUPERMERCADOS
# ═══════════════════════════════════════════════════════════
class Supermercado(Base):
    __tablename__ = "supermercados"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), nullable=False)
    nombre_corto: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    url_base: Mapped[Optional[str]] = mapped_column(Text)
    plataforma: Mapped[Optional[str]] = mapped_column(String(50))   # 'vtex', 'custom'
    logo_url: Mapped[Optional[str]] = mapped_column(Text)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    # Relaciones
    variantes: Mapped[List["ProductoVariante"]] = relationship(back_populates="supermercado")
    ejecuciones: Mapped[List["EjecucionScraper"]] = relationship(back_populates="supermercado")

    def __repr__(self) -> str:
        return f"<Supermercado {self.nombre_corto}>"


# ═══════════════════════════════════════════════════════════
# CATEGORÍAS (árbol jerárquico)
# ═══════════════════════════════════════════════════════════
class Categoria(Base):
    __tablename__ = "categorias"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categorias.id"), nullable=True)
    icono: Mapped[Optional[str]] = mapped_column(String(50))

    # Relaciones
    padre: Mapped[Optional["Categoria"]] = relationship(
        "Categoria", remote_side="Categoria.id", back_populates="hijos"
    )
    hijos: Mapped[List["Categoria"]] = relationship("Categoria", back_populates="padre")
    productos: Mapped[List["Producto"]] = relationship(back_populates="categoria")

    def __repr__(self) -> str:
        return f"<Categoria {self.slug}>"


# ═══════════════════════════════════════════════════════════
# PRODUCTOS (identidad normalizada)
# ═══════════════════════════════════════════════════════════
class Producto(Base):
    __tablename__ = "productos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nombre_normalizado: Mapped[str] = mapped_column(String(300), nullable=False)
    marca: Mapped[Optional[str]] = mapped_column(String(100))
    categoria_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categorias.id"))
    descripcion: Mapped[Optional[str]] = mapped_column(Text)
    imagen_url: Mapped[Optional[str]] = mapped_column(Text)
    ean: Mapped[Optional[str]] = mapped_column(String(20), index=True)   # código de barras
    unidad: Mapped[Optional[str]] = mapped_column(String(20))            # 'g', 'ml', 'unidad'
    cantidad: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2))  # 500 → 500g
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )

    # Relaciones
    categoria: Mapped[Optional[Categoria]] = relationship(back_populates="productos")
    variantes: Mapped[List["ProductoVariante"]] = relationship(back_populates="producto")
    alertas: Mapped[List["AlertaUsuario"]] = relationship(back_populates="producto")

    # Índice full-text para búsqueda (creado manualmente en migración)
    __table_args__ = (
        Index("ix_productos_nombre_fts", "nombre_normalizado", postgresql_using="gin",
              postgresql_ops={"nombre_normalizado": "gin_trgm_ops"}),
    )

    def __repr__(self) -> str:
        return f"<Producto {self.nombre_normalizado[:40]}>"


# ═══════════════════════════════════════════════════════════
# VARIANTES (nombre local por supermercado)
# ═══════════════════════════════════════════════════════════
class ProductoVariante(Base):
    __tablename__ = "producto_variantes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("productos.id"), nullable=False)
    supermercado_id: Mapped[int] = mapped_column(ForeignKey("supermercados.id"), nullable=False)
    nombre_local: Mapped[Optional[str]] = mapped_column(String(300))
    sku_local: Mapped[Optional[str]] = mapped_column(String(100))
    url_producto: Mapped[Optional[str]] = mapped_column(Text)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relaciones
    producto: Mapped[Producto] = relationship(back_populates="variantes")
    supermercado: Mapped[Supermercado] = relationship(back_populates="variantes")
    precios: Mapped[List["Precio"]] = relationship(back_populates="variante",
                                                    order_by="Precio.fecha_hora.desc()")

    __table_args__ = (
        UniqueConstraint("supermercado_id", "sku_local", name="uq_variante_super_sku"),
    )

    def __repr__(self) -> str:
        return f"<Variante {self.supermercado_id}:{self.sku_local}>"


# ═══════════════════════════════════════════════════════════
# PRECIOS (histórico — el corazón del sistema)
# ═══════════════════════════════════════════════════════════
class Precio(Base):
    __tablename__ = "precios"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    variante_id: Mapped[int] = mapped_column(ForeignKey("producto_variantes.id"), nullable=False)
    precio_normal: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    precio_oferta: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2))
    en_oferta: Mapped[bool] = mapped_column(Boolean, default=False)
    descuento_pct: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    disponible: Mapped[bool] = mapped_column(Boolean, default=True)
    condicion_oferta: Mapped[Optional[str]] = mapped_column(String(200))  # "2x1", "50% 2do"
    fecha_hora: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )

    # Relaciones
    variante: Mapped[ProductoVariante] = relationship(back_populates="precios")

    __table_args__ = (
        Index("ix_precios_variante_fecha", "variante_id", "fecha_hora"),
        Index("ix_precios_fecha", "fecha_hora"),
        Index("ix_precios_oferta", "en_oferta"),
    )

    def __repr__(self) -> str:
        return f"<Precio variante={self.variante_id} {self.precio_normal}>"


# ═══════════════════════════════════════════════════════════
# USUARIOS
# ═══════════════════════════════════════════════════════════
class Usuario(Base):
    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    nombre: Mapped[Optional[str]] = mapped_column(String(100))
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="usuario")  # admin|proveedor|usuario
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    proveedor_id: Mapped[Optional[int]] = mapped_column(ForeignKey("proveedores.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    ultimo_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Relaciones
    alertas: Mapped[List["AlertaUsuario"]] = relationship(back_populates="usuario")
    proveedor: Mapped[Optional["Proveedor"]] = relationship(back_populates="usuarios")

    def __repr__(self) -> str:
        return f"<Usuario {self.email}>"


# ═══════════════════════════════════════════════════════════
# PROVEEDORES / FABRICANTES
# ═══════════════════════════════════════════════════════════
class Proveedor(Base):
    __tablename__ = "proveedores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nombre: Mapped[str] = mapped_column(String(200), nullable=False)
    ruc: Mapped[Optional[str]] = mapped_column(String(50))             # Registro Único Contribuyente
    contacto_email: Mapped[Optional[str]] = mapped_column(String(255))
    plan: Mapped[str] = mapped_column(String(30), default="basic")     # basic|pro|enterprise
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    # Relaciones
    usuarios: Mapped[List[Usuario]] = relationship(back_populates="proveedor")
    marcas_monitoreadas: Mapped[List["ProveedorMarca"]] = relationship(back_populates="proveedor")
    alertas_b2b: Mapped[List["AlertaB2B"]] = relationship(back_populates="proveedor")

    def __repr__(self) -> str:
        return f"<Proveedor {self.nombre}>"


class ProveedorMarca(Base):
    """Marcas que un proveedor monitorea."""
    __tablename__ = "proveedor_marcas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    proveedor_id: Mapped[int] = mapped_column(ForeignKey("proveedores.id"), nullable=False)
    marca: Mapped[str] = mapped_column(String(100), nullable=False)
    es_propia: Mapped[bool] = mapped_column(Boolean, default=True)    # True=mi marca, False=competencia

    proveedor: Mapped[Proveedor] = relationship(back_populates="marcas_monitoreadas")

    __table_args__ = (
        UniqueConstraint("proveedor_id", "marca", name="uq_proveedor_marca"),
    )


# ═══════════════════════════════════════════════════════════
# ALERTAS DE USUARIO (B2C)
# ═══════════════════════════════════════════════════════════
class AlertaUsuario(Base):
    __tablename__ = "alertas_usuario"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), nullable=False)
    producto_id: Mapped[int] = mapped_column(ForeignKey("productos.id"), nullable=False)
    precio_objetivo: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    supermercado_id: Mapped[Optional[int]] = mapped_column(ForeignKey("supermercados.id"))
    activa: Mapped[bool] = mapped_column(Boolean, default=True)
    notificada: Mapped[bool] = mapped_column(Boolean, default=False)
    ultima_notificacion: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    # Relaciones
    usuario: Mapped[Usuario] = relationship(back_populates="alertas")
    producto: Mapped[Producto] = relationship(back_populates="alertas")

    def __repr__(self) -> str:
        return f"<AlertaUsuario usuario={self.usuario_id} producto={self.producto_id}>"


# ═══════════════════════════════════════════════════════════
# ALERTAS B2B (para proveedores)
# ═══════════════════════════════════════════════════════════
class AlertaB2B(Base):
    __tablename__ = "alertas_b2b"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    proveedor_id: Mapped[int] = mapped_column(ForeignKey("proveedores.id"), nullable=False)
    tipo: Mapped[str] = mapped_column(String(50), nullable=False)
    # tipos: oferta_competencia | precio_minimo | posicion_perdida | sin_stock_competidor
    marca_competidor: Mapped[Optional[str]] = mapped_column(String(100))
    supermercado_id: Mapped[Optional[int]] = mapped_column(ForeignKey("supermercados.id"))
    umbral_descuento_pct: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    activa: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    proveedor: Mapped[Proveedor] = relationship(back_populates="alertas_b2b")


# ═══════════════════════════════════════════════════════════
# EJECUCIONES DE SCRAPER (log de auditoría)
# ═══════════════════════════════════════════════════════════
class EjecucionScraper(Base):
    __tablename__ = "ejecuciones_scraper"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supermercado_id: Mapped[int] = mapped_column(ForeignKey("supermercados.id"), nullable=False)
    inicio: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    fin: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    estado: Mapped[str] = mapped_column(String(20), default="en_progreso")
    # estados: en_progreso | completado | error | timeout
    productos_encontrados: Mapped[int] = mapped_column(Integer, default=0)
    productos_nuevos: Mapped[int] = mapped_column(Integer, default=0)
    productos_actualizados: Mapped[int] = mapped_column(Integer, default=0)
    errores: Mapped[int] = mapped_column(Integer, default=0)
    mensaje_error: Mapped[Optional[str]] = mapped_column(Text)
    duracion_segundos: Mapped[Optional[int]] = mapped_column(Integer)

    supermercado: Mapped[Supermercado] = relationship(back_populates="ejecuciones")

    def __repr__(self) -> str:
        return f"<EjecucionScraper {self.supermercado_id} {self.estado}>"
