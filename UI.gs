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
    .setTitle('Consola de Control CFDI - v7.3') // Actualizado para auditoría visual
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
    
  SpreadsheetApp.getUi().showSidebar(html);
}


// =================================================================
// FUNCIONES COMPLEMENTARIAS: RUTINAS DE RESPALDO (MÓDULO DRIVE LOCAL)
// =================================================================

/**
 * EXTRACTOR FALLBACK MIGRADO (Consola Local Histórica)
 * Esta función responde al botón de la UI "apiOrganizarCarpetaDescargados".
 * Escanea la carpeta física "Facturas CFDI Recibidas" por si el usuario subió archivos a Drive a mano.
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
      
      // Buscar match de PDF local mediante similitud de nombre (UUID o Folio)
      let fPdfMatch = listaPdf.find(p => {
        let nMin = p.getName().toLowerCase();
        return nMin.includes(metaXml.uuid.toLowerCase()) || (metaXml.folio !== "N/A" && nMin.includes(metaXml.folio.toLowerCase()));
      });
      
      if (!fPdfMatch) {
        hojaErrores.appendRow([new Date(), "LOCAL_PDF_HUERFANO", fXml.getName(), "Se encontró el XML en Drive local pero no su archivo PDF compañero."]);
        continue;
      }
      
      // Generación de metadatos simulados (Mocking) de alta precisión para trazabilidad
      let idSimulado = `DRIVE_LOCAL_${fXml.getId().substring(0, 8)}`;
      let fechaCreacion = fXml.getDateCreated() || new Date();
      let asuntoSimulado = `Carga Local Manual - Archivo: ${fXml.getName()}`;
      
      // === INYECCIÓN DE CAUTELA PARAMÉTRICA v7.3 ===
      // Se envían los blobs y datos de manera secuencial e individual, respetando la firma del Core
      let simulacionExito = inyectarArchivosAMotorContable(
        fPdfMatch,               // 1. pdfAttachment
        fXml,                    // 2. xmlAttachment
        claveMunicipioCalculada, // 3. municipioClave ("PLAYA", "TULUM", "CANCUN")
        idSimulado,              // 4. messageId
        fechaCreacion,           // 5. fechaOrigen
        asuntoSimulado           // 6. asuntoOrigen
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
    
    return {
      exito: true,
      mensaje: `Proceso de Drive Local Completado con Versión 7.3:\n\n✅ Archivos emparejados, renombrados e integrados: ${procesadosLocal}`
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
  const carpetas = DriveApp.getFoldersByName(CARPETA_CONTENEDORA_PRINCIPAL);
  return carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(CARPETA_CONTENEDORA_PRINCIPAL);
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
  });
  obtenerOCrearHojaEnSpreadsheet(ss, "⚠️ Errores_Cola");
  SpreadsheetApp.getUi().alert("Ecosistema de pestañas contables verificado e inicializado correctamente.");
}