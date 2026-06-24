// =================================================================
// MODULO: CORE DRIVE (Orquestación, Almacenamiento e Integridad)
// =================================================================

/**
 * ORQUESTADOR CENTRAL DE ALMACENAMIENTO Y PROCESAMIENTO CFDI
 * Recibe los adjuntos de Gmail o de la carga local, detona los Parsers,
 * renombra bajo el patrón semántico inteligente v7.3, guarda en Drive e inserta en Sheets.
 * * @param {Blob} pdfAttachment - Archivo PDF del comprobante.
 * @param {Blob} xmlAttachment - Archivo XML del comprobante fiscal.
 * @param {string} municipioClave - Clave identificadora ("CANCUN", "PLAYA", "TULUM").
 * @param {string} messageId - Identificador único de trazabilidad (Gmail Message-ID o Local ID).
 * @param {Date} fechaOrigen - Fecha de recepción o creación del documento.
 * @param {string} asuntoOrigen - Asunto del correo o contexto de entrada.
 * @return {boolean} true si la transacción fue exitosa, false si requirió aislamiento de error.
 */
function inyectarArchivosAMotorContable(pdfAttachment, xmlAttachment, municipioClave, messageId, fechaOrigen, asuntoOrigen, cacheMessageIds = null, cacheHashes = null, cacheUuids = null) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaErrores = ss.getSheetByName("⚠️ Errores_Cola");
  
  // 1. Obtención de parámetros específicos del municipio desde 0_Config
  const config = CONFIG_MUNICIPIOS[municipioClave];
  if (!config) {
    if (hojaErrores) hojaErrores.appendRow([new Date(), "CONFIG_FALLIDA", asuntoOrigen, `No se encontró configuración para la clave: ${municipioClave}`]);
    return false;
  }

  const hojaDestino = ss.getSheetByName(config.hojaDestino);
  if (!hojaDestino) {
    if (hojaErrores) hojaErrores.appendRow([new Date(), "HOJA_NO_EXISTE", asuntoOrigen, `La hoja destino '${config.hojaDestino}' no está creada en el Spreadsheet.`]);
    return false;
  }

  try {
// 2. Ejecución de la Verdad Absoluta: Extracción desde el árbol XML nativo (v7.4 Polimórfica)
    let xmlTextoCrudo = "";
    try {
      // Si el objeto viene de Gmail, tiene el método nativo directamente
      if (typeof xmlAttachment.getDataAsString === 'function') {
        xmlTextoCrudo = xmlAttachment.getDataAsString();
      } else {
        // Si viene de Google Drive (Carga Local), extraemos primero su Blob
        xmlTextoCrudo = xmlAttachment.getBlob().getDataAsString();
      }
    } catch (errLecturaXml) {
      // Salvaguarda extrema en caso de fallos de codificación
      xmlTextoCrudo = xmlAttachment.getAs('text/xml').getDataAsString();
    }
    
    const metaXml = mapearMetadatosXml(xmlTextoCrudo);

    // =================================================================
    // VERIFICACIÓN PREVENTIVA DE DUPLICADOS (UUID Fiscal, Hash XML, Message-ID)
    // =================================================================
    const hashXml = obtenerHashXml(xmlTextoCrudo);
    const uuidXml = (metaXml.uuid && metaXml.uuid !== "N/A") ? metaXml.uuid.toString().trim().toLowerCase() : "";
    const colOffset = (municipioClave === "CANCUN") ? 1 : 0;

    let esDuplicado = false;

    // A. Verificar por Message-ID
    if (cacheMessageIds && messageId) {
      esDuplicado = cacheMessageIds.has(messageId.toString().trim());
    } else if (hojaDestino.getLastRow() > 1) {
      const idValues = hojaDestino.getRange(2, 16 + colOffset, hojaDestino.getLastRow() - 1, 1).getValues();
      esDuplicado = idValues.some(row => row[0] && row[0].toString().trim() === messageId.toString().trim());
    }

    // B. Verificar por Hash XML
    if (!esDuplicado) {
      if (cacheHashes) {
        esDuplicado = cacheHashes.has(hashXml);
      } else if (hojaDestino.getLastRow() > 1) {
        const hashValues = hojaDestino.getRange(2, 17 + colOffset, hojaDestino.getLastRow() - 1, 1).getValues();
        esDuplicado = hashValues.some(row => row[0] === hashXml);
      }
    }

    // C. Verificar por UUID Fiscal (Col 5)
    if (!esDuplicado && uuidXml && uuidXml !== "n/a") {
      if (cacheUuids) {
        esDuplicado = cacheUuids.has(uuidXml);
      } else if (hojaDestino.getLastRow() > 1) {
        const uuidValues = hojaDestino.getRange(2, 5, hojaDestino.getLastRow() - 1, 1).getValues();
        esDuplicado = uuidValues.some(row => row[0] && row[0].toString().trim().toLowerCase() === uuidXml);
      }
    }

    if (esDuplicado) {
      // Registrar en la hoja de errores
      if (hojaErrores) {
        hojaErrores.appendRow([
          new Date(),
          "DUPLICADO_IGNORADO",
          asuntoOrigen,
          `Factura duplicada detectada (UUID: ${uuidXml || "N/A"} | Hash: ${hashXml}). Se ignora el almacenamiento y registro.`
        ]);
      }
      // Mover a la papelera los archivos origen si son objetos File de Drive (Carga Local)
      try {
        if (pdfAttachment && typeof pdfAttachment.setTrashed === 'function') {
          pdfAttachment.setTrashed(true);
        }
        if (xmlAttachment && typeof xmlAttachment.setTrashed === 'function') {
          xmlAttachment.setTrashed(true);
        }
      } catch (e) {
        if (hojaErrores) {
          hojaErrores.appendRow([new Date(), "TRASH_ERROR", asuntoOrigen, e.toString()]);
        }
      }
      return true; // Considerado exitoso pero sin nueva inserción
    }

    // 3. Ejecución del Canal Secundario: OCR e Inteligencia del PDF
    const pdfTextoCrudo = extraerTextoDelPdfConOCR(pdfAttachment, hojaErrores);
    const metaPdf = analizarTextoPdfInversivo(pdfTextoCrudo, municipioClave);

    // 4. Mecanismo de Fallback y Resolución de Variables Cruzadas
    const totalFinal        = (metaXml.total !== "N/A") ? metaXml.total : metaPdf.total;
    const folioFinal        = (metaXml.folio !== "N/A") ? metaXml.folio : metaPdf.folio;
    const claveCatastralFinal = (metaPdf.claveCatastral !== "N/A") ? metaPdf.claveCatastral : "N/A";
    const fechaLimiteFinal  = (metaPdf.fechaLimitePago !== "N/A") ? metaPdf.fechaLimitePago : "N/A";
    const referenciaFinal   = (metaPdf.referenciaCliente !== "N/A") ? metaPdf.referenciaCliente : "N/A";
    const padronFinal       = (metaXml.padron !== "N/A") ? metaXml.padron : ((metaPdf.padron !== "N/A") ? metaPdf.padron : "N/A");

    // Estrategia Jerárquica para la Descripción (XML manda, PDF respalda)
    let descripcionFinal = "N/A";
    if (metaXml.descripcionXml !== "N/A" && metaXml.descripcionXml.trim() !== "") {
      descripcionFinal = metaXml.descripcionXml;
    } else if (metaPdf.descripcionPdf !== "N/A" && metaPdf.descripcionPdf.trim() !== "") {
      descripcionFinal = metaPdf.descripcionPdf;
    }

    // 5. Auditoría Interna: Conciliación Cuadrática de Montos
    let flagAlertaMonto = false;
    if (metaXml.total !== "N/A" && metaPdf.total !== "N/A") {
      const numXml = parseFloat(metaXml.total.replace(/,/g, ''));
      const numPdf = parseFloat(metaPdf.total.replace(/,/g, ''));
      if (Math.abs(numXml - numPdf) > 0.05) { // Tolerancia máxima de 5 centavos por redondeos fiscales
        flagAlertaMonto = true;
      }
    }

    // 6. Localización o Creación Estructurada de Carpetas Cronológicas en Drive
    const carpetaContenedora = obtenerOCrearCarpeta(CARPETA_CONTENEDORA_PRINCIPAL);
    const carpetaRaizDescarga = obtenerOCrearCarpeta(NOMBRE_CARPETA_RAIZ, carpetaContenedora);
    const carpetaMunicipio    = obtenerOCrearCarpeta(config.nombreCarpeta, carpetaRaizDescarga);

    // Desglose cronológico basado en la fecha oficial del XML (Fallback a fecha del correo)
    // v7.5: Estructura Año / Mes-Abreviado (3 letras) / Día numérico
    let fechaParaArbol = fechaOrigen;
    let anioStr, mesStr, diaStr;
    if (metaXml.fechaExpedicion !== "N/A") {
      // Extrae año (AAAA), mes (MM) y día (DD) del formato ISO AAAA-MM-DD
      const matchIso = metaXml.fechaExpedicion.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (matchIso) {
        anioStr = matchIso[1];
        mesStr  = MESES_ABREVIADOS[parseInt(matchIso[2], 10) - 1]; // 0-indexed: "01" → "ene"
        diaStr  = matchIso[3];                                      // Ej: "05"
      }
    }
    
    // Fallback: si el XML no tiene fecha válida, se usa la fecha de origen del correo/archivo
    if (!anioStr || !mesStr || !diaStr) {
      anioStr = Utilities.formatDate(fechaParaArbol, Session.getScriptTimeZone(), "yyyy");
      mesStr  = MESES_ABREVIADOS[parseInt(Utilities.formatDate(fechaParaArbol, Session.getScriptTimeZone(), "MM"), 10) - 1];
      diaStr  = Utilities.formatDate(fechaParaArbol, Session.getScriptTimeZone(), "dd");
    }

    const carpetaAnio = obtenerOCrearCarpeta(anioStr, carpetaMunicipio);
    const carpetaMes  = obtenerOCrearCarpeta(mesStr, carpetaAnio);
    const carpetaDia  = obtenerOCrearCarpeta(diaStr, carpetaMes);   // Nivel de día: "01", "02"...


    // =================================================================
    // ALGORITMO DE RENOMBRADO INTELIGENTE Y COMPACTO (v7.3)
    // =================================================================
    
    // Lineamiento 1: RFC Emisor corto (Primeros 3 caracteres normalizados)
    let rfcCorto = (metaXml.rfcEmisor !== "N/A") ? metaXml.rfcEmisor.substring(0, 3).toUpperCase() : "INV";
    if (rfcCorto === "MS0") rfcCorto = "MSO"; // Normalización semántica de cero a letra 'O'

    // Lineamiento 2: Búsqueda Semántica en el Catálogo Controlado de Configuración
    let palabraClaveDestino = RESPALDO_CONCEPTO_RENOMBRADO;
    let descParaAnalisis   = descripcionFinal.toUpperCase();
    
    for (let i = 0; i < CATALOGO_PALABRAS_RENOMBRADO.length; i++) {
      let palabraCatalogo = CATALOGO_PALABRAS_RENOMBRADO[i].toUpperCase();
      // Remover acentos de forma exhaustiva para blindar la compatibilidad de caracteres de Drive
      let palabraLimpia = palabraCatalogo.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      let descLimpia    = descParaAnalisis.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      
      if (descLimpia.includes(palabraLimpia)) {
        palabraClaveDestino = palabraLimpia;
        break; // Conserva la primera coincidencia de izquierda a derecha (Criterio de prioridad)
      }
    }

    // Lineamiento 3: Folio Comercial Sanitizado
    let folioLimpio = (folioFinal !== "N/A") ? folioFinal.replace(/[^a-zA-Z0-9-]/g, "") : "SF";

    // Ensamblaje del Patrón Deseado corporativo
    let nombreBaseEstandar = `${rfcCorto}_${palabraClaveDestino}_${folioLimpio}`;
    let nombrePdfFinal = `${nombreBaseEstandar}.pdf`;
    let nombreXmlFinal = `${nombreBaseEstandar}.xml`;

    // CRÍTICA CLÁUSULA DE CAUTELA: Verificación dinámica de colisiones de nombres (Anti-Duplicados)
    // v7.5: La verificación se realiza ahora contra la carpetaDia (destino final)
    let contadorDuplicados = 1;
    while (carpetaDia.getFilesByName(nombrePdfFinal).hasNext()) {
      nombrePdfFinal = `${nombreBaseEstandar}_(${contadorDuplicados}).pdf`;
      nombreXmlFinal = `${nombreBaseEstandar}_(${contadorDuplicados}).xml`;
      contadorDuplicados++;
    }

// === ALMACENAMIENTO DE ARCHIVOS EN DRIVE CON PREVENCIÓN DE DUPLICADOS (v7.6) ===
    let pdfGuardado, xmlGuardado;
    
    // Extracción segura del Blob sin importar si viene de Gmail (Attachment) o Drive (File)
    const blobPdfSeguro = (typeof pdfAttachment.copyBlob === 'function') ? pdfAttachment.copyBlob() : pdfAttachment.getBlob();
    const blobXmlSeguro = (typeof xmlAttachment.copyBlob === 'function') ? xmlAttachment.copyBlob() : xmlAttachment.getBlob();

    // Guardado físico y seguro del PDF en la carpetaDia (destino final) con control de excepciones
    try {
      pdfGuardado = carpetaDia.createFile(blobPdfSeguro);
      pdfGuardado.setName(nombrePdfFinal);
    } catch(e) {
      pdfGuardado = carpetaDia.createFile(blobPdfSeguro);
      pdfGuardado.setName(`ERR_PDF_${new Date().getTime()}_${nombrePdfFinal}`);
    }

    // Guardado físico y seguro del XML en la carpetaDia (destino final) con control de excepciones
    try {
      xmlGuardado = carpetaDia.createFile(blobXmlSeguro);
      xmlGuardado.setName(nombreXmlFinal);
    } catch(e) {
      xmlGuardado = carpetaDia.createFile(blobXmlSeguro);
      xmlGuardado.setName(`ERR_XML_${new Date().getTime()}_${nombreXmlFinal}`);
    }

    // =================================================================
    // ESCRITURA TRANSACCIONAL EN LA BASE DE DATOS (SHEETS - 21 Columnas)
    // =================================================================
    
    // (Nota: HashXML y colOffset ya fueron calculados preventivamente en la validación temprana)

    // Inyección de cabeceras de control si la pestaña está vacía
    const encabezados = obtenerEncabezadosPorMunicipio(municipioClave);
    if (hojaDestino.getLastRow() === 0) {
      hojaDestino.appendRow(encabezados);
      hojaDestino.getRange(1, 1, 1, encabezados.length).setFontWeight("bold").setBackground("#EAEEF3");
    }

    const filaDatos = [
      metaXml.fechaExpedicion,                      // Col 1: Fecha Emisión XML
      metaXml.emisor,                               // Col 2: Nombre Emisor
      metaXml.receptor,                             // Col 3: Nombre Receptor
      folioFinal,                                   // Col 4: Serie-Folio
      metaXml.uuid,                                 // Col 5: UUID Fiscal
      metaXml.formaPago,                            // Col 6: Forma de Pago
      totalFinal,                                   // Col 7: Total Facturado
      (claveCatastralFinal !== "N/A" && claveCatastralFinal !== "") ? "'" + claveCatastralFinal : "N/A", // Col 8: Clave Catastral (Forzado a Texto)
      descripcionFinal,                             // Col 9: Descripción Limpia Concatenada
      fechaLimiteFinal,                             // Col 10: Fecha Límite Pago (PDF)
      referenciaFinal,                              // Col 11: Referencia Bancaria (PDF)
    ];

    if (municipioClave === "CANCUN") {
      filaDatos.push(padronFinal);                 // Col 12: Padrón (Cancún)
    }

    filaDatos.push(
      pdfGuardado.getName(),                        // Nombre Archivo PDF
      pdfGuardado.getUrl(),                         // Enlace PDF
      xmlGuardado.getUrl(),                         // Enlace XML
      new Date(),                                   // Fecha Procesamiento (Oculta)
      messageId,                                    // ID Origen (Oculta)
      hashXml                                       // Hash XML (Oculta)
    );

    hojaDestino.appendRow(filaDatos);
    const ultimaFila = hojaDestino.getLastRow();

    // Si la transacción fue exitosa, agregamos al caché en memoria para evitar duplicados en el mismo lote (QA v7.5)
    if (cacheHashes) cacheHashes.add(hashXml);
    if (cacheMessageIds) cacheMessageIds.add(messageId.toString().trim());
    if (cacheUuids && uuidXml) cacheUuids.add(uuidXml);

    // Formateo de seguridad visual en caso de discrepancia contable detectada
    if (flagAlertaMonto) {
      const colTotalIndex = encabezados.indexOf("Total Facturado") + 1;
      const colAlerta = colTotalIndex > 0 ? colTotalIndex : 7;
      hojaDestino.getRange(ultimaFila, colAlerta).setBackground("#FADBD8"); // Alerta color rojo/coral suave únicamente en la celda del Total
      if (hojaErrores) {
        hojaErrores.appendRow([new Date(), "ALERTA_MONTO", folioFinal, `Discrepancia detectada en fila ${ultimaFila} de ${config.hojaDestino}. XML: ${metaXml.total} vs PDF: ${metaPdf.total}`]);
      }
    }

    return true; // Transacción cerrada con éxito absoluto

  } catch (errFatal) {
    // Captura preventiva de desbordamiento de memoria o errores no previstos
    if (hojaErrores) {
      hojaErrores.appendRow([new Date(), "FATAL_MOTOR_DRIVE", messageId, errFatal.toString() + " | Stack: " + errFatal.stack]);
    }
    return false;
  }
}