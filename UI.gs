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
    .setTitle('GAS Control') // Actualizado para auditoría visual
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
      if (hoja && hoja.getLastRow() > 1) {
        const lastRow = hoja.getLastRow();
        const ids = hoja.getRange(2, 2, lastRow - 1, 1).getValues();
        ids.forEach(r => { if (r[0] !== undefined && r[0] !== null) idsSet.add(r[0].toString().trim()); });
        
        const hashes = hoja.getRange(2, 22, lastRow - 1, 1).getValues();
        hashes.forEach(r => { if (r[0] !== undefined && r[0] !== null) hashesSet.add(r[0].toString().trim()); });
      }
      cachePorMunicipio[key] = { ids: idsSet, hashes: hashesSet };
    });
    
    // El motor procesa los XML locales y busca su PDF huérfano correspondiente
    for (let fXml of listaXml) {
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
    if (hoja.getLastRow() === 0) {
      hoja.appendRow(ENCABEZADOS_ESTANDAR);
      hoja.getRange(1, 1, 1, ENCABEZADOS_ESTANDAR.length).setFontWeight("bold").setBackground("#EAEEF3");
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
  SpreadsheetApp.getUi().alert("Ecosistema de pestañas contables verificado e inicializado correctamente.\n\nEtiquetas Gmail validadas y auto-creadas en caso de ausencia.");
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
      
      const lastRow = hoja.getLastRow();
      if (lastRow < 2) continue;
      
      // Leer las columnas de la hoja contable
      const datosRange = hoja.getRange(2, 1, lastRow - 1, 22);
      const filas = datosRange.getValues();
      
      for (let i = 0; i < filas.length; i++) {
        // Evaluar tiempo de ejecución antes de procesar cada PDF contable (QA v8.1)
        if ((new Date().getTime() - tiempoInicio) > limiteMs) {
          limiteAlcanzado = true;
          break;
        }
        
        const filaActual = filas[i];
        let claveCatastral = filaActual[14]; // Col 15 (Clave Catastral)
        const pdfUrl = filaActual[19];       // Col 20 (Enlace PDF)
        
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
              hoja.getRange(i + 2, 15).setValue(metaPdf.claveCatastral);
              actualizados++;
            } else {
              // Si el OCR fue exitoso pero no contiene clave válida, marcamos para no reprocesar
              hoja.getRange(i + 2, 15).setValue("No Detectada");
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
 * METRICAS DE BACKFILL: CONTABILIZAR PENDIENTES
 */
function apiObtenerMetricasBackfill() {
  const ss = obtenerHojaCalculoEcosistema();
  const claves = Object.keys(CONFIG_MUNICIPIOS);
  let totalPendientes = 0;
  
  for (let clave of claves) {
    const config = CONFIG_MUNICIPIOS[clave];
    const hoja = ss.getSheetByName(config.hojaDestino);
    if (!hoja) continue;
    
    const lastRow = hoja.getLastRow();
    if (lastRow < 2) continue;
    
    // Leer rango que contiene RFC Emisor (Col 5), Clave Catastral (Col 15), Fecha Límite (Col 17) y Referencia (Col 18)
    const datosRange = hoja.getRange(2, 1, lastRow - 1, 18);
    const filas = datosRange.getValues();
    
    for (let r = 0; r < filas.length; r++) {
      const fila = filas[r];
      const rfc = fila[4];        // Col 5
      const claveCat = fila[14];  // Col 15
      const fechaLim = fila[16];  // Col 17
      const refBanc = fila[17];   // Col 18
      
      // Si la fila no tiene RFC, se asume fila vacía de plantilla y se ignora
      if (!rfc || rfc.toString().trim() === "") continue;
      
      const necClave = !claveCat || claveCat.toString().trim() === "" || claveCat.toString().trim().toUpperCase() === "N/A";
      const necFecha = !fechaLim || fechaLim.toString().trim() === "" || fechaLim.toString().trim().toUpperCase() === "N/A";
      const necRef = !refBanc || refBanc.toString().trim() === "" || refBanc.toString().trim().toUpperCase() === "N/A";
      
      if (necClave || necFecha || necRef) {
        totalPendientes++;
      }
    }
  }
  return { totalPendientes: totalPendientes };
}

/**
 * ENRIQUECIMIENTO HISTÓRICO POR LOTES (v8.2)
 * Procesa un máximo de 5 PDFs por ejecución para mostrar avance en tiempo real.
 */
function apiProcesarLoteBackfill() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // Candado rápido de 15 segundos
  } catch (errLock) {
    return { exito: false, mensaje: "⚠️ El sistema está ocupado. Intenta de nuevo en unos segundos." };
  }

  const ss = obtenerHojaCalculoEcosistema();
  const hojaErrores = obtenerOCrearHojaEnSpreadsheet(ss, "⚠️ Errores_Cola");
  const claves = Object.keys(CONFIG_MUNICIPIOS);
  
  const MAX_BATCH_OCR = 5; // Lote controlado de 5 archivos por petición
  let ocrRealizados = 0;
  let actualizados = 0;
  let noDetectados = 0;
  let hojaTrabajada = "";
  
  try {
    for (let clave of claves) {
      const config = CONFIG_MUNICIPIOS[clave];
      if (ocrRealizados >= MAX_BATCH_OCR) break;
      
      const hoja = ss.getSheetByName(config.hojaDestino);
      if (!hoja) continue;
      
      const lastRow = hoja.getLastRow();
      if (lastRow < 2) continue;
      
      hojaTrabajada = config.hojaDestino; // Registra la hoja actual en proceso
      
      const datosRange = hoja.getRange(2, 1, lastRow - 1, 22);
      const filas = datosRange.getValues();
      
      for (let i = 0; i < filas.length; i++) {
        if (ocrRealizados >= MAX_BATCH_OCR) break;
        
        const filaActual = filas[i];
        let claveCatastral = filaActual[14]; // Col 15 (Clave Catastral)
        let fechaLim = filaActual[16];       // Col 17 (Fecha Límite Pago)
        let refBanc = filaActual[17];        // Col 18 (Referencia Bancaria)
        const pdfUrl = filaActual[19];       // Col 20 (Enlace PDF)
        const rfcEmisor = filaActual[4];     // Col 5 (RFC Emisor)
        
        // Si no hay RFC Emisor, es una fila vacía y la ignoramos
        if (!rfcEmisor || rfcEmisor.toString().trim() === "") continue;
        
        const necClave = !claveCatastral || claveCatastral.toString().trim() === "" || claveCatastral.toString().trim().toUpperCase() === "N/A";
        const necFecha = !fechaLim || fechaLim.toString().trim() === "" || fechaLim.toString().trim().toUpperCase() === "N/A";
        const necRef = !refBanc || refBanc.toString().trim() === "" || refBanc.toString().trim().toUpperCase() === "N/A";
        
        if (necClave || necFecha || necRef) {
          const fileId = extraerIdDeUrlDrive(pdfUrl);
          if (!fileId) {
            if (necClave) hoja.getRange(i + 2, 15).setValue("Enlace Inválido");
            if (necFecha) hoja.getRange(i + 2, 17).setValue("Enlace Inválido");
            if (necRef) hoja.getRange(i + 2, 18).setValue("Enlace Inválido");
            continue;
          }
          
          ocrRealizados++;
          try {
            // 1. Intentar abrir el archivo (Verifica existencia y permisos)
            let pdfFile;
            try {
              pdfFile = DriveApp.getFileById(fileId);
            } catch (errFile) {
              if (necClave) hoja.getRange(i + 2, 15).setValue("Error Acceso PDF");
              if (necFecha) hoja.getRange(i + 2, 17).setValue("Error Acceso PDF");
              if (necRef) hoja.getRange(i + 2, 18).setValue("Error Acceso PDF");
              hojaErrores.appendRow([new Date(), "BACKFILL_FILE_ACCESS_ERROR", `Fila ${i + 2} (${config.hojaDestino})`, errFile.toString()]);
              continue;
            }
            
            // 2. Intentar ejecutar el OCR
            const pdfTexto = extraerTextoDelPdfConOCR(pdfFile, hojaErrores);
            if (pdfTexto === null) {
              if (necClave) hoja.getRange(i + 2, 15).setValue("Error Lectura PDF");
              if (necFecha) hoja.getRange(i + 2, 17).setValue("Error Lectura PDF");
              if (necRef) hoja.getRange(i + 2, 18).setValue("Error Lectura PDF");
              continue;
            }
            // 3. Analizar el texto
            const metaPdf = analizarTextoPdfInversivo(pdfTexto, clave);
            
            // Actualizar Clave Catastral
            if (necClave) {
              if (metaPdf.claveCatastral && metaPdf.claveCatastral !== "N/A") {
                hoja.getRange(i + 2, 15).setValue(metaPdf.claveCatastral);
                actualizados++;
              } else {
                hoja.getRange(i + 2, 15).setValue("No Detectada");
                noDetectados++;
              }
            }
            
            // Actualizar Fecha Límite Pago
            if (necFecha) {
              if (metaPdf.fechaLimitePago && metaPdf.fechaLimitePago !== "N/A") {
                hoja.getRange(i + 2, 17).setValue(metaPdf.fechaLimitePago);
              } else {
                hoja.getRange(i + 2, 17).setValue("No Detectada");
              }
            }
            
            // Actualizar Referencia Bancaria
            if (necRef) {
              if (metaPdf.referenciaCliente && metaPdf.referenciaCliente !== "N/A") {
                hoja.getRange(i + 2, 18).setValue(metaPdf.referenciaCliente);
              } else {
                hoja.getRange(i + 2, 18).setValue("No Detectada");
              }
            }
            
          } catch (errOcr) {
            if (necClave) hoja.getRange(i + 2, 15).setValue("Error Proceso");
            if (necFecha) hoja.getRange(i + 2, 17).setValue("Error Proceso");
            if (necRef) hoja.getRange(i + 2, 18).setValue("Error Proceso");
            hojaErrores.appendRow([new Date(), "BACKFILL_OCR_ERROR", `Fila ${i + 2} (${config.hojaDestino})`, errOcr.toString()]);
          }
        }
      }
    }
    
    // Contabilizar restantes
    const metricas = apiObtenerMetricasBackfill();
    
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