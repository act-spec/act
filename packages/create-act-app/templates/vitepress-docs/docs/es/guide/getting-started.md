---
id: es/guide/getting-started
title: Primeros pasos
summary: Envía tu primera petición autenticada a Tinybox en menos de un minuto.
type: tutorial
parent: root
locale: es-ES
related:
  - es/guide/installation
---

# Primeros pasos

Genera un token de espacio de trabajo desde el panel y envía una petición
autenticada para listar los objetos de tu bucket por defecto.

```bash
export TINYBOX_TOKEN='wks_…'
curl -H "Authorization: Bearer $TINYBOX_TOKEN" \
  https://api.tinybox.dev/v1/objects
```

> [!TIP]
> Los tokens están limitados a un único espacio de trabajo. Genera un
> token distinto por entorno (dev, staging, prod).

Cuando estés listo para escribir código, ve a
[Instalación](./installation.md) y elige un SDK.
