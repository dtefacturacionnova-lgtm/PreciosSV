"""
app/services/matching_service.py
Product matching usando Claude API.
Determina si un producto nuevo es el mismo que uno ya existente en BD,
aunque el nombre varíe entre supermercados.

Ejemplo:
  "Leche Entera LALA 1L"  ==  "Leche LALA 1 Litro"  ==  "LALA Leche 1000ml"
"""
from typing import Optional

import anthropic

from app.core.config import settings
from app.core.logging import get_logger

# Cliente asíncrono — el síncrono bloqueaba el event loop de uvicorn

logger = get_logger(__name__)

# Prompt del sistema: conciso y determinista
SYSTEM_PROMPT = """Eres un asistente experto en productos de supermercado de El Salvador.
Tu única tarea es determinar si un producto nuevo es EXACTAMENTE el mismo que alguno de los candidatos dados.

Criterios para ser "el mismo producto":
- Mismo tipo de producto (leche, aceite, refresco, etc.)
- Misma marca (ignora variaciones de mayúsculas)
- Mismo contenido/volumen/peso (500g == 500 gramos, 1L == 1 litro == 1000ml)
- Ignora diferencias menores de redacción o presentación del nombre

Responde ÚNICAMENTE con:
- El número ID del candidato si es el mismo producto
- La palabra NUEVO si no coincide con ningún candidato

No incluyas explicaciones, puntos, ni texto adicional."""


class MatchingService:
    """
    Usa Claude para hacer product matching semántico.
    Diseñado para ser eficiente: solo llama a la API si hay candidatos.
    """

    def __init__(self):
        if settings.matching_enabled and settings.anthropic_api_key:
            self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        else:
            self.client = None

    async def encontrar_match(
        self,
        nombre_nuevo: str,
        marca: str,
        candidatos: list[dict],
    ) -> Optional[int]:
        """
        Retorna el producto_id del candidato que coincide, o None si es nuevo.

        Args:
            nombre_nuevo: Nombre del producto a identificar
            marca: Marca del producto
            candidatos: Lista de dicts con keys: id, nombre, marca
        """
        if not self.client:
            logger.debug("Matching IA desactivado, saltando")
            return None

        if not candidatos:
            return None

        prompt = self._construir_prompt(nombre_nuevo, marca, candidatos)

        try:
            response = await self.client.messages.create(
                model=settings.matching_model,
                max_tokens=20,        # Solo necesitamos un número o "NUEVO"
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )

            respuesta = response.content[0].text.strip()
            logger.debug("Respuesta matching IA", respuesta=respuesta, nombre=nombre_nuevo)

            if respuesta.upper() == "NUEVO":
                return None

            # Intentar parsear como ID
            try:
                match_id = int(respuesta)
                # Verificar que el ID existe en candidatos (seguridad)
                ids_validos = {c["id"] for c in candidatos}
                if match_id in ids_validos:
                    return match_id
                else:
                    logger.warning("IA devolvió ID no válido", id=match_id)
                    return None
            except ValueError:
                logger.warning("IA devolvió respuesta inesperada", respuesta=respuesta)
                return None

        except anthropic.APIError as e:
            logger.error("Error en Claude API", error=str(e))
            return None

    def _construir_prompt(
        self,
        nombre_nuevo: str,
        marca: str,
        candidatos: list[dict],
    ) -> str:
        lineas_candidatos = "\n".join(
            f"ID {c['id']}: \"{c['nombre']}\" - Marca: {c['marca'] or 'sin marca'}"
            for c in candidatos
        )
        return (
            f"Producto nuevo: \"{nombre_nuevo}\" - Marca: {marca or 'sin marca'}\n\n"
            f"Candidatos en base de datos:\n{lineas_candidatos}"
        )

    async def normalizar_nombre(self, nombre: str, marca: str) -> str:
        """
        Normaliza el nombre de un producto a un formato estándar.
        Útil para la primera vez que se inserta un producto.
        Ejemplo: "LALA leche entera 1lt" → "Leche Entera LALA 1L"
        """
        if not self.client:
            return nombre

        try:
            response = await self.client.messages.create(
                model=settings.matching_model,
                max_tokens=100,
                messages=[{
                    "role": "user",
                    "content": (
                        f"Normaliza este nombre de producto de supermercado salvadoreño "
                        f"al formato: 'Tipo Marca Variante Cantidad'.\n"
                        f"Nombre original: \"{nombre}\"\n"
                        f"Marca: \"{marca}\"\n"
                        f"Responde SOLO con el nombre normalizado, sin explicaciones."
                    )
                }],
            )
            normalizado = response.content[0].text.strip()
            logger.debug("Nombre normalizado", original=nombre, normalizado=normalizado)
            return normalizado
        except Exception as e:
            logger.warning("Error normalizando nombre", error=str(e))
            return nombre
