# PrecioSV — Backend API

Sistema de monitoreo comparativo de precios en supermercados de El Salvador.

## Stack

| Capa | Tecnología |
|---|---|
| API | FastAPI + Uvicorn |
| Base de datos | PostgreSQL 16 + SQLAlchemy async |
| Cache / Colas | Redis 7 + Celery |
| Scrapers | Playwright (Selectos) + HTTPX (VTEX) |
| IA Matching | Claude API (Anthropic) |
| Email alertas | SendGrid |
| Contenedores | Docker + Docker Compose |

## Estructura del proyecto

```
preciosv/
├── app/
│   ├── api/v1/endpoints/
│   │   ├── auth.py          # Login, registro, JWT
│   │   ├── productos.py     # Comparativas, búsqueda, alertas usuario
│   │   ├── admin.py         # Dashboard admin, control scrapers
│   │   └── proveedores.py   # B2B: posición, competencia, alertas
│   ├── core/
│   │   ├── config.py        # Settings (Pydantic Settings)
│   │   ├── logging.py       # Logging estructurado (structlog)
│   │   └── security.py      # JWT, bcrypt, dependencias de auth
│   ├── db/
│   │   └── database.py      # Engine async, sesión, Redis
│   ├── models/
│   │   └── models.py        # Modelos SQLAlchemy (8 tablas + vista)
│   ├── schemas/
│   │   └── schemas.py       # Schemas Pydantic v2
│   ├── services/
│   │   ├── producto_service.py   # Normalización + persistencia
│   │   ├── matching_service.py   # Product matching con Claude API
│   │   └── alerta_service.py     # Evaluación y envío de alertas
│   ├── scrapers/
│   │   ├── selectos.py      # Playwright — intercepción de red
│   │   └── vtex.py          # HTTPX — API pública VTEX (4 cadenas)
│   ├── tasks/
│   │   └── scraper_tasks.py # Celery: scraping + alertas programadas
│   └── main.py              # FastAPI app, routers, CORS, lifespan
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml   # PostgreSQL + Redis + API + Workers + Flower
├── scripts/
│   └── init_db.sql          # Datos semilla: supermercados, categorías, admin
├── .env.example
└── requirements.txt
```

## Inicio rápido

### 1. Clonar y configurar entorno

```bash
git clone https://github.com/tu-usuario/preciosv-backend
cd preciosv-backend

cp .env.example .env
# Editar .env con tus credenciales reales
```

### 2. Levantar con Docker (recomendado)

```bash
cd docker
docker compose up -d

# Ver logs en tiempo real
docker compose logs -f api
```

### 3. Verificar que todo funciona

```bash
# Health check
curl http://localhost:8000/health

# Documentación interactiva
open http://localhost:8000/docs

# Monitoreo de workers Celery
open http://localhost:5555
```

### 4. Desarrollo local (sin Docker)

```bash
# Instalar dependencias
pip install -r requirements.txt
playwright install chromium

# Levantar servicios externos
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=preciosv123 postgres:16
docker run -d -p 6379:6379 redis:7

# Iniciar API
uvicorn app.main:app --reload

# Iniciar worker en otra terminal
celery -A app.tasks.scraper_tasks.celery_app worker --loglevel=info

# Iniciar scheduler en otra terminal
celery -A app.tasks.scraper_tasks.celery_app beat --loglevel=info
```

## API Endpoints principales

### Públicos (sin auth)
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/v1/productos` | Lista con filtros y paginación |
| GET | `/api/v1/productos/{id}/comparativa` | Precio en los 5 supermercados |
| GET | `/api/v1/productos/{id}/historico` | Histórico de precios |
| GET | `/api/v1/productos/ean/{ean}` | Buscar por código de barras |
| GET | `/api/v1/productos/ofertas/activas` | Ofertas vigentes |

### Usuario autenticado
| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/api/v1/auth/registro` | Crear cuenta |
| POST | `/api/v1/auth/login` | Obtener JWT |
| GET | `/api/v1/auth/me` | Mi perfil |
| POST | `/api/v1/productos/alertas` | Crear alerta de precio |
| GET | `/api/v1/productos/alertas/mis-alertas` | Mis alertas |

### Proveedor/Fabricante (rol: proveedor)
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/v1/proveedores/dashboard` | Resumen ejecutivo |
| GET | `/api/v1/proveedores/mis-productos` | Posición en cadenas |
| GET | `/api/v1/proveedores/competencia/{cat_id}` | Comparativa vs competidores |
| GET | `/api/v1/proveedores/alertas-b2b` | Mis alertas B2B |
| GET | `/api/v1/proveedores/competencia/ofertas-activas` | Ofertas de competidores |

### Administrador (rol: admin)
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/v1/admin/resumen` | Métricas del sistema |
| GET | `/api/v1/admin/scrapers/estado` | Estado de scrapers |
| POST | `/api/v1/admin/scrapers/{key}/ejecutar` | Disparar scraper manual |
| GET | `/api/v1/admin/scrapers/logs` | Historial de ejecuciones |
| GET | `/api/v1/admin/usuarios` | Lista de usuarios |
| GET | `/api/v1/admin/inflacion/indice` | Índice de inflación PrecioSV |

## Supermercados configurados

| Key | Nombre | Tecnología scraper |
|---|---|---|
| `selectos` | Súper Selectos | Playwright (intercepción de red) |
| `walmart` | Walmart El Salvador | HTTPX → API VTEX |
| `donjuan` | La Despensa de Don Juan | HTTPX → API VTEX |
| `maxidespensa` | Maxi Despensa | HTTPX → API VTEX |
| `familiar` | Despensa Familiar | HTTPX → API VTEX |

> **Nota**: Las 4 tiendas Walmart/Despensas comparten la misma plataforma VTEX,
> por lo que un solo scraper adaptado las cubre todas.

## Costos estimados (producción mínima)

| Servicio | Costo/mes |
|---|---|
| VPS Hetzner CX21 (2 vCPU, 4GB) | $6 |
| Claude API (matching ~1000 calls/día) | $5-15 |
| SendGrid (hasta 100k emails/mes) | $0 (free tier) |
| Dominio .com | $1 |
| **Total** | **~$12-22/mes** |

---
PrecioSV Backend v1.0 · Mayo 2026 · El Salvador 🇸🇻
