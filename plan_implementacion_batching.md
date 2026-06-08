# Implementación: Lógica de Paginación y Control de Lotes (Batching)
## Ecosistema FactuMail v7.4 — Google Workspace Empresarial

> **Estado:** ✅ IMPLEMENTADO COMPLETAMENTE — 22 Mayo 2026
> Este documento describe la arquitectura implementada del sistema de control de lotes. Ya no es un plan prospectivo sino un registro técnico de lo ejecutado.

---

## Contexto y Objetivo

El límite nativo de ejecución de Google Apps Script varía según el tipo de cuenta:
- **Cuenta estándar (`@gmail.com`):** 6 minutos por ejecución.
- **Google Workspace Empresarial:** 30 minutos por ejecución.

Sin un mecanismo de control, al procesar un volumen alto de facturas el script simplemente se cortaría de forma abrupta, potencialmente a mitad de una transacción. El sistema de Batching garantiza una interrupción **ordenada y segura** antes de alcanzar ese límite.

---

## Arquitectura Implementada

```
[Invocación desde UI]
        │
        ▼
[apiProcesarTodo / apiProcesarMunicipio]
  - Reinicia tiempoInicioGlobal = new Date().getTime()
  - Reinicia limiteTiempoCalculado = null
        │
        ▼
[Loop por Municipio]
  - haExcedidoTiempo()? ──► SÍ ──► suspensionControlada = true → BREAK
        │
        ▼
[procesarMunicipio(clave)]
  - Loop por Hilo:   haExcedidoTiempo()? ──► SÍ ──► limiteAlcanzado = true → BREAK
  - Loop por Mensaje: haExcedidoTiempo()? ──► SÍ ──► limiteAlcanzado = true → BREAK
  - retorna: { correosBuscados, procesados, omitidos, limiteAlcanzado }
        │
        ▼
[¿metricasNode.limiteAlcanzado?]
  - SÍ ──► Log en ⚠️ Errores_Cola (SUSPENSION_CONTROLADA_TIEMPO)
         ──► return { exito: true, mensaje: "⏱️ Procesamiento Parcial..." }
  - NO  ──► Continuar con siguiente municipio
        │
        ▼
[Ejecución Completa]
  - return { exito: true, mensaje: "✅ Consolidación Gmail Completada..." }
```

---

## Componentes Implementados

### 1. Detección Dinámica de Licencia — `0_Config.gs`

**Función:** `obtenerLimiteTiempoProcesamientoMs()`

```javascript
function obtenerLimiteTiempoProcesamientoMs() {
  const email = Session.getEffectiveUser().getEmail().toLowerCase();

  // Cuenta estándar o trigger anónimo → límite conservador
  if (email.endsWith("@gmail.com") || email.endsWith("@googlemail.com") || email === "") {
    return 280000; // 4.6 minutos de seguridad
  }

  // Dominio corporativo (Google Workspace) → límite extendido
  return 1620000; // 27 minutos de seguridad
}
```

**Decisión de diseño:** Se usa el dominio del correo del usuario autenticado (`Session.getEffectiveUser()`) como proxy del tipo de licencia. Es el método más confiable disponible en Apps Script sin acceso a la API de Admin SDK.

---

### 2. Evaluador de Tiempo con Caché — `1_CoreGmail.gs`

**Variables globales:**
```javascript
let tiempoInicioGlobal    = new Date().getTime();
let limiteTiempoCalculado = null;
```

**Función evaluadora:**
```javascript
function haExcedidoTiempo() {
  if (limiteTiempoCalculado === null) {
    limiteTiempoCalculado = obtenerLimiteTiempoProcesamientoMs();
  }
  return (new Date().getTime() - tiempoInicioGlobal) > limiteTiempoCalculado;
}
```

**Decisión de diseño:** `limiteTiempoCalculado` se inicializa como `null` y se calcula **una sola vez** en la primera llamada a `haExcedidoTiempo()`. Esto evita llamadas repetidas a `Session.getEffectiveUser()` dentro de cada iteración del loop, reduciendo el consumo de cuotas de la API de Session.

---

### 3. Interrupción Controlada en Loops — `procesarMunicipio()` en `1_CoreGmail.gs`

Se agregaron dos puntos de verificación dentro de los loops de procesamiento:

```javascript
// Verificación al inicio de cada HILO
for (let hilo of hilos) {
  if (haExcedidoTiempo()) {
    contador.limiteAlcanzado = true;
    break;
  }
  // ...
  for (let mensaje of mensajes) {
    // Verificación al inicio de cada MENSAJE
    if (haExcedidoTiempo()) {
      contador.limiteAlcanzado = true;
      break;
    }
    // ... procesamiento normal
  }
}
```

**Garantía de integridad transaccional:** El script solo llama a `mensaje.markRead()` **después** de guardar con éxito los archivos en Drive y escribir el registro en Sheets. Si la interrupción ocurre antes de completar una transacción, el correo permanece como No Leído y será procesado íntegramente en la siguiente ejecución.

---

### 4. Manejo en Puntos de Entrada — `apiProcesarTodo()` y `apiProcesarMunicipio()`

Ambas funciones implementan:

1. **Reset del cronómetro** al inicio de cada invocación (cada llamada desde la UI es independiente).
2. **Verificación** del flag `limiteAlcanzado` retornado por `procesarMunicipio()`.
3. **Registro de auditoría** en `⚠️ Errores_Cola` con evento `SUSPENSION_CONTROLADA_TIEMPO`.
4. **Respuesta diferenciada** al frontend:

| Resultado | `exito` | Ícono | Descripción |
|---|---|---|---|
| Completo | `true` | ✅ | Todos los correos procesados |
| Parcial (suspensión) | `true` | ⏱️ | Correos pendientes retenidos como No Leídos |
| Error fatal | `false` | ❌ | Excepción no controlada |

**Nota de diseño:** El bloque que escribe en `⚠️ Errores_Cola` está envuelto en su propio `try/catch`. Si falla el log (por ejemplo, permisos insuficientes temporales), el mensaje de respuesta al usuario **no se pierde** y el sistema continúa normalmente.

---

## Umbrales de Tiempo Configurados

| Tipo de Cuenta | Límite Nativo GAS | Umbral de Seguridad | Margen |
|---|---|---|---|
| `@gmail.com` / `@googlemail.com` | 6 min | 4.6 min (280,000 ms) | ~1.4 min |
| Google Workspace Empresarial | **30 min** | **27 min (1,620,000 ms)** | ~3 min |

---

## Cola Autocurativa (Gmail Transactional Queue)

No se requiere ningún mecanismo adicional de persistencia de estado (tokens, base de datos de progreso, etc.). El propio estado de lectura de Gmail actúa como la cola de trabajo:

- ✅ **Correo procesado exitosamente** → marcado como **Leído** → excluido de la próxima búsqueda.
- ⏸️ **Correo no procesado** → permanece **No Leído** → incluido automáticamente en la próxima búsqueda.

Esta arquitectura es inherentemente idempotente y resistente a fallos sin complejidad adicional.

---

## Pruebas de Verificación Recomendadas

1. **Simulación de volumen:** Insertar `Utilities.sleep(10000)` temporalmente en el loop de inyección y reducir `limiteTiempoCalculado` a `30000` (30 segundos) para simular un timeout rápido.
2. **Verificar log:** Confirmar que aparece `SUSPENSION_CONTROLADA_TIEMPO` en `⚠️ Errores_Cola`.
3. **Verificar correos:** Confirmar que los correos no alcanzados permanecen como No Leídos en Gmail.
4. **Segunda ejecución:** Confirmar que la siguiente ejecución los procesa correctamente sin duplicados.
