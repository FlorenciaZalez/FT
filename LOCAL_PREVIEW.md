# Preview local

Este proyecto ya puede correrse localmente para validar cambios antes de deployar.

## Qué usa

- Backend FastAPI en http://127.0.0.1:8000
- Frontend Vite en http://127.0.0.1:5173
- Postgres y Redis con docker-compose
- Entorno Python virtual existente en /Users/florenciazalez/Desktop/Stock/venv

## Primera puesta en marcha

1. Levantar infraestructura:

   docker-compose up -d db redis

2. Ejecutar migraciones:

   /Users/florenciazalez/Desktop/Stock/venv/bin/python -m alembic upgrade head

3. Levantar backend:

   /Users/florenciazalez/Desktop/Stock/venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

4. Levantar frontend:

   cd frontend
   npm run dev -- --host 127.0.0.1

## Cómo funciona el frontend local

En desarrollo, el frontend ahora usa /api/v1 por defecto, así que Vite proxea automáticamente al backend local definido en vite.config.ts.

Si necesitás forzar otro backend, copiá frontend/.env.development.example a frontend/.env.development y ajustá VITE_API_BASE_URL.

## Tareas de VS Code

Se agregaron tareas para correr todo más rápido:

- Infra local
- Migraciones local
- Backend local
- Frontend local

Podés ejecutarlas desde Terminal > Run Task.