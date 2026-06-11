// =================================================================
// MODULO: CORE GMAIL (Extractor y Validador de Correos)
// =================================================================

let tiempoInicioGlobal = new Date().getTime();
let limiteTiempoCalculado = null;

/**
 * EVALUADOR DE EXCESO DE TIEMPO
 * Compara el tiempo transcurrido con el límite dinámico asignado por tipo de cuenta.
 * @return {boolean} true si se superó el límite seguro de ejecución, false en caso contrario.
 */
function haExcedidoTiempo() {
  if (limiteTiempoCalculado === null) {
    limiteTiempoCalculado = obtenerLimiteTiempoProcesamientoMs();
  }
  return (new Date().getTime() - tiempoInicioGlobal) > limiteTiempoCalculado;
}


/**
 * PUNTOS DE ENTRADA DESDE LA INTERFAZ (UI)
 * Estas funciones son llamadas directamente por google.script.run desde Interfaz.html
 */
function apiProcesarTodo() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // Esperar hasta 30 segundos
  } catch (errLock) {
    return { exito: false, mensaje: "⚠️ El sistema está ocupado procesando otro lote de facturas. Por favor, intenta de nuevo en un momento." };
  }

  // Reinicio del cronómetro global al inicio de cada ejecución completa
  tiempoInicioGlobal    = new Date().getTime();
  limiteTiempoCalculado = null; // Fuerza recalculación del límite dinámico

  try {
    const claves = Object.keys(CONFIG_MUNICIPIOS);
    let resumenMetricas = { correosBuscados: 0, procesados: 0, omitidos: 0 };
    let suspensionControlada = false;
    let municipioInterrumpido = null;

    for (let clave of claves) {
      // Verificación de tiempo ANTES de iniciar cada municipio
      if (haExcedidoTiempo()) {
        suspensionControlada = true;
        municipioInterrumpido = clave;
        break;
      }

      let metricasNode = procesarMunicipio(clave);
      resumenMetricas.correosBuscados += metricasNode.correosBuscados;
      resumenMetricas.procesados      += metricasNode.procesados;
      resumenMetricas.omitidos        += metricasNode.omitidos;

      // Verificación de tiempo DESPUÉS de cada municipio (por si se agotó adentro)
      if (metricasNode.limiteAlcanzado) {
        suspensionControlada  = true;
        municipioInterrumpido = clave;
        break;
      }
    }

    // Registro de auditoría en hoja de errores si hubo suspensión controlada
    if (suspensionControlada) {
      try {
        const ss          = SpreadsheetApp.getActiveSpreadsheet();
        const hojaErrores = ss.getSheetByName("⚠️ Errores_Cola") ||
                            ss.insertSheet("⚠️ Errores_Cola");
        const tiempoTranscurridoMin = Math.round((new Date().getTime() - tiempoInicioGlobal) / 60000);
        hojaErrores.appendRow([
          new Date(),
          "SUSPENSION_CONTROLADA_TIEMPO",
          municipioInterrumpido || "N/A",
          `El procesamiento fue interrumpido de forma controlada al alcanzar el umbral de seguridad (${tiempoTranscurridoMin} min). ` +
          `Los correos no procesados permanecen sin leer y serán retomados en la siguiente ejecución.`
        ]);
      } catch (errLog) {
        // No lanzamos el error de log: el procesamiento sí fue exitoso hasta donde llegó
        console.warn("No se pudo registrar la suspensión controlada en Errores_Cola:", errLog);
      }

      return {
        exito: true,
        mensaje: `⏱️ Procesamiento Parcial — Límite de Tiempo Alcanzado\n\n` +
                 `El sistema completó el procesamiento hasta el punto seguro establecido para su ` +
                 `licencia de Google Workspace.\n\n` +
                 `📧 Hilos analizados en esta ejecución: ${resumenMetricas.correosBuscados}\n` +
                 `✅ Facturas integradas con éxito: ${resumenMetricas.procesados}\n` +
                 `⚠️ Correos con incidencias: ${resumenMetricas.omitidos}\n\n` +
                 `ℹ️ Los correos no procesados permanecen sin leer en Gmail y serán retomados ` +
                 `automáticamente en la próxima ejecución. No se requiere ninguna acción adicional.`
      };
    }

    // Ejecución completa sin suspensión
    return {
      exito: true,
      mensaje: `✅ Consolidación Gmail Completada (v7.4):\n\n` +
               `📧 Total hilos analizados en bandeja: ${resumenMetricas.correosBuscados}\n` +
               `✅ Facturas integradas con éxito: ${resumenMetricas.procesados}\n` +
               `⚠️ Correos con incidencias/omitidos: ${resumenMetricas.omitidos}\n\n` +
               `Los detalles se guardaron en sus respectivas pestañas y en '⚠️ Errores_Cola'.`
    };

  } catch (error) {
    return { exito: false, mensaje: `Fallo Crítico en apiProcesarTodo: ${error.toString()}` };
  } finally {
    lock.releaseLock(); // Liberar bloqueo
  }
}

function apiProcesarMunicipio(claveMunicipio) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // Esperar hasta 30 segundos
  } catch (errLock) {
    return { exito: false, mensaje: "⚠️ El sistema está ocupado procesando otro lote de facturas. Por favor, intenta de nuevo en un momento." };
  }

  // Reinicio del cronómetro global para ejecuciones individuales por municipio
  tiempoInicioGlobal    = new Date().getTime();
  limiteTiempoCalculado = null; // Fuerza recalculación del límite dinámico

  try {
    // Validación de cautela preventiva en el diccionario global
    const claveLimpia = claveMunicipio.toUpperCase().trim();
    if (!CONFIG_MUNICIPIOS[claveLimpia]) {
      return { exito: false, mensaje: `El nodo de municipio "${claveMunicipio}" no está configurado.` };
    }

    const metricas = procesarMunicipio(claveLimpia);

    // Manejo de suspensión controlada en procesamiento individual
    if (metricas.limiteAlcanzado) {
      try {
        const ss          = SpreadsheetApp.getActiveSpreadsheet();
        const hojaErrores = ss.getSheetByName("⚠️ Errores_Cola") ||
                            ss.insertSheet("⚠️ Errores_Cola");
        const tiempoTranscurridoMin = Math.round((new Date().getTime() - tiempoInicioGlobal) / 60000);
        hojaErrores.appendRow([
          new Date(),
          "SUSPENSION_CONTROLADA_TIEMPO",
          claveLimpia,
          `Procesamiento individual de ${claveLimpia} interrumpido de forma controlada al alcanzar ` +
          `el umbral de seguridad (${tiempoTranscurridoMin} min). Correos pendientes retenidos como no leídos.`
        ]);
      } catch (errLog) {
        console.warn("No se pudo registrar la suspensión controlada en Errores_Cola:", errLog);
      }

      return {
        exito: true,
        mensaje: `⏱️ Procesamiento Parcial — ${claveLimpia} — Límite de Tiempo Alcanzado\n\n` +
                 `📧 Hilos analizados en esta ejecución: ${metricas.correosBuscados}\n` +
                 `✅ Procesados con éxito: ${metricas.procesados}\n` +
                 `⚠️ Errores/Omitidos: ${metricas.omitidos}\n\n` +
                 `ℹ️ Los correos restantes permanecen sin leer y serán retomados en la próxima ejecución.`
      };
    }

    // Ejecución completa del municipio
    return {
      exito: true,
      mensaje: `✅ Procesamiento Finalizado — ${claveLimpia}:\n\n` +
               `📧 Hilos analizados: ${metricas.correosBuscados}\n` +
               `✅ Procesados con éxito: ${metricas.procesados}\n` +
               `⚠️ Errores/Omitidos en cola: ${metricas.omitidos}`
    };

  } catch (error) {
    return { exito: false, mensaje: `Error al procesar ${claveMunicipio}: ${error.toString()}` };
  } finally {
    lock.releaseLock(); // Liberar bloqueo
  }
}


/**
 * MOTOR CENTRAL DE EXTRACCIÓN GMAIL
 * Ejecuta las consultas en la API de Gmail y valida la integridad del par XML/PDF
 */
function procesarMunicipio(clave) {
  const claveEstandar = clave.toUpperCase().trim();
  const config = CONFIG_MUNICIPIOS[claveEstandar];
  
  const libroCalculo = obtenerHojaCalculoEcosistema();
  const hojaDestino = obtenerOCrearHojaEnSpreadsheet(libroCalculo, config.hojaDestino);
  const hojaErrores = obtenerOCrearHojaEnSpreadsheet(libroCalculo, "⚠️ Errores_Cola");
  
  // Garantizar encabezados si la hoja contable es nueva
  const ultimaFilaInicial = hojaDestino.getLastRow();
  if (ultimaFilaInicial === 0) {
    hojaDestino.appendRow(ENCABEZADOS_ESTANDAR);
    hojaDestino.getRange(1, 1, 1, ENCABEZADOS_ESTANDAR.length).setFontWeight("bold").setBackground("#EAEEF3");
  }
  
  // Precarga de Caché en memoria (Set) de IDs y Hashes para optimizar el rendimiento (QA v7.5)
  const messageIdsExistentes = new Set();
  const hashesExistentes = new Set();
  if (ultimaFilaInicial > 1) {
    // Lectura de columna 16 (IDs Origen)
    const ids = hojaDestino.getRange(2, 16, ultimaFilaInicial - 1, 1).getValues();
    ids.forEach(r => { if (r[0] !== undefined && r[0] !== null) messageIdsExistentes.add(r[0].toString().trim()); });
    
    // Lectura de columna 17 (Hashes XML)
    const hashes = hojaDestino.getRange(2, 17, ultimaFilaInicial - 1, 1).getValues();
    hashes.forEach(r => { if (r[0] !== undefined && r[0] !== null) hashesExistentes.add(r[0].toString().trim()); });
  }
  
  // Construcción de la consulta query nativa de Gmail (Filtra solo correos no leídos)
  // v7.3: Corrección para etiquetas jerárquicas usando comillas de escape estructuradas
  let queryGmail = `label:"${config.label}" is:unread`;
  
  // v7.4: Lógica flexible de remitentes (por etiqueta sola, o filtrando también por correos provenientes)
  if (config.remitentesAprobados && config.remitentesAprobados.length > 0 && !config.remitentesAprobados.includes("*")) {
    const stringRemitentes = config.remitentesAprobados.join(" OR ");
    queryGmail += ` from:(${stringRemitentes})`;
  }
  
  const hilos = GmailApp.search(queryGmail);
  
  let contador = { correosBuscados: hilos.length, procesados: 0, omitidos: 0, limiteAlcanzado: false };
  
  for (let hilo of hilos) {
    if (haExcedidoTiempo()) {
      contador.limiteAlcanzado = true;
      break;
    }
    let mensajes = hilo.getMessages();
    
    for (let mensaje of mensajes) {
      if (haExcedidoTiempo()) {
        contador.limiteAlcanzado = true;
        break;
      }
      if (mensaje.isUnread()) {
        let messageId = mensaje.getId();
        
        // 1. Filtro estricto de seguridad contra duplicados en base de datos usando Set en memoria (QA v7.5)
        if (messageIdsExistentes.has(messageId.toString().trim())) {
          mensaje.markRead(); // Si ya existe, lo marcamos como leído y avanzamos para no generar basura
          continue;
        }
        
        let adjuntos = mensaje.getAttachments();
        let archivoXml = null;
        let archivoPdf = null;
        
        // 2. Clasificación e identificación del par de archivos obligatorios
        for (let adjunto of adjuntos) {
          let nombreMin = adjunto.getName().toLowerCase();
          if (nombreMin.endsWith('.xml')) archivoXml = adjunto;
          if (nombreMin.endsWith('.pdf')) archivoPdf = adjunto;
        }
        
        // 3. Validación de Estructura Corrupta (Eslabón roto en el correo)
        if (!archivoXml || !archivoPdf) {
          let detallesFalta = !archivoXml && !archivoPdf ? "XML y PDF ausentes" : (!archivoXml ? "Falta archivo XML" : "Falta archivo PDF");
          
          hojaErrores.appendRow([
            new Date(), 
            "ESTRUCTURA_CORRUPTA_GMAIL", 
            `Asunto: ${mensaje.getSubject()} | Remitente: ${mensaje.getFrom()}`, 
            `El correo electrónico no cumple con el par requerido. Detalle: ${detallesFalta}. Correo marcado como leído automáticamente.`
          ]);
          
          mensaje.markRead(); // Sacamos el correo de la cola para que no se trabe el sistema
          contador.omitidos++;
          continue;
        }
        
        // 4. Pasar los archivos validados al motor de Drive respetando la firma posicional v7.3 extendida con Caché (QA v7.5)
        try {
          // LLAMADA ULTRA-CAUTELOSA CON PARÁMETROS INDIVIDUALES:
          // Firma esperada: (pdfAttachment, xmlAttachment, municipioClave, messageId, fechaOrigen, asuntoOrigen, cacheMessageIds, cacheHashes)
          let exitoProcesamiento = inyectarArchivosAMotorContable(
            archivoPdf, 
            archivoXml, 
            claveEstandar, 
            messageId, 
            mensaje.getDate(), 
            mensaje.getSubject(),
            messageIdsExistentes,
            hashesExistentes
          );
          
          if (exitoProcesamiento) {
            mensaje.markRead(); // Éxito rotundo: se marca como leído de forma definitiva
            contador.procesados++;
          } else {
            contador.omitidos++;
          }
          
        } catch (errInyeccion) {
          hojaErrores.appendRow([new Date(), "ERROR_INYECCION_MOTOR", archivoXml.getName(), errInyeccion.toString()]);
          contador.omitidos++;
        }
      }
    }
  }
  
  return contador;
}

/**
 * HISTORIAL DE AUDITORÍA (Anti-Duplicados)
 * Revisa la Columna 2 ("ID del Correo / Origen") de la hoja destino
 */
function isMessageIdAlreadyLogged(sheet, messageId) {
  if (sheet.getLastRow() < 2) return false;
  // Lee únicamente la columna 16 para proteger el consumo de memoria RAM
  const idList = sheet.getRange(2, 16, sheet.getLastRow() - 1, 1).getValues();
  return idList.some(row => row[0] === messageId);
}

/**
 * UTILERÍA INTERNA: LOCALIZADOR DE SPREADSHEET
 * Garantiza la vinculación nativa al libro de cálculo activo
 */
function obtenerHojaCalculoEcosistema() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * UTILERÍA INTERNA: GESTOR DE PESTAÑAS
 * Busca la existencia de una pestaña o la crea bajo los estándares del sistema
 */
function obtenerOCrearHojaEnSpreadsheet(spreadsheet, nombreHoja) {
  let hoja = spreadsheet.getSheetByName(nombreHoja);
  if (!hoja) {
    hoja = spreadsheet.insertSheet(nombreHoja);
  }
  return hoja;
}