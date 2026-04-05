# Frontend Stock

## Desarrollo

- Instalar dependencias: `npm install`
- Levantar Vite: `npm run dev`
- Build producción: `npm run build`

## Deploy en Render

Este frontend usa `BrowserRouter`. Si el static site no tiene un rewrite para rutas internas, al refrescar en URLs como `/dashboard` Render responde `Not Found` porque intenta buscar un archivo físico en esa ruta.

La solución correcta es servir siempre `index.html` para cualquier path del SPA.

Este repo incluye esa configuración en el archivo `render.yaml` del root con la regla:

- source: `/*`
- destination: `/index.html`
- type: `rewrite`

Si el servicio actual de Render no está sincronizado con el blueprint, hay que agregar manualmente esa misma regla en:

- Render Dashboard
- Static Site
- Redirects/Rewrites

Después de aplicar la regla y redeployar, refrescar `/dashboard` debería seguir cargando la app en vez de devolver 404.
