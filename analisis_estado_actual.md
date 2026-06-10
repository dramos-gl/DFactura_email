# Reporte de Arquitectura, Producto y Negocio: FactuMail v7.6
## Análisis del Estado del Ecosistema de Facturación Municipal CFDI

> **Versión del documento:** v7.6 — Actualizado: Junio 2026
> **Estado general del sistema:** ✅ Estable, robustecido contra concurrencia y listo para producción en Shared Drives

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

### 📋 Reglas de Negocio Validadas y Activas (v7.6)
* **Integridad del Par Fiscal (PDF + XML):** Cada transacción requiere obligatoriamente ambos archivos. La ausencia de uno de ellos se cataloga como *Estructura Corrupta*, aislando el caso en la pestaña `⚠️ Errores_Cola` sin detener el procesamiento general.
* **Control Estricto de Duplicados en Memoria:** Prevención de registros redundantes mediante el escaneo de IDs únicos (`Message-ID` de Gmail o prefijo `DRIVE_LOCAL_` autogenerado) utilizando búsquedas instantáneas en `Set` en memoria para alto rendimiento.
* **Mecanismo de Conciliación Cuadrática:** Validación de montos totales entre el XML (verdad fiscal) y el PDF (leído vía OCR). Se tolera una variación máxima de **$0.05 MXN** por redondeos contables. Si se supera, se emite una alerta tiñendo la fila completa (22 columnas) de color rojo/coral suave (`#FADBD8`) y se registra en `⚠️ Errores_Cola`.
* **Clasificación Cronológica Jerárquica:** Creación dinámica de un árbol de carpetas en Google Drive basado en la fecha de expedición del XML (Fallback a fecha del correo):
  `Facturas CFDI / Descarga CFDI Recibidos / [Municipio] / [Año] / [Mes] / [Día] /`
* **Renombrado Semántico Inteligente:** El nombre del archivo se estandariza bajo el patrón:
  `[3_letras_RFC_Emisor]_[PALABRA_CLAVE_CONCEPTO]_[FOLIO_SANITIZADO].[pdf/xml]`
  * *Ejemplo:* `MSO_PREDIAL_12345-A.pdf` (Normalizando RFCs como "MS0" a "MSO").
  * Las palabras clave se buscan prioritariamente en la descripción en un orden preestablecido (`CEDULA`, `AVALUO`, `CONSTANCIA`, `PREDIAL`, `FUSION`, `SUBDIVISION`, `DESLINDE`, `LICENCIA`).
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
  * Estados visuales claros: Botones deshabilitados durante procesos de red para evitar doble ejecución.
  * *Spinners* de carga con mensajes explicativos dinámicos.
  * Modales sofisticados personalizados para confirmaciones importantes (ej. procesar históricos locales) y alertas del sistema.
  * Indicadores de borde de color para asociar rápidamente cada botón con su municipio (*Cancún = Rosa/Rojo, Playa = Verde, Tulum = Cian*).

---

## 3. Vista Técnica & Arquitectura (Solutions Architect)

El software sigue una **arquitectura modular de alta cohesión y bajo acoplamiento** estructurada en 6 archivos en Google Apps Script (GAS):

### 🔍 Diagnóstico de Módulos (v7.6)

#### A. [0_Config.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/0_Config.gs) (Configuración Global)
* **Función:** Define variables del sistema, carpetas raíz, matriz de configuración (`CONFIG_MUNICIPIOS`), encabezados (22 columnas, incluyendo `hashXml`), catálogo SAT de pagos y límites de tiempo.
* **Estado:** **Impecable.** Actualizado a etiquetas `Facturas Municipales/` y 22 columnas.

#### B. [1_CoreGmail.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/1_CoreGmail.gs) (Extractor Gmail + Control de Lotes)
* **Función:** Expone APIs para procesar Gmail de forma masiva o segmentada.
* **Estado:** **Corregido, Optimizado y Blindado.**
  * Implementada exclusión mutua mediante `LockService` para evitar duplicados concurrentes.
  * Implementado caché en memoria (`Set`) para validación de duplicados ultrarrápida.

#### C. [2_CoreDrive.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/2_CoreDrive.gs) (Orquestador Central)
* **Función:** Recibe datos y blobs, detona parsers, renombra archivos semánticamente, gestiona carpetas cronológicas (Año/Mes/Día) en Drive y escribe registros en Sheets.
* **Estado:** **Corregido y Estandarizado.**
  * Firma adaptada para recibir e inyectar el caché en memoria de IDs y hashes.
  * Corregido bug visual de fila de discrepancia (ahora tiñe las 22 columnas).
  * Modernizado el hoisting de variables de fecha a `let` de bloque.

#### D. [3_ParserOCR.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/3_ParserOCR.gs) (Inteligencia Textual)
* **Función:** Parser XML nativo y motor OCR síncrono vía Drive API v3.
* **Estado:** **Estabilizado.** Añadido bucle de reintentos incrementales (`retry loop`) al abrir documentos temporales de OCR, mitigando fallos por latencia de Google.

#### E. [UI.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/UI.gs) (Backend de Interfaz y Carga Local)
* **Función:** Crea menús de Google Sheets, abre el panel lateral y gestiona la rutina de Carga Local.
* **Estado:** **Optimizado.**
  * Añadido soporte para Unidades Compartidas (anclando carpetas al padre del Spreadsheet).
  * Añadida autogestión de etiquetas de Gmail en `inicializarEcosistemaHojas` para crear etiquetas automáticamente.
  * Precarga de caché de IDs y hashes por municipio en la carga local para descartar duplicados antes de ejecutar OCR.

#### F. Sistema de Control de Lotes (Batching v7.4) — Transversal
* **Función:** Mecanismo de resiliencia temporal que evita colisiones contra el límite nativo de ejecución de Apps Script.
* **Componentes:**
  * `obtenerLimiteTiempoProcesamientoMs()` en `0_Config.gs` — detecta tipo de licencia (estándar vs. Workspace) y retorna el umbral adecuado.
  * `haExcedidoTiempo()` en `1_CoreGmail.gs` — evaluador con caché que compara tiempo transcurrido vs. límite.
  * Checks en los bucles `for (let hilo of hilos)` y `for (let mensaje of mensajes)` dentro de `procesarMunicipio()`.
  * Manejo de suspensión en `apiProcesarTodo()` y `apiProcesarMunicipio()` con log de auditoría y respuesta diferenciada al UI.
* **Garantía de integridad:** Los correos no procesados permanecen como **no leídos** en Gmail y son retomados en la siguiente ejecución sin intervención manual ni pérdida de datos.

| Tipo de Cuenta | Límite Nativo GAS | Umbral de Seguridad Configurado | Margen |
|---|---|---|---|
| Gmail estándar (`@gmail.com`) | 6 minutos | 4.6 minutos (280,000 ms) | ~1.4 min |
| Google Workspace / Empresarial | 30 minutos | 27 minutos (1,620,000 ms) | ~3 min |

---

## 4. 📈 Conclusión del Diagnóstico
El proyecto **FactuMail v7.4** cuenta con una arquitectura de software modular, libre de errores críticos y preparada para volúmenes empresariales reales. Los módulos principales (`0_Config`, `1_CoreGmail`, `2_CoreDrive`) operan con una única fuente de verdad para el esquema de datos, consultas Gmail flexibles y a prueba de errores, y un sistema de control de lotes que garantiza resiliencia ante cualquier volumen de facturas sin riesgo de pérdida de datos ni interrupciones abruptas.

### Resumen de Estado por Módulo

| Módulo | Estado | Mejoras Aplicadas en v7.4 |
|---|---|---|
| `0_Config.gs` | ✅ Impecable | `remitentesAprobados`, `ENCABEZADOS_ESTANDAR` unificado, `obtenerLimiteTiempoProcesamientoMs()` |
| `1_CoreGmail.gs` | ✅ Corregido y Blindado | Query dinámica, Batching completo, log de suspensión, mensajes diferenciados UI |
| `2_CoreDrive.gs` | ✅ Estandarizado | Eliminación de array inline, uso de `ENCABEZADOS_ESTANDAR` centralizado |
| `3_ParserOCR.gs` | ✅ Excelente | Sin cambios requeridos |
| `UI.gs` | ✅ Estable | Sin cambios requeridos |
| `Interfaz.html` | ✅ Estable | Sin cambios requeridos |
