// =================================================================
// MODULO: INTERFAZ DE USUARIO (Capa UI y Rutinas Puente de Drive)
// =================================================================

/**
 * GESTOR DE EVENTOS: AL ABRIR EL LIBRO (onOpen)
 * Crea el menú personalizado de forma nativa en la barra superior de Google Sheets.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🏢 Consola CFDI')
    .addItem('🎛️ Abrir Consola Central', 'mostrarSidebar')
    .addSeparator()
    // Descomentar las siguientes líneas si se requiere habilitar herramientas de depuración avanzadas en el menú:
    // .addItem('🧹 Depurar Duplicados en Hoja (Cancún)', 'ejecutarLimpiezaCancun')
    // .addItem('📁 Limpiar Archivos Huérfanos en Drive (Cancún)', 'ejecutarLimpiezaHuerfanosDriveCancun')
    // .addSeparator()
    .addItem('⚙️ Forzar Reindexación de Hojas', 'inicializarEcosistemaHojas')
    .addToUi();
}

/**
 * DESPLIEGUE DEL PANEL LATERAL (Sidebar)
 * Carga el archivo HTML embebido, configura el título y renderiza la interfaz.
 */
function mostrarSidebar() {
  const html = HtmlService.createTemplateFromFile('Interfaz')
    .evaluate()
    .setTitle('Panel de Control') // Actualizado para consistencia visual
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
    
  SpreadsheetApp.getUi().showSidebar(html);
}


// =================================================================
// FUNCIONES COMPLEMENTARIAS: RUTINAS DE RESPALDO (MÓDULO DRIVE LOCAL)
// =================================================================

/**
 * EXTRACTOR FALLBACK MIGRADO (Consola Local Histórica)
 * Esta función responde al botón de la UI "apiOrganizarCarpetaDescargados".
 * Escanea la carpeta física "Facturas no Organizadas" por si el usuario subió archivos a Drive a mano.
 */
function apiOrganizarCarpetaDescargados() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // Esperar hasta 30 segundos
  } catch (errLock) {
    return { exito: false, mensaje: "⚠️ El sistema está ocupado procesando otra operación. Por favor, intenta de nuevo en un momento." };
  }

  try {
    const libroCalculo = obtenerHojaCalculoEcosistema();
    const hojaErrores = obtenerOCrearHojaEnSpreadsheet(libroCalculo, "⚠️ Errores_Cola");
    
    const carpetaEcosistema = obtenerCarpetaEcosistemaRaiz();
    const carpetaDesorganizada = obtenerOCrearCarpeta(NOMBRE_CARPETA_DESORGANIZADA, carpetaEcosistema);
    
    let listaXml = [];
    let listaPdf = [];
    
    // Escaneo recursivo de la carpeta desorganizada local
    listarArchivosRecursivamente(carpetaDesorganizada, listaXml, listaPdf);
    
    let procesadosLocal = 0;
    
    // Precarga de cache en memoria por municipio para acelerar carga local (QA v7.5)
    const cachePorMunicipio = {};
    Object.keys(CONFIG_MUNICIPIOS).forEach(key => {
      const config = CONFIG_MUNICIPIOS[key];
      const hoja = libroCalculo.getSheetByName(config.hojaDestino);
      const idsSet = new Set();
      const hashesSet = new Set();
      const offset = (key === "CANCUN") ? 1 : 0;
      if (hoja && hoja.getLastRow() > 1) {
        const lastRow = hoja.getLastRow();
        const ids = hoja.getRange(2, 16 + offset, lastRow - 1, 1).getValues();
        ids.forEach(r => { if (r[0] !== undefined && r[0] !== null) idsSet.add(r[0].toString().trim()); });
        
        const hashes = hoja.getRange(2, 17 + offset, lastRow - 1, 1).getValues();
        hashes.forEach(r => { if (r[0] !== undefined && r[0] !== null) hashesSet.add(r[0].toString().trim()); });
      }
      cachePorMunicipio[key] = { ids: idsSet, hashes: hashesSet };
    });
    
    // El motor procesa los XML locales y busca su PDF huérfano correspondiente
    for (let fXml of listaXml) {
      if (checkCancellationFlag()) {
        break;
      }
      let xmlString = fXml.getBlob().getDataAsString();
      let metaXml = mapearMetadatosXml(xmlString);
      
      if (metaXml.rfcEmisor === "N/A") {
        hojaErrores.appendRow([new Date(), "LOCAL_XML_CORRUPTO", fXml.getName(), "No se pudo leer el XML en el Drive de carga manual."]);
        continue;
      }
      
      // Decidir nodo de municipio contable destino analizando los datos fiscales extraídos
      let claveMunicipioCalculada = determinarMunicipioPorEntidad(metaXml.emisor, metaXml.rfcEmisor);
      const cache = cachePorMunicipio[claveMunicipioCalculada];
      
      // Buscar match de PDF local mediante similitud de nombre (UUID o Folio) sin caer en falsos positivos de "N/A" (QA v7.7)
      let fPdfMatch = listaPdf.find(p => {
        let nMin = p.getName().toLowerCase();
        const tieneUuid = metaXml.uuid && metaXml.uuid !== "N/A";
        const tieneFolio = metaXml.folio && metaXml.folio !== "N/A" && metaXml.folio !== "SF";
        
        return (tieneUuid && nMin.includes(metaXml.uuid.toLowerCase())) || 
               (tieneFolio && nMin.includes(metaXml.folio.toLowerCase()));
      });
      
      if (!fPdfMatch) {
        hojaErrores.appendRow([new Date(), "LOCAL_PDF_HUERFANO", fXml.getName(), "Se encontró el XML en Drive local pero no su archivo PDF compañero."]);
        continue;
      }
      
      // Generación de metadatos simulados (Mocking) de alta precisión para trazabilidad
      let idSimulado = `DRIVE_LOCAL_${fXml.getId().substring(0, 8)}`;
      let fechaCreacion = fXml.getDateCreated() || new Date();
      let asuntoSimulado = `Carga Local Manual - Archivo: ${fXml.getName()}`;
      
      // Evitar duplicados en carga manual local antes de procesar el OCR (QA v7.5)
      if (cache && cache.ids.has(idSimulado)) {
        try {
          fXml.setTrashed(true);
          fPdfMatch.setTrashed(true);
        } catch (errLimpieza) {}
        procesadosLocal++; // Se cuenta como procesado (ya limpio de entrada)
        continue;
      }
      
      // === INYECCIÓN DE CAUTELA PARAMÉTRICA v7.3 extendida con Caché (QA v7.5) ===
      // Se envían los blobs y datos de manera secuencial e individual, respetando la firma del Core
      let simulacionExito = inyectarArchivosAMotorContable(
        fPdfMatch,               // 1. pdfAttachment
        fXml,                    // 2. xmlAttachment
        claveMunicipioCalculada, // 3. municipioClave ("PLAYA", "TULUM", "CANCUN")
        idSimulado,              // 4. messageId
        fechaCreacion,           // 5. fechaOrigen
        asuntoSimulado,          // 6. asuntoOrigen
        cache ? cache.ids : null,
        cache ? cache.hashes : null
      );
      
      if (simulacionExito) {
        // Rutina de Limpieza Preventiva e Higiene de la carpeta Desorganizada
        // Una vez copiado y renombrado con éxito en el árbol cronológico, se remueven de la entrada
        try {
          fXml.setTrashed(true);
          fPdfMatch.setTrashed(true);
        } catch (errLimpieza) {
          Logger.log(`Aviso: Archivos procesados pero no se pudieron enviar a la papelera: ${errLimpieza.toString()}`);
        }
        procesadosLocal++;
      }
    }
    
    const ssId = libroCalculo.getId();
    const parents = DriveApp.getFileById(ssId).getParents();
    const carpetaPadreSheet = parents.hasNext() ? parents.next() : DriveApp;
    
    return {
      exito: true,
      mensaje: `Proceso de Drive Local Completado con Versión 7.7:\n\n` +
               `📍 Carpeta analizada: "${carpetaDesorganizada.getName()}"\n` +
               `🆔 ID de carpeta: ${carpetaDesorganizada.getId()}\n` +
               `🗂️ Ruta esperada: ${carpetaPadreSheet.getName()} > ${carpetaEcosistema.getName()} > ${carpetaDesorganizada.getName()}\n\n` +
               `✅ Archivos emparejados, renombrados e integrados: ${procesadosLocal}`
    };
    
  } catch (error) {
    return { exito: false, mensaje: `Error en Consola Local: ${error.toString()}` };
  } finally {
    lock.releaseLock();
  }
}


// =================================================================
// UTILERÍAS DE INFRAESTRUCTURA DE DATOS (File Helpers)
// =================================================================

function listarArchivosRecursivamente(carpeta, listaXml, listaPdf) {
  const archivos = carpeta.getFiles();
  while (archivos.hasNext()) {
    const f = archivos.next();
    const name = f.getName().toLowerCase();
    if (name.endsWith('.xml')) listaXml.push(f);
    else if (name.endsWith('.pdf')) listaPdf.push(f);
  }
  const subCarpetas = carpeta.getFolders();
  while (subCarpetas.hasNext()) {
    listarArchivosRecursivamente(subCarpetas.next(), listaXml, listaPdf);
  }
}

function determinarMunicipioPorEntidad(nombreEmisor, rfcEmisor) {
  const str = (nombreEmisor + " " + rfcEmisor).toLowerCase();
  if (str.includes("benito") || str.includes("cancun") || str.includes("mbj")) return "CANCUN";
  if (str.includes("solidaridad") || str.includes("playa")) return "PLAYA";
  if (str.includes("tulum")) return "TULUM";
  return "CANCUN"; // Nodo de contingencia por defecto
}

function obtenerCarpetaEcosistemaRaiz() {
  const ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
  const parents = DriveApp.getFileById(ssId).getParents();
  // Cláusula de cautela: si no hay carpeta padre (ej: raíz), usar DriveApp directo (QA v7.7)
  const carpetaPadreSheet = parents.hasNext() ? parents.next() : DriveApp;
  
  // Si el Spreadsheet ya está ubicado dentro de la carpeta principal, usarla como raíz directamente (QA v7.8)
  if (carpetaPadreSheet.getName() === CARPETA_CONTENEDORA_PRINCIPAL) {
    return carpetaPadreSheet;
  }
  
  const carpetas = carpetaPadreSheet.getFoldersByName(CARPETA_CONTENEDORA_PRINCIPAL);
  return carpetas.hasNext() ? carpetas.next() : carpetaPadreSheet.createFolder(CARPETA_CONTENEDORA_PRINCIPAL);
}

function obtenerHojaCalculoEcosistema() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * UTILERÍA DE INFRAESTRUCTURA: GESTOR DE DIRECTORIOS (v7.5)
 * Busca la existencia de una carpeta por nombre o la crea.
 * Cláusula de Cautela: Si 'padre' es omitido o undefined, muta automáticamente a la raíz de DriveApp.
 */
function obtenerOCrearCarpeta(nombre, padre) {
  // Si no se envía el objeto padre, se asigna por defecto el entorno raíz de DriveApp
  const directorioOrigen = padre ? padre : DriveApp;
  
  const coleccion = directorioOrigen.getFoldersByName(nombre);
  return coleccion.hasNext() ? coleccion.next() : directorioOrigen.createFolder(nombre);
}

function obtenerOCrearHojaEnSpreadsheet(ss, nombre) {
  let h = ss.getSheetByName(nombre);
  return h ? h : ss.insertSheet(nombre);
}

function inicializarEcosistemaHojas() {
  const ss = obtenerHojaCalculoEcosistema();
  Object.keys(CONFIG_MUNICIPIOS).forEach(clave => {
    let hoja = obtenerOCrearHojaEnSpreadsheet(ss, CONFIG_MUNICIPIOS[clave].hojaDestino);
    const encabezados = obtenerEncabezadosPorMunicipio(clave);
    const offset = (clave === "CANCUN") ? 1 : 0;

    if (hoja.getLastRow() === 0) {
      hoja.appendRow(encabezados);
      hoja.getRange(1, 1, 1, encabezados.length).setFontWeight("bold").setBackground("#EAEEF3");
    } else {
      // Migración segura si la hoja ya contiene datos pero le falta la columna Padrón en Cancún
      const headersExistentes = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
      if (clave === "CANCUN" && !headersExistentes.includes("Padrón")) {
        hoja.insertColumnBefore(12);
        hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados])
            .setFontWeight("bold").setBackground("#EAEEF3");
      }
    }
    
    // Ocultar columnas técnicas (15-17 en estándar, 16-18 en Cancún)
    if (hoja.getMaxColumns() >= (17 + offset)) {
      hoja.hideColumns(15 + offset, 3);
    }
    
    // Proteger columnas técnicas contra edición accidental
    try {
      const protecciones = hoja.getProtections(SpreadsheetApp.ProtectionType.RANGE);
      protecciones.forEach(p => {
        if (p.getDescription() === "Protección de Columnas Técnicas") {
          p.remove();
        }
      });
      
      const proteccion = hoja.protect().setDescription("Protección de Columnas Técnicas");
      // Permitir editar solo las columnas visibles (1-14 en estándar, 1-15 en Cancún)
      proteccion.setUnprotectedRanges([hoja.getRange(1, 1, hoja.getMaxRows(), 14 + offset)]);
    } catch (errProt) {
      Logger.log("Aviso: No se pudo establecer protección: " + errProt.toString());
    }
    
    // Verificación y auto-creación automática de etiquetas en Gmail (QA v7.5)
    const labelNombre = CONFIG_MUNICIPIOS[clave].label;
    if (labelNombre) {
      const etiquetaExiste = GmailApp.getUserLabelByName(labelNombre);
      if (!etiquetaExiste) {
        GmailApp.createLabel(labelNombre);
      }
    }
  });
  obtenerOCrearHojaEnSpreadsheet(ss, "⚠️ Errores_Cola");
  SpreadsheetApp.getUi().alert("Ecosistema de pestañas contables verificado e inicializado correctamente.\n\nEtiquetas Gmail validadas y auto-creadas, y columnas de control ocultadas y protegidas.");
}

/**
 * ENRIQUECIMIENTO HISTÓRICO (DATA BACKFILL) DE CLAVES CATASTRALES (v8.1)
 * Barre las hojas contables buscando registros con Clave Catastral "N/A" o vacía,
 * recupera su PDF de Drive mediante su enlace directo, ejecuta OCR y actualiza el Sheet.
 */
function apiActualizarClavesCatastralesHistoricas() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // Candado de concurrencia de 30s
  } catch (errLock) {
    return { exito: false, mensaje: "⚠️ El sistema está ocupado procesando otro lote de facturas. Por favor, intenta de nuevo en un momento." };
  }

  const ss = obtenerHojaCalculoEcosistema();
  const hojaErrores = obtenerOCrearHojaEnSpreadsheet(ss, "⚠️ Errores_Cola");
  const claves = Object.keys(CONFIG_MUNICIPIOS);
  
  let tiempoInicio = new Date().getTime();
  let limiteMs = obtenerLimiteTiempoProcesamientoMs();
  
  let actualizados = 0;
  let limiteAlcanzado = false;

  try {
    for (let clave of claves) {
      const config = CONFIG_MUNICIPIOS[clave];
      const hoja = ss.getSheetByName(config.hojaDestino);
      if (!hoja) continue;
      
      const offset = (clave === "CANCUN") ? 1 : 0;
      
      const lastRow = hoja.getLastRow();
      if (lastRow < 2) continue;
      
      // Leer las columnas de la hoja contable
      const datosRange = hoja.getRange(2, 1, lastRow - 1, 17 + offset);
      const filas = datosRange.getValues();
      
      for (let i = 0; i < filas.length; i++) {
        // Evaluar tiempo de ejecución antes de procesar cada PDF contable (QA v8.1)
        if ((new Date().getTime() - tiempoInicio) > limiteMs) {
          limiteAlcanzado = true;
          break;
        }
        
        const filaActual = filas[i];
        let claveCatastral = filaActual[7]; // Col 8 (Clave Catastral)
        const pdfUrl = filaActual[12 + offset];       // Col 13 / Col 14 (Enlace PDF)
        
        // Si el valor es N/A o vacío, iniciamos backfill
        if (!claveCatastral || claveCatastral.toString().trim().toUpperCase() === "N/A" || claveCatastral.toString().trim() === "") {
          const fileId = extraerIdDeUrlDrive(pdfUrl);
          if (!fileId) continue;
          
          try {
            const pdfFile = DriveApp.getFileById(fileId);
            const pdfTexto = extraerTextoDelPdfConOCR(pdfFile, hojaErrores);
            
            if (pdfTexto === null) {
              // Si el OCR falló por red/temporal, no marcamos la celda para reintentar después
              continue;
            }
            
            const metaPdf = analizarTextoPdfInversivo(pdfTexto);
            
            if (metaPdf.claveCatastral && metaPdf.claveCatastral !== "N/A") {
              // Clave encontrada con éxito
              hoja.getRange(i + 2, 8).setValue("'" + metaPdf.claveCatastral);
              actualizados++;
            } else {
              // Si el OCR fue exitoso pero no contiene clave válida, marcamos para no reprocesar
              hoja.getRange(i + 2, 8).setValue("No Detectada");
            }
          } catch (errOcr) {
            hojaErrores.appendRow([new Date(), "BACKFILL_OCR_ERROR", `Fila ${i + 2} (${config.hojaDestino})`, errOcr.toString()]);
          }
        }
      }
      
      if (limiteAlcanzado) break;
    }
    
    if (limiteAlcanzado) {
      return {
        exito: true,
        mensaje: `⏱️ Proceso de Backfill Parcial\n\n` +
                 `Se alcanzó el límite de tiempo de seguridad de la cuenta.\n\n` +
                 `✅ Claves catastrales recuperadas y actualizadas: ${actualizados}\n\n` +
                 `ℹ️ Vuelve a ejecutar la opción para continuar procesando las facturas pendientes.`
      };
    }
    
    return {
      exito: true,
      mensaje: `✅ Proceso de Backfill Completado\n\n` +
               `Se analizaron los registros históricos.\n\n` +
               `✅ Claves catastrales recuperadas y actualizadas con éxito: ${actualizados}`
    };
    
  } catch (err) {
    return { exito: false, mensaje: `Fallo Crítico en Backfill: ${err.toString()}` };
  } finally {
    lock.releaseLock(); // Liberar candado
  }
}

/**
 * UTILIDAD: EXTRACTOR DE ID DE ARCHIVOS DE DRIVE
 */
function extraerIdDeUrlDrive(url) {
  if (!url) return null;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]{25,50})/i) || url.match(/id=([a-zA-Z0-9_-]{25,50})/i);
  return match ? match[1] : null;
}

/**
 * METRICAS DE BACKFILL: CONTABILIZAR PENDIENTES CON ÁMBITO Y CAMPOS SELECCIONADOS (v9.3)
 */
function apiObtenerMetricasBackfill(scope, campos) {
  const ss = obtenerHojaCalculoEcosistema();
  let claves = Object.keys(CONFIG_MUNICIPIOS);
  let resolvedScope = scope; // Snapshot del ámbito resuelto para congelar en el cliente
  
  if (scope === "ACTIVE") {
    const activeSheetName = ss.getActiveSheet().getName();
    const match = Object.keys(CONFIG_MUNICIPIOS).find(k => CONFIG_MUNICIPIOS[k].hojaDestino === activeSheetName);
    claves = match ? [match] : [];
    resolvedScope = match ? match : "NONE"; // Congelar al municipio concreto detectado
  } else if (scope && scope !== "ALL") {
    claves = [scope];
    resolvedScope = scope;
  }
  
  // Si campos es omitido, activar todos por defecto para retrocompatibilidad
  const c = campos || { claveCatastral: true, padron: true, fechaLimite: true, referencia: true };
  let totalPendientes = 0;
  
  for (let clave of claves) {
    const config = CONFIG_MUNICIPIOS[clave];
    const hoja = ss.getSheetByName(config.hojaDestino);
    if (!hoja) continue;
    
    const lastRow = hoja.getLastRow();
    if (lastRow < 2) continue;
    
    const offset = (clave === "CANCUN") ? 1 : 0;
    
    // Leer rango que contiene Fecha Emisión (Col 1), Clave Catastral (Col 8), Fecha Límite (Col 10), Referencia (Col 11) y Padrón (Col 12 si aplica)
    const datosRange = hoja.getRange(2, 1, lastRow - 1, 11 + offset);
    const filas = datosRange.getValues();
    
    for (let r = 0; r < filas.length; r++) {
      const fila = filas[r];
      const fechaEmision = fila[0]; // Col 1
      const claveCat = fila[7];     // Col 8
      const fechaLim = fila[9];     // Col 10
      const refBanc = fila[10];     // Col 11
      const padron = (offset === 1) ? fila[11] : "N/A"; // Col 12
      
      // Si la fila no tiene Fecha Emisión, se asume fila vacía de plantilla y se ignora
      if (!fechaEmision || fechaEmision.toString().trim() === "") continue;
      
      const necClave = c.claveCatastral && (!claveCat || claveCat.toString().trim() === "" || claveCat.toString().trim().toUpperCase() === "N/A");
      const necFecha = c.fechaLimite && (!fechaLim || fechaLim.toString().trim() === "" || fechaLim.toString().trim().toUpperCase() === "N/A");
      const necRef = c.referencia && (!refBanc || refBanc.toString().trim() === "" || refBanc.toString().trim().toUpperCase() === "N/A");
      const necPadron = c.padron && (offset === 1) && (!padron || padron.toString().trim() === "" || padron.toString().trim().toUpperCase() === "N/A");
      
      if (necClave || necFecha || necRef || necPadron) {
        totalPendientes++;
      }
    }
  }
  return { totalPendientes: totalPendientes, resolvedScope: resolvedScope };
}

/**
 * ENRIQUECIMIENTO HISTÓRICO POR LOTES, ÁMBITO Y CAMPOS SELECCIONADOS (v9.3)
 * Procesa un máximo de 5 PDFs por ejecución para mostrar avance en tiempo real.
 */
function apiProcesarLoteBackfill(scope, campos) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // Candado rápido de 15 segundos
  } catch (errLock) {
    return { exito: false, mensaje: "⚠️ El sistema está ocupado. Intenta de nuevo en unos segundos." };
  }

  const ss = obtenerHojaCalculoEcosistema();
  const hojaErrores = obtenerOCrearHojaEnSpreadsheet(ss, "⚠️ Errores_Cola");
  
  let claves = Object.keys(CONFIG_MUNICIPIOS);
  if (scope === "ACTIVE") {
    const activeSheetName = ss.getActiveSheet().getName();
    const match = Object.keys(CONFIG_MUNICIPIOS).find(k => CONFIG_MUNICIPIOS[k].hojaDestino === activeSheetName);
    claves = match ? [match] : [];
  } else if (scope && scope !== "ALL") {
    claves = [scope];
  }
  
  const c = campos || { claveCatastral: true, padron: true, fechaLimite: true, referencia: true };
  const MAX_BATCH_OCR = 5; // Lote controlado de 5 archivos por petición
  let ocrRealizados = 0;
  let actualizados = 0;
  let noDetectados = 0;
  let hojaTrabajada = "";
  
  try {
    for (let clave of claves) {
      if (checkCancellationFlag()) break;
      
      const config = CONFIG_MUNICIPIOS[clave];
      if (ocrRealizados >= MAX_BATCH_OCR) break;
      
      const hoja = ss.getSheetByName(config.hojaDestino);
      if (!hoja) continue;
      
      const lastRow = hoja.getLastRow();
      if (lastRow < 2) continue;
      
      hojaTrabajada = config.hojaDestino; // Registra la hoja actual en proceso
      const offset = (clave === "CANCUN") ? 1 : 0;
      
      const datosRange = hoja.getRange(2, 1, lastRow - 1, 17 + offset);
      const filas = datosRange.getValues();
      
      for (let i = 0; i < filas.length; i++) {
        if (checkCancellationFlag()) break;
        if (ocrRealizados >= MAX_BATCH_OCR) break;
        
        const filaActual = filas[i];
        let claveCatastral = filaActual[7];  // Col 8 (Clave Catastral)
        let fechaLim = filaActual[9];        // Col 10 (Fecha Límite Pago)
        let refBanc = filaActual[10];        // Col 11 (Referencia Bancaria)
        let padron = (offset === 1) ? filaActual[11] : "N/A"; // Col 12 (Padrón Cancún)
        const pdfUrl = filaActual[12 + offset];       // Col 13 / 14 (Enlace PDF)
        const fechaEmision = filaActual[0];  // Col 1 (Fecha Emisión)
        
        // Si no hay Fecha Emisión, es una fila vacía y la ignoramos
        if (!fechaEmision || fechaEmision.toString().trim() === "") continue;
        
        const necClave = c.claveCatastral && (!claveCatastral || claveCatastral.toString().trim() === "" || claveCatastral.toString().trim().toUpperCase() === "N/A");
        const necFecha = c.fechaLimite && (!fechaLim || fechaLim.toString().trim() === "" || fechaLim.toString().trim().toUpperCase() === "N/A");
        const necRef = c.referencia && (!refBanc || refBanc.toString().trim() === "" || refBanc.toString().trim().toUpperCase() === "N/A");
        const necPadron = c.padron && (offset === 1) && (!padron || padron.toString().trim() === "" || padron.toString().trim().toUpperCase() === "N/A");
        
        if (necClave || necFecha || necRef || necPadron) {
          const fileId = extraerIdDeUrlDrive(pdfUrl);
          if (!fileId) {
            if (necClave) hoja.getRange(i + 2, 8).setValue("Enlace Inválido");
            if (necFecha) hoja.getRange(i + 2, 10).setValue("Enlace Inválido");
            if (necRef) hoja.getRange(i + 2, 11).setValue("Enlace Inválido");
            if (necPadron) hoja.getRange(i + 2, 12).setValue("Enlace Inválido");
            continue;
          }
          
          ocrRealizados++;
          try {
            // 1. Intentar abrir el archivo (Verifica existencia y permisos)
            let pdfFile;
            try {
              pdfFile = DriveApp.getFileById(fileId);
            } catch (errFile) {
              if (necClave) hoja.getRange(i + 2, 8).setValue("Error Acceso PDF");
              if (necFecha) hoja.getRange(i + 2, 10).setValue("Error Acceso PDF");
              if (necRef) hoja.getRange(i + 2, 11).setValue("Error Acceso PDF");
              if (necPadron) hoja.getRange(i + 2, 12).setValue("Error Acceso PDF");
              hojaErrores.appendRow([new Date(), "BACKFILL_FILE_ACCESS_ERROR", `Fila ${i + 2} (${config.hojaDestino})`, errFile.toString()]);
              continue;
            }
            
            // 2. Intentar ejecutar el OCR
            const pdfTexto = extraerTextoDelPdfConOCR(pdfFile, hojaErrores);
            if (pdfTexto === null) {
              if (necClave) hoja.getRange(i + 2, 8).setValue("Error Lectura PDF");
              if (necFecha) hoja.getRange(i + 2, 10).setValue("Error Lectura PDF");
              if (necRef) hoja.getRange(i + 2, 11).setValue("Error Lectura PDF");
              if (necPadron) hoja.getRange(i + 2, 12).setValue("Error Lectura PDF");
              continue;
            }
            // 3. Analizar el texto
            const metaPdf = analizarTextoPdfInversivo(pdfTexto, clave);
            
            // Actualizar Clave Catastral
            if (necClave) {
              if (metaPdf.claveCatastral && metaPdf.claveCatastral !== "N/A") {
                hoja.getRange(i + 2, 8).setValue("'" + metaPdf.claveCatastral);
                actualizados++;
              } else {
                hoja.getRange(i + 2, 8).setValue("No Detectada");
                noDetectados++;
              }
            }
            
            // Actualizar Fecha Límite Pago
            if (necFecha) {
              if (metaPdf.fechaLimitePago && metaPdf.fechaLimitePago !== "N/A") {
                hoja.getRange(i + 2, 10).setValue(metaPdf.fechaLimitePago);
              } else {
                hoja.getRange(i + 2, 10).setValue("No Detectada");
              }
            }
            
            // Actualizar Referencia Bancaria
            if (necRef) {
              if (metaPdf.referenciaCliente && metaPdf.referenciaCliente !== "N/A") {
                hoja.getRange(i + 2, 11).setValue(metaPdf.referenciaCliente);
              } else {
                hoja.getRange(i + 2, 11).setValue("No Detectada");
              }
            }
            
            // Actualizar Padrón (Exclusivo Cancún)
            if (necPadron) {
              if (metaPdf.padron && metaPdf.padron !== "N/A") {
                hoja.getRange(i + 2, 12).setValue(metaPdf.padron);
              } else {
                hoja.getRange(i + 2, 12).setValue("No Detectado");
              }
            }
            
          } catch (errOcr) {
            if (necClave) hoja.getRange(i + 2, 8).setValue("Error Proceso");
            if (necFecha) hoja.getRange(i + 2, 10).setValue("Error Proceso");
            if (necRef) hoja.getRange(i + 2, 11).setValue("Error Proceso");
            if (necPadron) hoja.getRange(i + 2, 12).setValue("Error Proceso");
            hojaErrores.appendRow([new Date(), "BACKFILL_OCR_ERROR", `Fila ${i + 2} (${config.hojaDestino})`, errOcr.toString()]);
          }
        }
      }
    }
    
    // Contabilizar restantes
    const metricas = apiObtenerMetricasBackfill(scope, c);
    
    return {
      exito: true,
      completado: metricas.totalPendientes === 0,
      procesadosEnLote: ocrRealizados,
      actualizadosEnLote: actualizados,
      noDetectadosEnLote: noDetectados,
      restantes: metricas.totalPendientes,
      hojaActual: hojaTrabajada
    };
    
  } catch (err) {
    return { exito: false, mensaje: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * CANCELACIÓN DE PROCESOS (v9.2)
 * Registra la señal de cancelación en la caché de usuario para detener loops en ejecución.
 */
function apiCancelarProceso() {
  const cache = CacheService.getUserCache();
  cache.put("cancellation_flag", "true", 120); // Conserva la señal por 2 minutos
  return { exito: true, mensaje: "Señal de cancelación enviada." };
}

function apiResetearCancelacion() {
  const cache = CacheService.getUserCache();
  cache.remove("cancellation_flag");
}

function checkCancellationFlag() {
  const cache = CacheService.getUserCache();
  return cache.get("cancellation_flag") === "true";
}

/**
 * PUENTE DE MENÚ NATIVO: LIMPIEZA DE DUPLICADOS EN CANCÚN (v9.4)
 */
function ejecutarLimpiezaCancun() {
  const ui = SpreadsheetApp.getUi();
  const respuesta = ui.alert(
    '🧹 Depuración de Duplicados (Cancún)',
    '¿Estás seguro de que deseas iniciar la depuración de duplicados en la pestaña "Cancún"?\n\n' +
    'Esta herramienta:\n' +
    '1. Identificará filas con el mismo UUID Fiscal.\n' +
    '2. Conservará el registro que contenga más datos completos.\n' +
    '3. Enviará los archivos XML/PDF duplicados de Drive a la papelera.\n' +
    '4. Limpiará las filas duplicadas de la hoja contable.\n\n' +
    '¿Deseas continuar de forma segura?',
    ui.ButtonSet.YES_NO
  );

  if (respuesta === ui.Button.YES) {
    ui.showSidebar(HtmlService.createHtmlOutput('<h3>Procesando depuración de duplicados...</h3><p>Por favor espera a que se complete en segundo plano.</p>').setTitle('Depurando Ecosistema'));
    
    const resultado = apiDepurarDuplicadosPorMunicipio("CANCUN");
    
    if (resultado.exito) {
      ui.alert('🧹 Depuración Completada', resultado.mensaje, ui.ButtonSet.OK);
    } else {
      ui.alert('⚠️ Fallo en Depuración', 'Ocurrió un error: ' + resultado.mensaje, ui.ButtonSet.OK);
    }
    
    // Recargar sidebar estándar
    mostrarSidebar();
  }
}

/**
 * MOTOR DE DEPURACIÓN SEGURA DE DUPLICADOS (Spreadsheet + Drive)
 */
function apiDepurarDuplicadosPorMunicipio(municipioClave) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (errLock) {
    return { exito: false, mensaje: "El sistema está ocupado. Intenta más tarde." };
  }

  try {
    const ss = obtenerHojaCalculoEcosistema();
    const config = CONFIG_MUNICIPIOS[municipioClave];
    if (!config) return { exito: false, mensaje: "Municipio no configurado." };

    const hoja = ss.getSheetByName(config.hojaDestino);
    if (!hoja) return { exito: false, mensaje: "Hoja de destino no encontrada." };

    const lastRow = hoja.getLastRow();
    if (lastRow < 2) return { exito: true, mensaje: "No hay registros suficientes para depurar." };

    const offset = (municipioClave === "CANCUN") ? 1 : 0;
    const colUuidIndex = 4;           // Columna 5 (UUID)
    const colPdfIndex = 12 + offset;  // Columna 13 estándar / 14 Cancún (Enlace PDF)
    const colXmlIndex = 13 + offset;  // Columna 14 estándar / 15 Cancún (Enlace XML)

    const filas = hoja.getRange(2, 1, lastRow - 1, 17 + offset).getValues();
    const grupos = {};

    // Agrupar filas por UUID
    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const uuid = fila[colUuidIndex] ? fila[colUuidIndex].toString().trim() : "";
      if (uuid === "" || uuid.toUpperCase() === "N/A" || uuid.toUpperCase() === "SIN DETECTAR") continue;

      const rowNum = i + 2; // Data row starts at index 0 which corresponds to row 2
      if (!grupos[uuid]) {
        grupos[uuid] = [];
      }
      grupos[uuid].push({ index: i, rowNum: rowNum, fila: fila });
    }

    let archivosBorradosCount = 0;
    let filasBorradasCount = 0;
    const rowsToDelete = [];

    // Función interna para calcular puntuación de completitud
    const calcularScore = (info, offset) => {
      let score = 0;
      // Clave Catastral Col 8 (index 7)
      const cc = info.fila[7] ? info.fila[7].toString().trim() : "";
      if (cc !== "" && cc.toUpperCase() !== "N/A" && cc.toUpperCase() !== "NO DETECTADA" && cc.toUpperCase() !== "ENLACE INVÁLIDO") {
        score += 10;
      }
      // Fecha Límite Col 10 (index 9)
      const fl = info.fila[9] ? info.fila[9].toString().trim() : "";
      if (fl !== "" && fl.toUpperCase() !== "N/A" && fl.toUpperCase() !== "NO DETECTADA") {
        score += 5;
      }
      // Referencia Bancaria Col 11 (index 10)
      const ref = info.fila[10] ? info.fila[10].toString().trim() : "";
      if (ref !== "" && ref.toUpperCase() !== "N/A" && ref.toUpperCase() !== "NO DETECTADA") {
        score += 5;
      }
      // Padrón Col 12 (index 11) para Cancún
      if (offset === 1) {
        const pad = info.fila[11] ? info.fila[11].toString().trim() : "";
        if (pad !== "" && pad.toUpperCase() !== "N/A" && pad.toUpperCase() !== "NO DETECTADO") {
          score += 10;
        }
      }
      return score;
    };

    // Procesar cada grupo de UUIDs
    Object.keys(grupos).forEach(uuid => {
      const records = grupos[uuid];
      if (records.length > 1) {
        // Ordenar: Mayor puntuación primero, si empatan, la fila más antigua (menor rowNum) primero
        records.sort((a, b) => {
          const scoreA = calcularScore(a, offset);
          const scoreB = calcularScore(b, offset);
          if (scoreB !== scoreA) return scoreB - scoreA;
          return a.rowNum - b.rowNum;
        });

        const keeper = records[0];
        const keeperPdfId = extraerIdDeUrlDrive(keeper.fila[colPdfIndex]);
        const keeperXmlId = extraerIdDeUrlDrive(keeper.fila[colXmlIndex]);

        // Procesar los duplicados (del índice 1 en adelante)
        for (let idx = 1; idx < records.length; idx++) {
          const dup = records[idx];
          const pdfIdToDelete = extraerIdDeUrlDrive(dup.fila[colPdfIndex]);
          const xmlIdToDelete = extraerIdDeUrlDrive(dup.fila[colXmlIndex]);

          // Borrar PDF de Drive si es un archivo diferente al del registro a conservar
          if (pdfIdToDelete && pdfIdToDelete !== keeperPdfId) {
            try {
              DriveApp.getFileById(pdfIdToDelete).setTrashed(true);
              archivosBorradosCount++;
            } catch (errPdf) {
              Logger.log("Aviso: No se pudo eliminar PDF duplicado ID " + pdfIdToDelete + ": " + errPdf.toString());
            }
          }

          // Borrar XML de Drive si es un archivo diferente
          if (xmlIdToDelete && xmlIdToDelete !== keeperXmlId) {
            try {
              DriveApp.getFileById(xmlIdToDelete).setTrashed(true);
              archivosBorradosCount++;
            } catch (errXml) {
              Logger.log("Aviso: No se pudo eliminar XML duplicado ID " + xmlIdToDelete + ": " + errXml.toString());
            }
          }

          // Registrar número de fila para eliminar del Sheet
          rowsToDelete.push(dup.rowNum);
        }
      }
    });

    // Eliminar filas en orden descendente para conservar la integridad del índice de filas
    rowsToDelete.sort((a, b) => b - a);
    rowsToDelete.forEach(rNum => {
      hoja.deleteRow(rNum);
      filasBorradasCount++;
    });

    return {
      exito: true,
      mensaje: `🧹 Proceso de limpieza finalizado con éxito:\n\n` +
               `📍 Pestaña analizada: "${config.hojaDestino}"\n` +
               `🗑️ Registros duplicados eliminados en la hoja: ${filasBorradasCount}\n` +
               `🗂️ Archivos XML/PDF redundantes enviados a papelera en Drive: ${archivosBorradosCount}`
    };

  } catch (error) {
    return { exito: false, mensaje: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * PUENTE DE MENÚ NATIVO: LIMPIEZA DE ARCHIVOS HUÉRFANOS EN DRIVE (v9.5)
 */
function ejecutarLimpiezaHuerfanosDriveCancun() {
  const ui = SpreadsheetApp.getUi();
  const respuesta = ui.alert(
    '📁 Limpiar Archivos Huérfanos en Drive (Cancún)',
    '¿Estás seguro de que deseas escanear las carpetas en Drive para eliminar archivos duplicados redundantes?\n\n' +
    'Esta herramienta:\n' +
    '1. Analizará los archivos en la carpeta de Cancún (Año > Mes).\n' +
    '2. Buscará nombres de archivos con sufijos de copia (ej: "(1)", "(2)", "_1", etc.).\n' +
    '3. Verificará que el archivo base sin sufijo exista en la misma carpeta.\n' +
    '4. PROTECCIÓN EXCLUSIVA: NO eliminará ningún archivo cuyo ID esté registrado actualmente en la hoja de cálculo.\n\n' +
    '¿Deseas proceder con esta limpieza segura?',
    ui.ButtonSet.YES_NO
  );

  if (respuesta === ui.Button.YES) {
    ui.showSidebar(HtmlService.createHtmlOutput('<h3>Escanando y depurando Drive...</h3><p>Por favor espera, este proceso puede tardar unos minutos en ejecutarse.</p>').setTitle('Limpiando Drive'));
    
    const resultado = apiLimpiarArchivosHuerfanosDrive("CANCUN");
    
    if (resultado.exito) {
      ui.alert('📁 Limpieza de Drive Completada', resultado.mensaje, ui.ButtonSet.OK);
    } else {
      ui.alert('⚠️ Fallo en Limpieza de Drive', 'Ocurrió un error: ' + resultado.mensaje, ui.ButtonSet.OK);
    }
    
    mostrarSidebar();
  }
}

/**
 * MOTOR DE LIMPIEZA DE ARCHIVOS HUÉRFANOS DE DRIVE (v9.5)
 * Escanea recursivamente las carpetas y elimina los duplicados no enlazados en el Sheet.
 */
function apiLimpiarArchivosHuerfanosDrive(municipioClave) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000);
  } catch (errLock) {
    return { exito: false, mensaje: "El sistema está ocupado. Intenta más tarde." };
  }

  try {
    const ss = obtenerHojaCalculoEcosistema();
    const config = CONFIG_MUNICIPIOS[municipioClave];
    if (!config) return { exito: false, mensaje: "Municipio no configurado." };

    const hoja = ss.getSheetByName(config.hojaDestino);
    if (!hoja) return { exito: false, mensaje: "Hoja de destino no encontrada." };

    const lastRow = hoja.getLastRow();
    const fileIdsActivos = new Set();
    const offset = (municipioClave === "CANCUN") ? 1 : 0;
    const colPdfIndex = 12 + offset;
    const colXmlIndex = 13 + offset;

    // Cargar todos los IDs de archivos activos referenciados en el Google Sheet
    if (lastRow >= 2) {
      const rangoEnlaces = hoja.getRange(2, colPdfIndex + 1, lastRow - 1, 2).getValues();
      rangoEnlaces.forEach(row => {
        const pdfId = extraerIdDeUrlDrive(row[0]);
        const xmlId = extraerIdDeUrlDrive(row[1]);
        if (pdfId) fileIdsActivos.add(pdfId);
        if (xmlId) fileIdsActivos.add(xmlId);
      });
    }

    const carpetaContenedora = obtenerOCrearCarpeta(CARPETA_CONTENEDORA_PRINCIPAL);
    const carpetaRaizDescarga = obtenerOCrearCarpeta(NOMBRE_CARPETA_RAIZ, carpetaContenedora);
    const carpetasMunicipio = carpetaRaizDescarga.getFoldersByName(config.nombreCarpeta);
    if (!carpetasMunicipio.hasNext()) {
      return { exito: true, mensaje: `No se encontró la carpeta de Drive para ${config.nombreCarpeta}.` };
    }
    const carpetaRaizMunicipio = carpetasMunicipio.next();

    const idsBorrados = [];
    const errores = [];

    // Función recursiva para escaneo y triturado seguro
    const escanearLimpiezaDuplicadosCarpeta = (carpeta) => {
      // 1. Escaneo de archivos en la carpeta actual
      const archivos = carpeta.getFiles();

      while (archivos.hasNext()) {
        const file = archivos.next();
        const fId = file.getId();
        const fName = file.getName();

        // Identificar si tiene un patrón de copia común (ej: " (1).pdf", " (2).xml", "_1.pdf", "_(1).pdf", " - Copia.pdf")
        const match = fName.match(/^(.+?)(?:\s*\(\d+\)|_\d+|_\(\d+\)|\s+-\s+Copia)\.(pdf|xml)$/i);
        
        if (match) {
          // Si es un archivo de copia y NO está enlazado activamente en el Sheet, enviarlo a papelera
          if (!fileIdsActivos.has(fId)) {
            try {
              file.setTrashed(true);
              idsBorrados.push(fName + " (Papelera)");
            } catch (errTrash) {
              // Salvaguarda: Si no es propietario (acceso denegado), desvincular de la carpeta física
              try {
                carpeta.removeFile(file);
                idsBorrados.push(fName + " (Desvinculado)");
              } catch (errRemove) {
                errores.push(`${fName}: ${errRemove.toString()}`);
              }
            }
          }
        }
      }

      // 2. Escaneo recursivo de subcarpetas
      const subcarpetas = carpeta.getFolders();
      while (subcarpetas.hasNext()) {
        escanearLimpiezaDuplicadosCarpeta(subcarpetas.next());
      }
    };

    escanearLimpiezaDuplicadosCarpeta(carpetaRaizMunicipio);

    return {
      exito: true,
      mensaje: `📁 Limpieza de Drive completada de forma segura:\n\n` +
               `📍 Carpeta analizada: "${config.nombreCarpeta}"\n` +
               `🔗 Total IDs de archivos en uso protegidos: ${fileIdsActivos.size}\n` +
               `🗑️ Archivos duplicados huérfanos enviados a papelera: ${idsBorrados.length}\n\n` +
               (errores.length > 0 ? `⚠️ Errores al borrar (mostrando máx 10):\n` + errores.slice(0, 10).join("\n") : "")
    };

  } catch (error) {
    return { exito: false, mensaje: error.toString() };
  } finally {
    lock.releaseLock();
  }
}
