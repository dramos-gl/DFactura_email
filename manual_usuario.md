# 📖 Manual de Usuario y Configuración de Infraestructura
## Sistema FactuMail v8.7 — Automatización Contable de Facturación Municipal CFDI

> **Versión:** v8.7 · **Entorno objetivo:** Google Workspace Empresarial · **Actualizado:** Junio 2026

Este manual describe todos los prerrequisitos, ubicaciones, nombres de directorios, configuraciones en Gmail, estructuras en Sheets y lineamientos de mantenimiento de código necesarios para asegurar el correcto funcionamiento del ecosistema automatizado de procesamiento CFDI **FactuMail**.

---

## 1. Introducción al Ecosistema

**FactuMail** es un motor inteligente desarrollado en **Google Apps Script** que automatiza la recaudación, validación, extracción de texto (vía parsing XML y OCR en PDF), renombrado inteligente y clasificación física de comprobantes fiscales de los municipios de **Cancún**, **Playa del Carmen** y **Tulum**. 

El sistema admite dos flujos de entrada:
1.  **Flujo Gmail:** Lectura automatizada de la bandeja de entrada según etiquetas jerárquicas específicas.
2.  **Flujo Carga Local:** Organización manual de archivos sueltos subidos directamente a una carpeta específica en Google Drive.

---

## 2. Requerimientos de Infraestructura & Ubicación del Archivo

### 📄 Ubicación de la Hoja de Cálculo y el Código
*   **Contenedor del Sistema:** El sistema reside de manera nativa como un *Script Vinculado (Container-Bound Script)* dentro de una hoja de cálculo de Google Sheets.
*   **Nombre de la Hoja de Cálculo Activa:** Se recomienda nombrarla **"Registro de Facturas CFDI"** (se sincroniza con las constantes de configuración, aunque la vinculación interna es por enlace directo de script).
*   **Ubicación del Código:** Para acceder al panel de desarrollo, en la hoja de cálculo, vaya a **Extensiones > Apps Script**. Allí deben estar presentes los siguientes 6 archivos estructurados:
    *   `0_Config.gs` (Constantes, diccionarios contables y palabras clave)
    *   `1_CoreGmail.gs` (Motor extractor de la bandeja de entrada de Gmail)
    *   `2_CoreDrive.gs` (Orquestador de almacenamiento cronológico y base de datos)
    *   `3_ParserOCR.gs` (Mecanismo XML Service, Drive API OCR y Regex de PDF)
    *   `UI.gs` (Backend del panel lateral y carga local de Drive)
    *   `Interfaz.html` (Frontend de la consola de control interactiva)

---

## 3. Configuración en Google Drive (Estructura de Carpetas)

El motor contable utiliza Google Drive como repositorio físico organizado. El sistema está programado para **crear automáticamente** la estructura si no existe, pero es indispensable conocer la jerarquía oficial:

### 📂 Carpeta Principal de Trabajo
En la raíz de su Google Drive (`Mi Unidad`), debe existir una carpeta principal:
*   **Nombre exacto:** `Facturas CFDI`

### 🗂️ Subcarpetas de Control Técnico
Dentro de `Facturas CFDI`, el script creará o buscará las siguientes carpetas:
1.  **`Descarga CFDI Recibidos`**: Es la carpeta raíz del archivo histórico contable.
2.  **`Facturas no Organizadas`**: **[Crítico para Carga Manual]** Es la carpeta temporal de entrada. Si un usuario desea subir archivos a mano, debe guardarlos en esta carpeta (en pares de archivos `.xml` y `.pdf` con nombres similares). Tras ejecutar la opción "Organizar Carpeta Descargados" en la Consola, el script los procesará, los moverá a su ruta definitiva renombrados y limpiará esta carpeta para evitar duplicidades.

### 🌳 Árbol Cronológico Automatizado (Destino Final)
Cuando el motor procesa un par de archivos con éxito (vía Gmail o Carga Local), los guarda en el repositorio definitivo estructurado bajo la siguiente jerarquía exacta basada en el municipio y la fecha de expedición fiscal de la factura:

`Facturas CFDI / Descarga CFDI Recibidos / [Municipio] / [Año] / [Mes] /`

*   *Nombres de Carpetas Municipales:* `Cancún`, `Playa del Carmen` o `Tulum` (definidos en `0_Config.gs`).
*   *Meses:* Representados de forma numérica de dos dígitos (ej. `01`, `02`, ..., `12`).
*   *Ejemplo de ruta final:* `Facturas CFDI / Descarga CFDI Recibidos / Playa del Carmen / 2026 / 05 / MSO_PREDIAL_12345.pdf`

---

## 4. Configuración en Gmail (Bandeja de Entrada & Etiquetas)

To que el flujo de extracción automática por correo funcione de manera óptima, se deben cumplir los siguientes requisitos en la cuenta de Gmail donde corre el script:

### 🏷️ Creación de Etiquetas Jerárquicas
El script busca correos clasificados en etiquetas jerárquicas exactas de Gmail. En la configuración activa, estas corresponden a:
*   **Para Cancún:** `Facturas Municipales/Cancún`
*   **Para Playa del Carmen:** `Facturas Municipales/Playa`
*   **Para Tulum:** `Facturas Municipales/Tulum`

> [!TIP]
> **Autogestión de Etiquetas (v8.7):** Ya no necesitas crear estas etiquetas manualmente en Gmail. Al ejecutar la inicialización del ecosistema desde el Sheets (ver Sección 7), el script verificará tu cuenta de Gmail y creará automáticamente cualquier etiqueta jerárquica faltante con la ortografía exacta.

### 📧 Flujo del Correo y Requisitos de Entrada
1.  **Estado No Leído:** El motor solo escanea correos marcados como **No Leídos** (`is:unread`) dentro de la etiqueta correspondiente para evitar reprocesar correos antiguos.
2.  **Par de Archivos Indispensable:** El correo electrónico analizado debe contener exactamente **un archivo adjunto XML** y **un archivo adjunto PDF** del comprobante municipal.
    *   Si falta alguno de los dos, el script marcará el correo como leído para no trabar la cola de procesamiento, registrará el fallo en `⚠️ Errores_Cola` con el asunto del correo y continuará con el siguiente.
3.  **Marcado automático de Leídos:** Una vez que el script procesa y guarda con éxito el par fiscal en Drive y escribe los datos en Sheets, marca automáticamente el correo como **Leído** de forma definitiva.

---

## 5. Configuración en Google Sheets (Esquema de Base de Datos)

El libro de cálculo actúa como base de datos transaccional. Para asegurar la integridad contable, el libro de cálculo requiere de las siguientes especificaciones:

### 📑 Pestañas del Spreadsheet
Deben existir pestañas específicas por cada municipio y una para control de incidencias:
*   **`Cancún`**: Para registros de Cancún.
*   **`Playa`**: Para registros de Playa del Carmen.
*   **`Tulum`**: Para registros de Tulum.
*   **`⚠️ Errores_Cola`**: Pestaña técnica para registro de logs de auditoría contable y fallos (ej. montos discrepantes, archivos huérfanos, fallas de OCR).

*Nota: Si las hojas no existen, al presionar "Forzar Reindexación de Hojas" desde la Consola, se crearán e inicializarán con su formato y colores correspondientes de manera automática.*

### 📊 Estructura de 17 Columnas Estándar (v8.12)
Cada pestaña de municipio debe poseer exactamente las siguientes 17 columnas en este orden estricto de izquierda a derecha (el script inicializa automáticamente esta cabecera con el estilo corporativo y oculta/protege las columnas 15, 16 y 17):

| Columna | Nombre de Columna Oficial | Tipo de Dato Inyectado | Origen del Dato | Estado |
| :---: | :--- | :--- | :--- | :--- |
| **Col 1** | `Fecha Emisión` | Texto (AAAA-MM-DD) | XML (Atributo `Fecha`) | Visible |
| **Col 2** | `Nombre Emisor` | Texto | XML (Nodo `<cfdi:Emisor Nombre="...">`) | Visible |
| **Col 3** | `Nombre Receptor` | Texto | XML (Nodo `<cfdi:Receptor Nombre="...">`) | Visible |
| **Col 4** | `Serie-Folio` | Texto | XML (Atributos concatenados `Serie`-`Folio`) | Visible |
| **Col 5** | `UUID Fiscal` | Texto (36 caracteres) | XML (UUID del Timbre Fiscal) | Visible |
| **Col 6** | `Forma de Pago` | Texto (Clave - Descripción) | XML (Homologado con Catálogo del SAT) | Visible |
| **Col 7** | `Total Facturado` | Decimal | XML (Total fiscal con fallback a OCR) | Visible |
| **Col 8** | `Clave Catastral` | Texto | PDF (Extraído vía OCR con validación estricta) | Visible |
| **Col 9** | `Descripción / Conceptos`| Texto (Partidas separadas por comas) | XML (Descripción limpia sin códigos basura) | Visible |
| **Col 10**| `Fecha Límite Pago` | Texto o Fecha | PDF (Extraído de sección de vencimiento vía OCR) | Visible |
| **Col 11**| `Referencia Bancaria` | Texto | PDF (Línea de captura o recibo de pago relacionado) | Visible |
| **Col 12**| `Nombre Archivo PDF` | Texto | Nombre definitivo asignado al PDF en Drive | Visible |
| **Col 13**| `Enlace PDF` | Hipervínculo URL | Enlace directo para visualización en Drive | Visible |
| **Col 14**| `Enlace XML` | Hipervínculo URL | Enlace directo para descarga en Drive | Visible |
| **Col 15**| `Fecha Procesamiento` | Fecha y Hora | Sistema (Fecha actual de ejecución) | **Oculta/Protegida** |
| **Col 16**| `ID Origen (Correo/Local)`| Texto (ID único) | Gmail (Message-ID) o Drive (DRIVE_LOCAL_ID) | **Oculta/Protegida** |
| **Col 17**| `Hash XML` | Texto (SHA-256) | Hash SHA-256 para control de duplicidades | **Oculta/Protegida** |

---

### 🔑 Validación y Formatos de Claves Catastrales por Municipio

Para garantizar que el motor OCR extraiga únicamente claves catastrales legítimas y descarte firmas digitales del SAT o folios fiscales no deseados, se aplican reglas de validación basadas en los formatos oficiales de cada municipio:

#### 📍 Cancún (Benito Juárez)
Soporta tres estructuras estrictas de longitud y carácter, excluyendo cualquier clave que comience con el dígito `0`:
*   **18 dígitos numéricos exactos:**
    *   *Regla:* 18 dígitos, 0 letras.
    *   *Ejemplo:* `601300015001021578`
*   **18 caracteres exactos (17 números y 1 letra):**
    *   *Regla:* 17 dígitos, exactamente 1 letra.
    *   *Ejemplo:* `601300C01500102157`
*   **17 caracteres exactos (16 números y 1 letra):**
    *   *Regla:* 16 dígitos, exactamente 1 letra.
    *   *Ejemplo:* `60130C01500102157`

#### 📍 Playa del Carmen (Solidaridad) y Tulum
Soportan las siguientes estructuras estrictas, excluyendo letras y cualquier clave que comience con el dígito `0`:
*   **Formato con Guion (16 a 19 caracteres totales):**
    *   *Regla:* La sección base antes del guion debe tener exactamente **15 dígitos**. Admite un sufijo opcional de 1 a 3 dígitos después del guion.
    *   *Ejemplo:* `801030076001001-8` o `801030076001001-123`
*   **Formato sin Guion (15 dígitos exactos):**
    *   *Regla:* Exactamente 15 dígitos numéricos sin caracteres adicionales.
    *   *Ejemplo:* `801030076001001`

---

## 6. Mantenimiento y Actualización de Correos Aprobados

La versión 7.4 introduce una **arquitectura híbrida condicional** de búsqueda de correos. Esto permite alternar dinámicamente entre recibir facturas de cualquier origen o limitarse a remitentes confiables.

### ⚙️ Ubicación en el Código
Esta configuración se modifica directamente en el archivo [0_Config.gs](file:///c:/Users/dramos/Documents/Proyecto_FactuMail/0_Config.gs), dentro de la constante `CONFIG_MUNICIPIOS`.

```javascript
const CONFIG_MUNICIPIOS = {
  "CANCUN": {
    label: "Facturas Municipales/Cancún",
    hojaDestino: "Cancún",
    nombreCarpeta: "Cancún",
    remitentesAprobados: ["*"] // <--- Propiedad de Control
  },
  ...
}
```

### 🛠️ ¿Cómo Actualizar los Remitentes Aprobados?

#### Opción A: Aceptar Cualquier Remitente (Por defecto en v8.7)
Si el negocio desea procesar todo correo que un colaborador mueva a la etiqueta de Gmail correspondiente sin importar quién lo envió:
*   Declare el comodín de asterisco `"*"` como único elemento del array:
    `remitentesAprobados: ["*"]`

#### Opción B: Restringir a Remitentes Específicos (Seguridad Corporativa)
Si desea que el script solo extraiga facturas de correos institucionales de tesorería o de proveedores contables específicos, evitando correos basura:
*   Reemplace el asterisco por la lista de correos válidos encerrados entre comillas y separados por comas:
    `remitentesAprobados: ["tesoreria@cancun.gob.mx", "facturacion.municipio@playa.gob.mx", "notificaciones@tulum.gob.mx"]`

> [!NOTE]
> Al configurar la Opción B, el motor de Apps Script reconstruirá automáticamente la consulta de Gmail para buscar solo correos que cumplan con la etiqueta **Y** provengan de alguno de los remitentes de la lista, optimizando el consumo de cuotas diarias de búsqueda de Google.

---

## 7. Flujo de Operación y Primer Inicio

Para poner en marcha el sistema por primera vez, siga esta secuencia de pasos:

1.  **Abrir Consola y Autorizar Permisos:**
    *   Abra la Hoja de Cálculo en su navegador.
    *   Al cargarse, aparecerá en el menú superior un nuevo botón: **`🏢 Consola CFDI`**.
    *   Haga clic en **`🎛️ Abrir Consola Central`**.
    *   **Paso Crítico:** Google solicitará una "Autorización Requerida". Haga clic en *Continuar*, elija su cuenta de Google, haga clic en *Configuración Avanzada*, seleccione *Ir a FactuMail (no seguro)* y haga clic en *Permitir*.
2.  **Inicialización de Hojas y Etiquetas (v8.7):**
    *   Haga clic en **`🏢 Consola CFDI > ⚙️ Forzar Reindexación de Hojas`**.
    *   Este comando creará preventivamente las hojas de cálculo necesarias en blanco con el orden de columnas unificado, listas para recibir registros.
    *   **Adicionalmente:** El sistema validará tus etiquetas de Gmail y creará automáticamente las subcarpetas del sistema (p. ej., `Facturas Municipales/...`) en caso de que falten en tu cuenta, evitando errores de ortografía.
3.  **Procesamiento Contable Diario:**
    *   Abra la consola central (**`🏢 Consola CFDI > 🎛️ Abrir Consola Central`**).
    *   En el panel lateral derecho, podrá ejecutar la automatización completa haciendo clic en **"Procesar Todas las Facturas"** o segmentarlo por un municipio en específico haciendo clic en su botón regional correspondiente.
4.  **Enriquecimiento Histórico Multi-Campo (Backfill):**
    *   Si tienes facturas antiguas registradas que no posean **Clave Catastral**, **Fecha Límite Pago** o **Referencia Bancaria** (que tengan `"N/A"`, estén vacías o contengan `"No Detectada"` que quieras reevaluar), haz clic en el botón **"Actualizar Claves, Fechas y Refs"**.
    *   El motor contará los registros pendientes y procesará lotes de 5 archivos recursivamente con una barra de progreso interactiva en tiempo real.
    *   Si el archivo PDF no es legible o es inaccesible, el script marcará la celda con `"Error Acceso PDF"` o `"No Detectada"` para no quedarse atascado en futuras ejecuciones.

---

## 8. Control de Lotes y Límite de Tiempo (Batching v7.4)

FactuMail incluye un sistema de **control de lotes autocalibrado** diseñado para entornos de alto volumen de facturas. Este mecanismo garantiza que el script nunca colisione de forma abrupta contra el límite de ejecución de Google Apps Script.

### ⏱️ ¿Qué significa el mensaje de "Procesamiento Parcial"?

Si la consola muestra el siguiente tipo de mensaje tras ejecutar una acción:

```
⏱️ Procesamiento Parcial — Límite de Tiempo Alcanzado

El sistema completó el procesamiento hasta el punto seguro establecido
para su licencia de Google Workspace.

📧 Hilos analizados en esta ejecución: XX
✅ Facturas integradas con éxito: XX
⚠️ Correos con incidencias: XX

ℹ️ Los correos no procesados permanecen sin leer en Gmail y serán
retomados automáticamente en la próxima ejecución.
```

Significa que el volumen de facturas en la bandeja era mayor al que se podía procesar en una sola ejecución. Esto **no es un error**; es el comportamiento esperado y seguro del sistema.

### 🔄 ¿Qué pasa con los correos que no se procesaron?

El sistema está diseñado bajo el principio de **"Transactional Queue"**:
*   Un correo solo se marca como **Leído** si fue procesado, guardado en Drive y registrado en Sheets con éxito.
*   Los correos pendientes permanecen como **No Leídos** en Gmail, dentro de su etiqueta correspondiente.
*   En la **próxima ejecución** (ya sea manual desde la consola o automática por un trigger programado), el sistema los retomará desde donde quedó, sin requerir ninguna configuración adicional.

### 📋 ¿Cómo interpretar el log en `⚠️ Errores_Cola`?

Cada vez que ocurre una suspensión controlada, el sistema registra automáticamente una fila en la pestaña `⚠️ Errores_Cola` con el siguiente formato:

| Columna | Contenido de Ejemplo |
|---|---|
| Fecha y Hora | `22/05/2026 17:25:10` |
| Tipo de Evento | `SUSPENSION_CONTROLADA_TIEMPO` |
| Municipio Afectado | `TULUM` (el municipio donde se interrumpió) |
| Descripción | `El procesamiento fue interrumpido de forma controlada al alcanzar el umbral de seguridad (27 min). Los correos no procesados permanecen sin leer y serán retomados en la siguiente ejecución.` |

> [!NOTE]
> El evento `SUSPENSION_CONTROLADA_TIEMPO` **no indica una falla**. Es un registro de auditoría informativo. Solo requiere atención si aparece repetidamente para el mismo municipio con cero facturas procesadas, lo que podría indicar que una sola factura está tardando demasiado en procesarse (posible problema de OCR o conectividad).

### ⚙️ Umbrales de Tiempo por Tipo de Licencia

El sistema detecta automáticamente el tipo de cuenta con la que se ejecuta y ajusta el umbral de seguridad:

| Tipo de Licencia | Límite Nativo de GAS | Umbral Configurado | Margen de Seguridad |
|---|---|---|---|
| Gmail estándar (`@gmail.com`) | 6 minutos | 4.6 minutos | ~1.4 min |
| Google Workspace Empresarial | **30 minutos** | **27 minutos** | ~3 min |

---

## 9. Seguridad, Concurrencia y Unidades Compartidas (v7.6)

El sistema incluye mecanismos avanzados para operar con seguridad en entornos empresariales:

### 🔒 Control de Concurrencia (Script Locking)
Para evitar que ejecuciones simultáneas (dos usuarios diferentes abriendo la Consola o un Trigger coincidiendo con un proceso manual) inserten registros duplicados de las mismas facturas, el sistema implementa `LockService`. 
*   Si una instancia está en ejecución, la segunda esperará hasta 30 segundos. Si el bloqueo continúa, la segunda ejecución se abortará con un aviso seguro sin duplicar datos ni archivos.

### 🏢 Soporte nativo para Unidades Compartidas (Shared Drives)
El sistema ha sido estructurado para anclarse a la **carpeta contenedora donde reside el archivo de Google Sheets activo**. 
*   Esto significa que puedes mover la hoja contable y todo el ecosistema dentro de una **Unidad Compartida (Shared Drive)** de Google Workspace. Las carpetas cronológicas y logs se mantendrán dentro del espacio compartido corporativo y no en la carpeta personal de "Mi Unidad" del usuario que ejecute la acción.


> [!IMPORTANT]
> No se requiere ninguna configuración manual para cambiar estos umbrales. El sistema los detecta automáticamente al inicio de cada ejecución según el correo del usuario autenticado en la sesión de Apps Script.
