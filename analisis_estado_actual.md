# Reporte de Arquitectura, Producto y Negocio: FactuMail v7.4
## Análisis del Estado del Ecosistema de Facturación Municipal CFDI

> **Versión del documento:** v7.4 — Actualizado: 22 Mayo 2026
> **Estado general del sistema:** ✅ Estable y listo para producción

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

### 📋 Reglas de Negocio Validadas y Activas (v7.4)
* **Integridad del Par Fiscal (PDF + XML):** Cada transacción requiere obligatoriamente ambos archivos. La ausencia de uno de ellos se cataloga como *Estructura Corrupta*, aislando el caso en la pestaña `⚠️ Errores_Cola` sin detener el procesamiento general.
* **Control Estricto de Duplicados:** Prevención de registros redundantes mediante el escaneo de IDs únicos (`Message-ID` de Gmail o prefijo `DRIVE_LOCAL_` autogenerado).
* **Mecanismo de Conciliación Cuadrática:** Validación de montos totales entre el XML (verdad fiscal) y el PDF (leído vía OCR). Se tolera una variación máxima de **$0.05 MXN** por redondeos contables. Si se supera, se emite una alerta tiñendo la fila de color rojo/coral suave (`#FADBD8`) y se registra en `⚠️ Errores_Cola`.
* **Clasificación Cronológica Jerárquica:** Creación dinámica de un árbol de carpetas en Google Drive basado en la fecha de expedición del XML (Fallback a fecha del correo):
  `Facturas CFDI / Descarga CFDI Recibidos / [Municipio] / [Año] / [Mes] /`
* **Renombrado Semántico Inteligente:** El nombre del archivo se estandariza bajo el patrón:
  `[3_letras_RFC_Emisor]_[PALABRA_CLAVE_CONCEPTO]_[FOLIO_SANITIZADO].[pdf/xml]`
  * *Ejemplo:* `MSO_PREDIAL_12345-A.pdf` (Normalizando RFCs como "MS0" a "MSO").
  * Las palabras clave se buscan prioritariamente en la descripción en un orden preestablecido (`CEDULA`, `AVALUO`, `CONSTANCIA`, `PREDIAL`, `FUSION`, `SUBDIVISION`, `DESLINDE`, `LICENCIA`).
* **Lógica Híbrida de Origen de Correos:** Habilidad de aceptar facturas de cualquier remitente para un municipio (`["*"]`) o de limitar la recepción únicamente a una lista cerrada de correos corporativos autorizados.

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

### 🔍 Diagnóstico de Módulos (v7.4)

#### A. [0_Config.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/0_Config.gs) (Configuración Global)
* **Función:** Define variables del sistema (`VERSION_SISTEMA`), nombres de carpetas raíz, matriz de configuración de municipios (`CONFIG_MUNICIPIOS`), encabezados oficiales de base de datos (`ENCABEZADOS_ESTANDAR`), catálogo del SAT de formas de pago e identificadores para renombrado semántico.
* **Estado:** **Impecable.** Se añadió la propiedad `remitentesAprobados` a los municipios, se fijó la hoja destino de Tulum en `"Tulum"`, y se estandarizó la constante `ENCABEZADOS_ESTANDAR` a la estructura oficial de 21 columnas requerida por el motor de Drive.

#### B. [1_CoreGmail.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/1_CoreGmail.gs) (Extractor Gmail + Control de Lotes)
* **Función:** Expone las APIs para procesar de forma masiva (`apiProcesarTodo`) o segmentada (`apiProcesarMunicipio`) la bandeja de entrada. Realiza consultas usando queries nativas de Gmail (`label:X is:unread`), clasifica adjuntos (XML/PDF), audita duplicados e invoca al inyector del motor contable.
* **Estado:** **Corregido, Optimizado y Blindado con Batching.**
  * Se implementó lógica de construcción de query dinámica que evita fallos por variables indefinidas, soportando tanto el filtrado cerrado de remitentes como el escaneo general por etiqueta (`"*"`).
  * Se agregaron variables globales `tiempoInicioGlobal` y `limiteTiempoCalculado` con evaluador `haExcedidoTiempo()` con caché para evitar llamadas repetidas a `Session` API.
  * Los puntos de entrada `apiProcesarTodo()` y `apiProcesarMunicipio()` reinician el cronómetro en cada invocación desde la UI, detectan `limiteAlcanzado` propagado desde `procesarMunicipio()`, registran el evento `SUSPENSION_CONTROLADA_TIEMPO` en `⚠️ Errores_Cola` y retornan un mensaje diferenciado al frontend (⏱️ vs ✅).

#### C. [2_CoreDrive.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/2_CoreDrive.gs) (Orquestador Central)
* **Función:** Recibe los datos y blobs (de Gmail o Carga Local), detona los parsers, ejecuta la lógica de renombrado semántico, gestiona el árbol físico de carpetas en Google Drive e inserta el registro final en la base de datos de Sheets.
* **Estado:** **Corregido y Estandarizado.** Se eliminó el array duplicado inline y se configuró para consumir directamente `ENCABEZADOS_ESTANDAR` de `0_Config.gs`, garantizando una única fuente de verdad columnar.

#### D. [3_ParserOCR.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/3_ParserOCR.gs) (Inteligencia Textual)
* **Función:**
  * **Parser XML:** Usa `XmlService` nativo para deconstruir el archivo fiscal de forma determinista y limpia la descripción de partidas contables eliminando códigos numéricos iniciales.
  * **OCR Engine:** Desarrolla un método síncrono ultra-avanzado y elegante mediante la API v3 de Drive. Sube el PDF vía multipart POST con la propiedad `ocr=true` activada, lee el texto del Google Doc efímero resultante y ejecuta una higiénica recolección de basura eliminando el archivo temporal en el bloque `finally`.
  * **Regex Engine:** Ejecuta búsquedas inversivas con patrones regex calibrados para capturar la Clave Catastral, Fecha Límite de Pago, Total e Información del Cliente del PDF.
* **Estado:** **Excelente.** Código muy profesional y con alta tasa de éxito de OCR en comprobantes del sureste mexicano.

#### E. [UI.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/UI.gs) (Backend de Interfaz y Carga Local)
* **Función:** Crea los menús de Google Sheets, abre el panel lateral y gestiona la rutina de Carga Local Manual, barriendo recursivamente archivos XML/PDF en la carpeta física, emparejándolos e inyectándolos en el mismo motor de base de datos.
* **Estado:** **Estable.** Excelente puente que asegura que las facturas subidas manualmente a Drive sigan los mismos rigurosos estándares de renombrado y registro que las recibidas por correo.

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
