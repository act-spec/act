---
id: es/guide/installation
title: Instalación
summary: Instala el SDK de Tinybox desde npm, PyPI o crates.io y verifica la importación.
type: tutorial
parent: root
locale: es-ES
related:
  - es/guide/getting-started
---

# Instalación

El SDK de Tinybox se publica en los tres registros de paquetes
principales. Elige el que coincida con tu entorno de ejecución.

## Node.js

```bash
npm install @tinybox/sdk
```

```ts
import { TinyboxClient } from '@tinybox/sdk';
const client = new TinyboxClient({ token: process.env.TINYBOX_TOKEN });
```

## Python

```bash
pip install tinybox
```

```python
from tinybox import TinyboxClient
client = TinyboxClient(token=os.environ["TINYBOX_TOKEN"])
```

Verifica la instalación listando los buckets de tu espacio por defecto;
deberías ver al menos el bucket `default` provisionado automáticamente.
