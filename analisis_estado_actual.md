# Reporte de Arquitectura, Producto y Negocio: FactuMail v8.12
## Análisis del Estado del Ecosistema de Facturación Municipal CFDI

> **Versión del documento:** v8.12 — Actualizado: Junio 2026
> **Estado general del sistema:** ✅ Estable, robustecido contra concurrencia y enriquecido con extractor multi-campo y Backfill interactivo

---

### 👤 Perfil del Analista: Tríada de Roles
Este análisis consolidado evalúa la salud y el estado del ecosistema FactuMail tras la resolución del backlog de errores de nivel crítico:
1. **Analista de Negocios (Business Analyst):** Verificación de la consistencia fiscal, alineación con las directrices del SAT y control de auditoría.
2. **Product Owner (PO):** Seguimiento del valor entregado, deuda técnica saldada y experiencia de usuario (UX).
3. **Arquitecto de Soluciones (Solutions Architect):** Validación del diseño modular, persistencia, flujos de datos e integraciones de API.

---

## 1. Vista de Negocio (Business Analysis)

### 🎯 Objetivo del Ecosistema
Automatizar de manera inteligente la extracción, validación fiscal, indexación contable y almacenamiento cronológico de facturas de recaudación municipal (CFDI 4.0/3.3 en formatos XML y PDF) asociadas a tres municipios clave de Quintana Roo: **Cancún**, **Playa del Carmen (Solidaridad)** y **Tulum**.

```
[ Gmail Inbox (Etiquetado) ] ──┐
                               ├──► [ Motor Contable (Inyección) ] ──► [ Google Sheets (Pestañas Regionales) ]
[ Drive Carga Local (Manual) ] ──┘                  │
                                                    ▼
                                     [ Google Drive (Estructura Cronológica) ]
```

### 📋 Reglas de Negocio Validadas y Activas (v8.12)
* **Integridad del Par Fiscal (PDF + XML):** Cada transacción requiere obligatoriamente ambos archivos. La ausencia de uno de ellos se cataloga como *Estructura Corrupta*, aislando el caso en la pestaña `⚠️ Errores_Cola` sin detener el procesamiento general.
* **Control Estricto de Duplicados en Memoria:** Prevención de registros redundantes mediante el escaneo de IDs únicos (`Message-ID` de Gmail o prefijo `DRIVE_LOCAL_` autogenerado) utilizando búsquedas instantáneas en `Set` en memoria para alto rendimiento.
* **Mecanismo de Conciliación Cuadrática:** Validación de montos totales entre el XML (verdad fiscal) y el PDF (leído vía OCR). Se tolera una variación máxima de **$0.05 MXN** por redondeos contables. Si se supera, se emite una alerta tiñendo la fila completa (17 columnas) de color rojo/coral suave (`#FADBD8`) y se registra en `⚠️ Errores_Cola`.
* **Clasificación Cronológica Jerárquica:** Creación dinámica de un árbol de carpetas en Google Drive basado en la fecha de expedición del XML (Fallback a fecha del correo):
  `Facturas CFDI / Descarga CFDI Recibidos / [Municipio] / [Año] / [Mes] / [Día] /`
* **Reglas Específicas por Municipio para Extracción OCR:**
  * **Cancún**:
    * **Clave Catastral**: Validación estricta que no inicia con `0`. Soporta 3 variantes exactas:
      * 18 dígitos numéricos (ej. `601300015001021578`)
      * 18 caracteres exactos (17 números y 1 letra, ej. `601300C01500102157`)
      * 17 caracteres exactos (16 números y 1 letra, ej. `60130C01500102157`)
    * **Referencia Bancaria (Col 11)**: Extrae el identificador del recibo de pago relacionado (ej. `F-2026-659-9915`).
  * **Playa del Carmen / Tulum**:
    * **Clave Catastral**: Validación estricta que no inicia con `0` y no admite letras. Soporta 2 variantes exactas:
      * Base de 15 dígitos con guion y sufijo opcional de 1 a 3 dígitos (ej. `801030076001001-8`)
      * 15 dígitos numéricos exactos sin guion (ej. `801030076001001`)
    * **Fecha Límite Pago (Col 10)**: Extrae la fecha límite soportando layouts multilínea (ej. `Fecha límite de\npago\n2026-06-01`).
    * **Referencia Bancaria (Col 11)**: Extrae la referencia del cliente removiendo prefijos de fecha `YYYYMMDD-` y espacios o saltos de línea (ej. `20260602-G-\n497038 R` ➔ `G-497038`).
* **Lógica Híbrida de Origen de Correos:** Habilidad de aceptar facturas de cualquier remitente para un municipio (`["*"]`) o de limitar la recepción únicamente a una lista cerrada de correos corporativos autorizados.
* **Prevención de Concurrencia (LockService):** Bloqueo seguro de exclusión mutua de 30 segundos para evitar duplicaciones en ejecuciones simultáneas.
* **Soporte de Unidades Compartidas (Shared Drives):** Las carpetas se crean ancladas a la ubicación de la hoja contable, no en el drive personal del usuario.

---

## 2. Vista de Producto & UX (Product Owner)

### 🌟 Valor Agregado
El sistema elimina la tarea manual de descargar facturas del correo, renombrarlas una por una, subirlas a carpetas compartidas y transcribir los datos a hojas de cálculo. Centraliza la operación en una **Consola de Control Premium** integrada en la barra lateral de Google Sheets.

### 🎨 Experiencia de Usuario (UI/UX)
* **Diseño Moderno y Premium:** La interfaz está construida con Vanilla CSS en un estilo de alta gama. Cuenta con un diseño adaptativo (*Responsive*) y soporte nativo de **Tema Claro y Tema Oscuro** que almacena la preferencia en `localStorage`.
* **Micro-interacciones y Feedback Activo:**
  * **GAS Control Centrado**: Título principal `"GAS Control"` centrado estéticamente en la barra superior.
  * **Barra de Progreso Interactiva**: Un indicador dinámico visualiza el avance del enriquecimiento por lotes de 5 registros.
  * Modales sofisticados personalizados para confirmaciones importantes (ej. procesar históricos locales) y alertas del sistema.
  * Indicadores de borde de color para asociar rápidamente cada botón con su municipio (*Cancún = Rosa/Rojo, Playa = Verde, Tulum = Cian*).

---

## 3. Vista Técnica & Arquitectura (Solutions Architect)

El software sigue una **arquitectura modular de alta cohesión y bajo acoplamiento** estructurada en 6 archivos en Google Apps Script (GAS):

### 🔍 Diagnóstico de Módulos (v8.12)

#### A. [0_Config.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/0_Config.gs) (Configuración Global)
* **Función:** Define variables del sistema, carpetas raíz, matriz de configuración (`CONFIG_MUNICIPIOS`), encabezados (17 columnas, incluyendo `hashXml`), catálogo SAT de pagos y límites de tiempo.
* **Estado:** **Excelente.** Incorpora la función de validación de clave catastral robustecida contra falsos positivos.

#### B. [1_CoreGmail.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/1_CoreGmail.gs) (Extractor Gmail + Control de Lotes)
* **Función:** Expone APIs para procesar Gmail de forma masiva o segmentada.
* **Estado:** **Corregido, Optimizado y Blindado.**

#### C. [2_CoreDrive.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/2_CoreDrive.gs) (Orquestador Central)
* **Función:** Recibe datos y blobs, detona parsers, renombra archivos semánticamente, gestiona carpetas cronológicas (Año/Mes/Día) en Drive y escribe registros en Sheets.
* **Estado:** **Estandarizado.** Recibe e integra de forma nativa los tres campos de metadatos PDF en su flujo transaccional.

#### D. [3_ParserOCR.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/3_ParserOCR.gs) (Inteligencia Textual)
* **Función:** Parser XML nativo y motor OCR síncrono vía Drive API v3.
* **Estado:** **Optimizado.** Contiene las expresiones regulares refinadas para claves catastrales, fechas de vencimiento multilínea y el extractor de referencia de Playa/Tulum que une y formatea el código alfanumérico limpio.

#### E. [UI.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/UI.gs) (Backend de Interfaz y Carga Local)
* **Función:** Crea menús de Google Sheets, abre el panel lateral, gestiona la carga local y procesa el enriquecimiento histórico interactivo (`apiProcesarLoteBackfill` y `apiObtenerMetricasBackfill`).
* **Estado:** **Optimizado.** Actualizado para buscar registros con Clave Catastral, Fecha Límite o Referencia Bancaria vacíos o `"N/A"`, actualizando todos en una sola corrida. En caso de fallas de lectura o archivos inaccesibles, inyecta `"Error Acceso PDF"` o `"No Detectada"` para evitar bucles infinitos de reintento.

#### F. Sistema de Control de Lotes (Batching) — Transversal
* **Garantía de integridad:** Los correos no procesados permanecen como **no leídos** en Gmail y son retomados en la siguiente ejecución sin intervención manual ni pérdida de datos.

---

## 4. 📊 Resumen de Estado por Módulo

| Módulo | Estado | Mejoras Aplicadas en v8.7 |
|---|---|---|
| `0_Config.gs` | ✅ Impecable | Función de validación de claves catastrales y configuración base. |
| `1_CoreGmail.gs` | ✅ Blindado | Control de lotes de Gmail. |
| `2_CoreDrive.gs` | ✅ Integrado | Escritura directa de Clave, Fecha Límite y Referencia en hoja. |
| `3_ParserOCR.gs` | ✅ Optimizado | Regex alfanumérica refinada, soporte a saltos de línea y extractor split de referencia. |
| `UI.gs` | ✅ Optimizado | Backfill interactivo unificado multi-campo (Claves/Fechas/Referencias). |
| `Interfaz.html` | ✅ Premium | Título "GAS Control" centrado, barra de progreso interactiva para lote de 5 ítems. |
