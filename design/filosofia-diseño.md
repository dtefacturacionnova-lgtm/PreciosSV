# Filosofía de Diseño — PreciosSV

## Visión

PreciosSV es la plataforma de referencia para el consumidor salvadoreño que busca tomar decisiones de compra inteligentes. El diseño refleja claridad, confianza y velocidad: el usuario debe encontrar el mejor precio en menos de 10 segundos desde que abre la app.

---

## Principios de Diseño

### 1. Claridad ante todo
La información de precios es el núcleo del producto. Cada elemento visual debe servir para destacar o contextualizar un precio, nunca para distraer. La jerarquía tipográfica lleva al usuario directamente al dato que importa: cuánto cuesta y dónde.

### 2. Confianza institucional
El azul profundo (`#1E40AF`) transmite seriedad y fiabilidad — el mismo lenguaje visual de los bancos digitales y las fintechs latinoamericanas líderes. El usuario debe sentir que los datos son verídicos y actualizados.

### 3. Ahorro como emoción
El verde esmeralda (`#059669`) y el ámbar (`#F59E0B`) se reservan para los momentos de "ganancia": descuentos, badges de oferta, indicadores de mejor precio. El ahorro debe verse y sentirse como un logro.

### 4. Velocidad visual
Layouts de cuadrícula estricta, márgenes amplios y agrupaciones claras permiten escanear rápidamente. Inspirado en el patrón F-scan: logo → búsqueda → filtros → tarjetas.

### 5. Inclusividad latinoamericana
El español salvadoreño es el idioma nativo de la interfaz. Los nombres de supermercados locales (Súper Selectos, Don Juan, Maxi, Familiar) tienen la misma prominencia que las cadenas multinacionales. El diseño respeta la identidad local.

---

## Paleta de Colores

| Rol | Color | Hex |
|-----|-------|-----|
| Primario (marca, CTAs principales) | Azul Profundo | `#1E40AF` |
| Acento positivo (ahorro, descuentos) | Verde Esmeralda | `#059669` |
| Acento de urgencia (ofertas del día) | Ámbar | `#F59E0B` |
| Fondo de página | Slate 100 | `#F1F5F9` |
| Texto principal | Slate 950 | `#0F172A` |
| Texto secundario | Slate 500 | `#64748B` |
| Superficie de tarjeta | Blanco | `#FFFFFF` |
| Sección B2B / footer | Slate 900 | `#0F172A` |

### Supermercados — Indicadores de color

| Supermercado | Color identificador |
|---|---|
| Súper Selectos | `#DC2626` (rojo) |
| Walmart | `#1D4ED8` (azul) |
| Don Juan | `#16A34A` (verde) |
| Maxi Despensa | `#EA580C` (naranja) |
| Familiar | `#7C3AED` (púrpura) |

---

## Tipografía

- **Outfit Bold** — Logotipo, titulares de hero, nombres de producto destacados. Geométrica, moderna, con personalidad latinofintech.
- **Work Sans Regular / Bold** — Cuerpo de texto, precios, etiquetas de filtro, navegación. Altamente legible en pantalla, neutral y profesional.
- **Escala tipográfica:** base 16px, escala de ratio 1.25 (Major Third).

---

## Componentes Clave

### Barra de Navegación
- Fondo blanco con sombra sutil (`box-shadow: 0 1px 3px rgba(0,0,0,0.1)`).
- Logo a la izquierda, buscador centralizado (60% del ancho), acciones a la derecha.
- Altura fija: 64px. Siempre visible (sticky).

### Cards de Producto
- Fondo blanco, radio de borde 12px, sombra `0 2px 8px rgba(0,0,0,0.08)`.
- Imagen del producto: 160×120px, fondo slate-50, centrada.
- Badge de descuento: círculo ámbar posicionado en la esquina superior derecha de la imagen.
- Precio tachado en slate-400, precio de oferta en slate-950 tamaño grande.
- Indicador del supermercado: punto de color + nombre en la parte inferior de la card.

### Filtros de Supermercado
- Pills con borde redondeado total. Estado activo: fondo azul + texto blanco. Estado inactivo: fondo blanco + borde slate-200.
- Transición suave de 150ms en hover.

### Hero Section
- Fondo gradiente de slate-100 a blanco.
- Titular en Outfit Bold 48px, subtítulo en Work Sans 20px slate-500.
- Badge "Hoy" en ámbar para reforzar la urgencia temporal.

### Sección B2B
- Fondo `#0F172A` (slate-950), texto blanco.
- Titular contrastante con acento esmeralda.
- CTA button: fondo esmeralda `#059669`, hover `#047857`.
- Propósito: convertir a proveedores y fabricantes en clientes del modelo de datos/publicidad.

---

## Espaciado y Grid

- Grid de 12 columnas con gutter de 24px.
- Márgenes laterales: 80px en desktop (1440px), 24px en mobile.
- Espaciado interno de componentes: múltiplos de 4px (4, 8, 12, 16, 24, 32, 48).

---

## Identidad Visual — El Logotipo

El logotipo combina dos elementos:
1. **Icono de etiqueta de precio** — vectorial, limpio, reconocible de inmediato.
2. **Wordmark bicolor**: "Precio" en azul profundo `#1E40AF` + "SV" en esmeralda `#059669`.

La separación cromática entre "Precio" y "SV" refuerza la identidad nacional (El Salvador) y crea un punto de diferenciación memorable.

---

## Referentes de Diseño

- **Rappi** — densidad de información bien gestionada, affordances claros para acción rápida.
- **MercadoLibre** — confianza visual, jerarquía de precios, badges de oferta.
- **Nubank** — sofisticación cromática, tipografía audaz, experiencia premium accesible.
- **Frávega Argentina** — catálogo de precios claro para mercado latinoamericano.

---

## Accesibilidad

- Contraste mínimo WCAG AA en todos los textos sobre fondos de color.
- Azul `#1E40AF` sobre blanco: ratio 8.6:1 (AAA).
- Verde `#059669` sobre blanco: ratio 4.6:1 (AA).
- Tamaño mínimo de fuente en producción: 14px.
- Todos los elementos interactivos con área mínima de 44×44px (touch target).

---

*Versión 1.0 — Mayo 2026*
