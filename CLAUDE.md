# PreciosSV — Guía de contexto para Claude

> Leer esto al inicio de CADA sesión nueva. Contiene todo el estado del proyecto,
> cómo funciona cada pieza y qué falta construir.

---

## 1. Qué es este proyecto

**PreciosSV** — comparador de precios de supermercados en El Salvador.
Dos productos en uno:

| Producto | URL | Audiencia |
|----------|-----|-----------|
| App consumidor | `/` `/buscar` `/producto/[id]` | Público general |
| Portal B2B proveedores | `/proveedores/dashboard` | Fabricantes / distribuidores |

**Stack real (no el README viejo del backend):**
- **Frontend + API routes:** Next.js (ver `web/AGENTS.md` antes de tocar Next.js — tiene breaking changes)
- **Base de datos:** Supabase (PostgreSQL gestionado)
- **Scrapers:** Python puro — `httpx` para VTEX, `playwright` para Selectos
- **Automatización:** GitHub Actions (cron 2×/día en la nube)
- **IA:** Gemini API key disponible en `.env.local` (aún no usada en producción)

---

## 2. Estructura del repositorio

```
PreciosSV/
├── web/                          # App Next.js
│   ├── src/app/                  # Páginas y API routes
│   │   ├── page.tsx              # Home — ofertas del día
│   │   ├── buscar/page.tsx       # Buscador público
│   │   ├── producto/[id]/        # Detalle + histórico de precios
│   │   ├── auth/login/           # Login (Supabase Auth)
│   │   ├── auth/recovery/        # Reset de contraseña
│   │   ├── proveedores/dashboard/ # Portal B2B
│   │   ├── proveedores/reporte/  # Reporte PDF (window.print)
│   │   └── api/                  # API routes (Next.js)
│   │       ├── buscar/           # GET búsqueda pública
│   │       ├── ofertas/          # GET ofertas activas
│   │       ├── productos/[id]/   # comparativa + historico
│   │       └── proveedores/      # Todos los endpoints B2B
│   ├── src/components/
│   │   ├── proveedores/          # Componentes del portal B2B
│   │   └── ...                   # Componentes consumidor
│   ├── src/lib/supabase/         # Clientes Supabase (client/server/service)
│   └── .env.local                # Secretos locales — NUNCA commitear
├── scripts/
│   ├── scrape_vtex_rest.py       # Scraper Walmart/DonJuan/MaxiDespensa
│   └── scrape_selectos_rest.py   # Scraper Súper Selectos (Playwright)
├── .github/workflows/
│   └── scrapers.yml              # GitHub Actions — cron automático
└── CLAUDE.md                     # ← este archivo
```

---

## 3. Base de datos (Supabase)

**Proyecto Supabase:** `uyilxvplfuverjgjvjmf.supabase.co`

### Tablas principales

| Tabla | Descripción |
|-------|-------------|
| `supermercados` | Catálogo fijo: id, nombre, nombre_corto, logo_url |
| `productos` | Producto canónico cross-store: nombre, ean, marca, imagen |
| `producto_variantes` | Producto en un supermercado específico: sku_local, url, imagen |
| `precios` | Serie temporal: variante_id, precio_normal, precio_oferta, fecha_hora |
| `precios_actuales` | **Vista materializada** — último precio por variante |

### IDs de supermercados en BD

```
selectos     = 1
walmart      = 2
donjuan      = 3
maxidespensa = 4
familiar     = 5   ← existe en BD pero NO tiene scraper propio
pricesmart   = 6   ← existe en BD pero NO tiene scraper aún
```

### Función SQL importante

```sql
SELECT refrescar_precios_actuales();
-- Refresca la vista materializada precios_actuales
-- Se llama al final de cada run de scraper via RPC
```

---

## 4. Variables de entorno

### `web/.env.local` (local, gitignoreado)

```env
NEXT_PUBLIC_SUPABASE_URL=https://uyilxvplfuverjgjvjmf.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...  # anon key
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # service role — acceso total a BD
GEMINI_API_KEY=AIza...                 # Google Gemini — disponible, no usado aún
SELECTOS_EMAIL=jsiguenzatorres@gmail.com
SELECTOS_PASSWORD=Morena6399$
```

### GitHub Secrets (Settings → Secrets → Actions)

```
NEXT_PUBLIC_SUPABASE_URL      ✅ configurado
SUPABASE_SERVICE_ROLE_KEY     ✅ configurado
SELECTOS_EMAIL                ✅ configurado
SELECTOS_PASSWORD             ✅ configurado
```

**Los scrapers leen .env.local en local y env vars en CI — mismo código, sin cambios.**

---

## 5. Scrapers — cómo funciona cada uno

### 5.1 VTEX — `scripts/scrape_vtex_rest.py`

**Supermercados:** Walmart, La Despensa de Don Juan, Maxi Despensa  
**Tecnología:** HTTPX (puro HTTP, sin navegador)

**Cómo funciona:**
```
GET {base_url}/api/catalog_system/pub/products/search
  ?_from=0&_to=49&O=OrderByTopSaleDESC&map=c
```
- Paginación de 50 en 50, hasta 3000 productos por tienda
- El endpoint es la API REST pública de VTEX — no requiere auth
- Devuelve JSON con `productId`, `productName`, `brand`, `items[].ean`, 
  `items[].sellers[].commertialOffer.Price` / `ListPrice`

**Gotchas:**
- `ListPrice` = precio normal (sin oferta); `Price` = precio de venta actual
- Si `Price < ListPrice` → en oferta
- `familiar` (`despensafamiliar.com.sv`) **no existe** — opera bajo Maxi Despensa, no scraperear por separado
- Extraer EAN de `items[0].referenceId` buscando Key == "EAN" | "GTIN" | "EAN13"

**Persistencia:**
1. Pre-cargar variantes existentes del supermercado en memoria (evita N+1)
2. Pre-cargar productos por EAN en memoria
3. Para cada producto: buscar por EAN → buscar por nombre_normalizado → crear nuevo
4. Upsert `producto_variantes` ON CONFLICT(supermercado_id, sku_local)
5. Batch-insert `precios` en chunks de 200

---

### 5.2 Selectos — `scripts/scrape_selectos_rest.py`

**Supermercado:** Súper Selectos  
**Tecnología:** Playwright + Chromium (navegador headless)

**Por qué no es HTTPX:**  
El sitio usa **Blazor Server 8 con SignalR**. El contenido se renderiza mediante
protocolo binario RenderBatch sobre WebSocket — no hay REST API pública ni JSON
interceptable. Se debe extraer del DOM una vez renderizado.

**URL patrón correcto:**
```
https://www.superselectos.com/products?category=XXXX
```
- `XXXX` = código numérico de categoría (ej: `0101`, `03695`, `0311129`)
- ⚠️ NO usar `/Tienda/Catalogo/NombreCategoria` — causa redirect 302 a `/404`
- ⚠️ NO usar `page.goto()` para navegar dentro del sitio — usar `Blazor.navigateTo()`

**Cómo funciona el crawler:**

```python
# 1. Inicializar Blazor en la home (OBLIGATORIO antes de navegar)
await page.goto("https://www.superselectos.com/", wait_until="load", timeout=90_000)
await asyncio.sleep(10)

# 2. Login opcional (activa catálogo completo)
await _login(page)

# 3. Crawl de categorías (breadth-first)
cats_pendientes = ["0101", "0201", ..., "03695", "01634", "042159"]
while cats_pendientes:
    cat_id = cats_pendientes.pop(0)
    await page.evaluate(f"Blazor.navigateTo('/products?category={cat_id}')")
    # Esperar productos → scrollear → extraer DOM → descubrir nuevas cats
```

**Selector de productos:**
```css
.producto-box                          /* contenedor por producto */
h5.prod-nombre a                       /* nombre + href con productId= */
strong.precio                          /* precio normal */
.precio-oferta, .precio-tachado        /* precio tachado (oferta) */
a[href*="category="]                   /* links para descubrir sub-categorías */
```

**Login — detalles críticos:**
- Radzen Blazor renderiza el input email como `type="text"` (no `type="email"`)
- Localizar el email con JS: input text visible JUSTO ANTES del `input[type="password"]` en el DOM
- El botón submit dice exactamente **"Iniciar Sesión"** (no "Ingresar", no "Entrar")
- Verificar login exitoso buscando "Cerrar sesión" | "Mi cuenta" en `document.body.innerText`

```python
# Selector correcto para el email (Radzen renderiza como type=text)
email_handle = await page.evaluate_handle("""() => {
    const passInput = document.querySelector("input[type='password']");
    const allInputs = Array.from(document.querySelectorAll("input"));
    const passIdx   = allInputs.indexOf(passInput);
    for (let i = passIdx - 1; i >= 0; i--) {
        const inp = allInputs[i];
        if ((inp.type === 'text' || inp.type === 'email') && inp.offsetParent !== null)
            return inp;
    }
    return null;
}""")
```

**Resultados típicos por run (con paginación completa):**
- ~1,500–2,000+ productos únicos
- ~100–130 categorías visitadas (BFS desde home)
- ~90–120 minutos de scraping (MAX_PAGES_PER_CAT=8 default en CI)
- ~10 min de guardado en Supabase

**Run local sin límite (SELECTOS_MAX_PAGES env var):**
- Se puede aumentar para scrapear más páginas por categoría

**Persistencia:** igual al VTEX pero sin `disponible` en `producto_variantes`
(la columna `disponible` solo existe en `precios`, no en `producto_variantes`)

---

## 6. GitHub Actions — Automatización

**Archivo:** `.github/workflows/scrapers.yml`

**Cron:** `0 12,0 * * *` = 12:00 UTC y 00:00 UTC = **6am y 6pm El Salvador (UTC-6)**

**La máquina del usuario NO necesita estar encendida** — corre en Ubuntu runners de GitHub.

### Jobs (en paralelo)

```
scrape-vtex     → ubuntu-22.04, timeout 30min
                  pip install httpx
                  python scripts/scrape_vtex_rest.py

scrape-selectos → ubuntu-22.04, timeout 30min
                  pip install httpx playwright
                  python -m playwright install --with-deps chromium
                  python scripts/scrape_selectos_rest.py

normalizar      → needs: [scrape-vtex, scrape-selectos] (si al menos uno OK)
                  pip install httpx google-generativeai
                  python scripts/normalizar_productos.py

alertas-whatsapp → needs: [normalizar]  ← PENDIENTE (ver sección 8a)
                   pip install httpx
                   python scripts/enviar_alertas_whatsapp.py

notificar       → siempre corre (if: always()), reporta resultado de todos los jobs
```

### Dispatch manual (workflow_dispatch)

```python
# Via GitHub API (Python):
# TOKEN = obtener con: git credential fill <<< "protocol=https\nhost=github.com\n"
import httpx
httpx.post(
    "https://api.github.com/repos/dtefacturacionnova-lgtm/PreciosSV/actions/workflows/scrapers.yml/dispatches",
    headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"},
    json={"ref": "main"}
)
# 204 = éxito

# Via gh CLI:
gh workflow run scrapers.yml --repo dtefacturacionnova-lgtm/PreciosSV
```

### Monitorear runs via API

```python
import httpx
# Obtener token: python -c "import subprocess; r=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',capture_output=True,text=True); print(r.stdout)"
TOKEN = "<github-pat-del-credential-store>"
REPO  = "dtefacturacionnova-lgtm/PreciosSV"

# Últimos runs
r = httpx.get(f"https://api.github.com/repos/{REPO}/actions/runs",
              headers={"Authorization": f"Bearer {TOKEN}"}, params={"per_page": 5})

# Jobs de un run específico
r = httpx.get(f"https://api.github.com/repos/{REPO}/actions/runs/{RUN_ID}/jobs",
              headers={"Authorization": f"Bearer {TOKEN}"})
```

---

## 7. Portal B2B Proveedores

**Ruta:** `/proveedores/dashboard`  
**Auth:** Supabase Auth con rol `proveedor` (tabla `proveedores` en BD)

### Tabs del dashboard

| Tab | Componente | Descripción |
|-----|-----------|-------------|
| `catalogo` | `TablaProductos` | Productos del proveedor en cada supermercado |
| `cumplimiento` | `CumplimientoPrecios` | Desvíos respecto al PVP sugerido |
| `mercado` | `InteligenciaMercado` | Análisis de competencia y tendencias |
| `recomendaciones` | `RecomendacionesPrecio` | Sugerencias de ajuste de precio |
| `micatalogo` | `MiCatalogo` | Gestión del catálogo propio |

### Otros componentes en `/components/proveedores/`

- `AnaliticasPrecio` — gráficos de evolución
- `TendenciasPrecios` — tendencias de mercado
- `AlertasCompetencia` — alertas cuando competidor baja precio
- `AnomaliasPrecios` — detección de precios atípicos
- `RiesgoCompetitivo` — scoring de riesgo por producto
- `PromocionesAnalytica` — análisis de promociones (F3 ✅)
- `GestionCategorias` — gestión de categorías (F3 ✅)
- `ComparativaCatalogo` — comparativa cross-supermercado

### Reporte PDF

**Ruta:** `/proveedores/reporte`  
Usa `window.print()` con `@media print` CSS. No requiere librería externa.

---

## 8. Estado de desarrollo por fases

### ✅ F1 — Infraestructura base
- Supabase schema + vista materializada `precios_actuales`
- Scrapers VTEX (Walmart / Don Juan / Maxi Despensa) y Selectos
- Guard anti-duplicados en scrapers (ventana 6h)
- GitHub Actions 2×/día (pipeline: vtex + selectos → normalizar → alertas → notificar)
- App consumidor (home, búsqueda, detalle, histórico)

### ✅ F2 — Portal B2B básico
- Auth proveedores
- Dashboard con métricas y tabla de productos
- APIs `/api/proveedores/*`

### ✅ F3 — Analytics avanzado
- Trade Promotion Analytics (`PromocionesAnalytica`)
- Category Management (`GestionCategorias`)
- Exportar a PDF (`/proveedores/reporte`)

### 🔄 F4 — IA & Diferenciación (en curso)

| Feature | Estado | Complejidad | Notas |
|---------|--------|------------|-------|
| Normalización NLP cross-store | ✅ Listo | Media | Gemini 1.5 Flash, batches de 20, --dry-run |
| Simulador de guerra de precios | ✅ Listo | Media | Slider + métricas + Recharts, elasticidad −1.5 |
| Alertas por WhatsApp | ❌ Pendiente | Media | **Ver sección 8a — Meta Cloud API** |
| Calendario predictivo de promociones | ❌ Pendiente | Alta | Necesita histórico acumulado ≥3 meses + Gemini |
| Cobertura geográfica por sucursales | ❌ Pendiente | Media | **Redefinida** — mapa de sucursales por cadena (ver sección 8b) |

### ❌ F4b — Scrapers pendientes

| Supermercado | ID BD | Estado | Notas |
|---|---|---|---|
| PriceSmart | 6 | ❌ Sin scraper | Sitio: `pricesmart.com/sv` — analizar tecnología antes de implementar |
| Familiar | 5 | ⏭️ Omitir | Opera bajo Maxi Despensa — mismos precios, no scraperear por separado |

### 🔄 F4c — Mejoras UX App Consumidor (en curso)

Mejoras priorizadas para el usuario final de la app pública.

#### ✅ Implementadas (sesión 2026-05-18)
- **Link externo a tienda** — icono en `TarjetaOferta` que abre el producto en el supermercado
- **Botón Compartir** — Web Share API + fallback clipboard en tarjetas y detalle de producto
- **Categoría clicable** — breadcrumb y tag de categoría en detalle filtran búsqueda

#### ✅ Implementadas (sesión 2026-05-29)
- **Canasta inteligente** — `/canasta` + `/api/canasta` + `CanastaContext` (localStorage)
  - Botón "+" en TarjetaOferta, TarjetaProductoBusqueda y página de detalle
  - Badge contador en Navbar
  - Ranking de tiendas por precio total con % de cobertura
  - Sugerencia de split (compra en 2 tiendas si ahorra ≥$0.50)
  - Controles de cantidad, eliminar, vaciar canasta
  - Estado persistido en localStorage
- **Fix bug TS**: `PromocionesAnalytica.tsx` línea 177 — `c.catalogo_id` → `i` (index)

#### ❌ Pendientes (ordenadas por impacto)

| # | Feature | Complejidad | Notas |
|---|---------|------------|-------|
| 5 | **Páginas de categoría** `/categoria/[slug]` | Baja | Landing con mejores ofertas por categoría. Emojis ya en BD |
| 6 | **Búsqueda visible en móvil** | Baja | Navbar search oculto en `sm:`. Agregar ícono de búsqueda o barra visible en todas las pantallas |
| 7 | **Sección "Más buscado hoy"** en home | Media | Top 6–8 productos más vistos en últimas 24h (requiere tabla `visitas` o analytics) |
| 8 | **Alertas de precio para consumidor** | Media | Input: producto + precio objetivo. Avisa por email o WhatsApp cuando baja del umbral. Tabla `alertas_usuario` ya existe en BD |
| 9 | **Comparar productos lado a lado** | Alta | Seleccionar 2–3 productos → tabla comparativa paralela (precios + histórico) |
| 10 | **Trending / Historial de búsquedas** | Alta | Requiere autenticación consumidor o storage anónimo |
| 11 | **Botón "Crear alerta" funcional** | Baja | Ya existe el botón en detalle — conectarlo a tabla `alertas_usuario` con email |

#### Notas de implementación

**Canasta inteligente (prioridad alta):**
```
/api/canasta  POST { productos: [{id, cantidad}] }
→ Para cada tienda: suma precio_efectivo de cada producto
→ Retorna ranking de tiendas por total + ahorro vs. opción más cara
→ También sugiere "split" óptimo si vale la pena ir a 2 tiendas
```

**Páginas de categoría (fácil de implementar):**
```
/categoria/[slug]/page.tsx
→ Reutiliza buscar/page.tsx con filtro categoria pre-aplicado
→ SEO-friendly: "Mejores precios en Lácteos — El Salvador"
```

### ❌ F5 — Platform & Ecosystem (NO iniciada)

| Feature | Complejidad | Notas |
|---------|------------|-------|
| REST API pública con auth tokens | Media | Para clientes enterprise |
| Webhooks push a sistemas cliente | Media | |
| Benchmarking vs industria regional | Alta | Requiere datos de otros países |
| Modelo freemium / suscripciones | Alta | Stripe + lógica de planes |
| Expansión Centroamérica | Alta | Scrapers nuevos por país |

---

## 8a. Plan: Alertas por WhatsApp (Meta Cloud API)

### Prerrequisitos — lo que hay que obtener UNA VEZ

| Ítem | Dónde | Estado |
|------|-------|--------|
| Facebook Business Manager verificado | business.facebook.com | ❓ Confirmar |
| WhatsApp Business Account (WABA) | Meta for Developers | ❓ Confirmar |
| Número de teléfono dedicado | Cualquier línea SV sin WhatsApp activo | ❓ Confirmar |
| `WHATSAPP_TOKEN` (token permanente) | Meta → System User con rol Admin | ❓ Confirmar |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta for Developers → Phone Numbers | ❓ Confirmar |
| Template aprobado `alerta_oferta` | Meta → Message Templates (1-2 días revisión) | ❓ Confirmar |

### Secrets a agregar en GitHub

```
WHATSAPP_TOKEN           ← token permanente de Meta
WHATSAPP_PHONE_NUMBER_ID ← ID del número remitente
```

### Cambios en BD necesarios

```sql
-- Número WhatsApp por proveedor (opt-in explícito)
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS whatsapp_numero TEXT;

-- Registro de alertas ya enviadas (evita reenviar la misma oferta)
CREATE TABLE IF NOT EXISTS alertas_enviadas (
  id            BIGSERIAL PRIMARY KEY,
  proveedor_id  BIGINT       NOT NULL REFERENCES proveedores(id),
  variante_id   BIGINT       NOT NULL,
  canal         TEXT         NOT NULL DEFAULT 'whatsapp',
  enviado_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alertas_enviadas_lookup
  ON alertas_enviadas (proveedor_id, variante_id, enviado_at);
```

### Template Meta (ejemplo — nombre: `alerta_oferta`)

```
🔔 *Alerta de competencia — PreciosSV*

Tu competidor *{{1}}* lanzó una oferta:
• Producto: {{2}}
• Precio oferta: ${{3}} (antes ${{4}}, -{{5}}%)
• Supermercado: {{6}}

Ver dashboard: https://preciosv.com/proveedores/dashboard
```

### Archivos a crear

```
scripts/enviar_alertas_whatsapp.py    ← script Python (corre en GitHub Actions)
```

### Posición en el pipeline de Actions

```
scrape-vtex ─┐
              ├── normalizar ── alertas-whatsapp ── notificar
scrape-selectos ─┘
```

El job `alertas-whatsapp`:
- Requiere `needs: [normalizar]`
- Solo corre si al menos un scraper tuvo éxito
- `pip install httpx` (sin dependencias extra — Meta API es REST puro)
- Solo envía alertas con `estado = 'nueva'` (≤48h) para no hacer spam

---

## 8b. Plan: Cobertura geográfica por sucursales (feature redefinida)

### Por qué no "precios por sucursal"
Ningún super salvadoreño expone precios diferenciados por sucursal — tienen un
catálogo nacional único. Intentarlo requeriría acceso directo a sus sistemas internos.

### Qué sí es posible: mapa de presencia por cadena
Los localizadores de sucursales son **datos públicos** en los sitios de cada super.
La feature redefinida muestra al proveedor:

> *"Walmart tiene 14 sucursales activas: 8 en San Salvador, 3 en La Libertad…
> Tus productos están en esta cadena → cobertura estimada: ~350,000 personas"*

### Datos a obtener (scraping puntual, no diario)

| Super | Fuente | Tecnología |
|---|---|---|
| Walmart SV | `walmart.com.sv/tiendas` | HTML estático o JSON interno |
| Súper Selectos | `superselectos.com/sucursales` | Blazor (ya tenemos el scraper) |
| Don Juan | Sitio web o Google Maps API | HTML o Places API |
| Maxi Despensa | Sitio web | HTML |
| PriceSmart | `pricesmart.com/sv/stores` | HTML |

### Tabla en BD

```sql
CREATE TABLE IF NOT EXISTS sucursales (
  id              BIGSERIAL PRIMARY KEY,
  supermercado_id INT         NOT NULL REFERENCES supermercados(id),
  nombre          TEXT        NOT NULL,
  departamento    TEXT,
  municipio       TEXT,
  direccion       TEXT,
  latitud         NUMERIC(9,6),
  longitud        NUMERIC(9,6),
  activa          BOOLEAN     DEFAULT TRUE,
  actualizado_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Script a crear

```
scripts/scrape_sucursales.py   ← run manual (datos no cambian seguido)
```

---

## 9. Gotchas y trampas conocidas

| Problema | Causa | Solución |
|----------|-------|----------|
| Selectos: 0 productos | Se usó `page.goto('/Tienda/...')` | Usar `Blazor.navigateTo('/products?category=XXXX')` |
| Selectos: login falla | Input email tiene `type="text"` en Radzen | Buscar input text visible antes del password en el DOM |
| Selectos: botón no clickeable | Se buscó "Ingresar" o "Entrar" | El texto exacto es **"Iniciar Sesión"** |
| VTEX: `familiar` falla | `despensafamiliar.com.sv` no existe | Opera bajo Maxi Despensa — no scraperear por separado |
| Supabase: `disponible` no encontrado | La columna está en `precios`, NO en `producto_variantes` | No incluir `disponible` en el body de `producto_variantes` |
| Supabase: error Prefer header | Cliente creado con headers default + headers en request | Pasar headers explícitamente en cada request, no como default del cliente |
| Next.js: APIs rotas / comportamiento extraño | Versión con breaking changes | Leer `web/AGENTS.md` → `web/CLAUDE.md` antes de tocar Next.js |

---

## 10. Comandos útiles

```bash
# Correr scraper VTEX local
cd C:\Sistemas\PreciosSV
python scripts/scrape_vtex_rest.py              # todos
python scripts/scrape_vtex_rest.py walmart      # solo walmart

# Correr scraper Selectos local
python scripts/scrape_selectos_rest.py

# Levantar Next.js en desarrollo
cd web && npm run dev

# Obtener el GitHub token del credential store (Windows)
# python -c "import subprocess; r=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',capture_output=True,text=True); print(r.stdout)"

# Ver últimos runs de GitHub Actions
python -c "
import httpx, subprocess
out = subprocess.run(['git','credential','fill'], input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True).stdout
TOKEN = next(l.split('=')[1] for l in out.splitlines() if l.startswith('password='))
r = httpx.get('https://api.github.com/repos/dtefacturacionnova-lgtm/PreciosSV/actions/runs',
    headers={'Authorization': f'Bearer {TOKEN}'}, params={'per_page': 5})
for run in r.json()['workflow_runs']:
    print(f\"[{run['status']:12s}][{run.get('conclusion') or '':10s}] {run['created_at']}\")
"

# Disparar workflow manualmente
python -c "
import httpx, subprocess
out = subprocess.run(['git','credential','fill'], input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True).stdout
TOKEN = next(l.split('=')[1] for l in out.splitlines() if l.startswith('password='))
httpx.post('https://api.github.com/repos/dtefacturacionnova-lgtm/PreciosSV/actions/workflows/scrapers.yml/dispatches',
    headers={'Authorization': f'Bearer {TOKEN}', 'Accept': 'application/vnd.github+json'},
    json={'ref': 'main'})
"
```

---

## 11. Repo & credenciales

| Ítem | Valor |
|------|-------|
| GitHub repo | `dtefacturacionnova-lgtm/PreciosSV` |
| GitHub user | `dtefacturacionnova-lgtm` |
| Supabase project | `uyilxvplfuverjgjvjmf` |
| Deploy | Vercel (Next.js) — ver MCP de Vercel si está conectado |

---

*Última actualización: 2026-05-29 — Sesión: Canasta inteligente (F4c) + fix build TS PromocionesAnalytica + Selectos scraper con paginación y BFS home*
