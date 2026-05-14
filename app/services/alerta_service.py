"""
app/services/alerta_service.py
Evalúa alertas de precio y envía notificaciones por email (SendGrid).
Se ejecuta después de cada ciclo de scraping.
"""
from datetime import datetime, timezone
from decimal import Decimal

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.models import AlertaUsuario, Precio, ProductoVariante, Producto, Usuario

logger = get_logger(__name__)


class AlertaService:
    """Evalúa condiciones de alerta y dispara notificaciones."""

    def __init__(self, db: AsyncSession):
        self.db = db
        if settings.sendgrid_api_key:
            self.sg = SendGridAPIClient(settings.sendgrid_api_key)
        else:
            self.sg = None

    async def evaluar_todas(self) -> dict:
        """
        Recorre todas las alertas activas y evalúa si su condición se cumplió.
        Llamado automáticamente al final de cada scrape.
        """
        disparadas = 0
        evaluadas = 0

        # Traer alertas activas con sus relaciones
        result = await self.db.execute(
            select(AlertaUsuario)
            .where(AlertaUsuario.activa == True)
            .join(AlertaUsuario.usuario)
            .join(AlertaUsuario.producto)
        )
        alertas = result.scalars().all()

        for alerta in alertas:
            evaluadas += 1
            precio_actual = await self._obtener_precio_actual(
                alerta.producto_id, alerta.supermercado_id
            )
            if precio_actual is None:
                continue

            precio_efectivo = precio_actual.precio_oferta or precio_actual.precio_normal

            if precio_efectivo <= alerta.precio_objetivo:
                await self._disparar_alerta(alerta, precio_efectivo, precio_actual)
                disparadas += 1

        logger.info("Evaluación de alertas completada",
                    evaluadas=evaluadas, disparadas=disparadas)
        return {"evaluadas": evaluadas, "disparadas": disparadas}

    async def _obtener_precio_actual(
        self,
        producto_id: int,
        supermercado_id: int | None,
    ) -> Precio | None:
        """Obtiene el precio más reciente de un producto."""
        stmt = (
            select(Precio)
            .join(Precio.variante)
            .where(ProductoVariante.producto_id == producto_id)
            .order_by(Precio.fecha_hora.desc())
            .limit(1)
        )
        if supermercado_id:
            stmt = stmt.where(ProductoVariante.supermercado_id == supermercado_id)

        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def _disparar_alerta(
        self,
        alerta: AlertaUsuario,
        precio_actual: Decimal,
        precio_obj: Precio,
    ) -> None:
        """Envía email y actualiza el estado de la alerta."""
        usuario = alerta.usuario
        producto = alerta.producto

        # Marcar como notificada
        alerta.notificada = True
        alerta.ultima_notificacion = datetime.now(timezone.utc)
        # Desactivar para no volver a notificar hasta que suba y baje de nuevo
        alerta.activa = False

        logger.info(
            "Alerta disparada",
            usuario=usuario.email,
            producto=producto.nombre_normalizado,
            precio=str(precio_actual),
        )

        if self.sg:
            await self._enviar_email(usuario, producto, precio_actual, alerta.precio_objetivo)

    async def _enviar_email(
        self,
        usuario: Usuario,
        producto: Producto,
        precio_actual: Decimal,
        precio_objetivo: Decimal,
    ) -> None:
        """Envía email de notificación via SendGrid."""
        ahorro_vs_normal = ""

        asunto = f"🔔 PrecioSV: {producto.nombre_normalizado} bajó a ${precio_actual}"

        html = f"""
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">

          <div style="background: linear-gradient(135deg, #059669, #0d9488);
                      padding: 24px; border-radius: 12px; text-align: center; margin-bottom: 24px;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🛒 PrecioSV</h1>
            <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0;">Tu alerta de precio se activó</p>
          </div>

          <div style="background: #f0fdf4; border: 2px solid #059669;
                      border-radius: 12px; padding: 20px; margin-bottom: 20px;">
            <h2 style="color: #064e3b; margin: 0 0 12px;">{producto.nombre_normalizado}</h2>
            <p style="color: #6b7280; margin: 0 0 16px;">{producto.marca or ''}</p>

            <div style="display: flex; gap: 16px; justify-content: center;">
              <div style="text-align: center;">
                <div style="color: #6b7280; font-size: 12px;">Tu objetivo era</div>
                <div style="color: #374151; font-size: 20px; font-weight: bold;">
                  ${precio_objetivo}
                </div>
              </div>
              <div style="text-align: center; font-size: 24px; color: #059669;">→</div>
              <div style="text-align: center;">
                <div style="color: #6b7280; font-size: 12px;">Precio actual</div>
                <div style="color: #059669; font-size: 28px; font-weight: 800;">
                  ${precio_actual}
                </div>
              </div>
            </div>
          </div>

          <div style="text-align: center; margin-bottom: 24px;">
            <a href="https://preciosv.com/producto/{producto.id}"
               style="background: #059669; color: white; padding: 12px 28px;
                      border-radius: 8px; text-decoration: none; font-weight: bold;
                      display: inline-block;">
              Ver comparativa completa →
            </a>
          </div>

          <p style="color: #9ca3af; font-size: 11px; text-align: center;">
            Recibes este email porque configuraste una alerta en PrecioSV.<br>
            <a href="https://preciosv.com/alertas" style="color: #059669;">
              Gestionar mis alertas
            </a>
          </p>
        </body>
        </html>
        """

        message = Mail(
            from_email=(settings.email_from, settings.email_from_name),
            to_emails=usuario.email,
            subject=asunto,
            html_content=html,
        )

        try:
            self.sg.send(message)
            logger.info("Email enviado", destinatario=usuario.email)
        except Exception as e:
            logger.error("Error enviando email", error=str(e), destinatario=usuario.email)
