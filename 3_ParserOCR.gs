// =================================================================
// MODULO: PARSER & OCR (Procesamiento de Datos e Inteligencia Textual)
// =================================================================

/**
 * PARSER SINOPSIS XML (CFDI 4.0 / 3.3)
 * Convierte el texto XML crudo en un objeto JSON con un mapeo exacto de datos.
 * Versión v7.1: Incluye la extracción e indexación nativa de conceptos por comas.
 * * @param {string} xmlString - El contenido de texto bruto del archivo XML fiscal.
 * @return {Object} Objeto estructurado con los metadatos y conceptos de la factura.
 */
function mapearMetadatosXml(xmlString) {
  let meta = {
    rfcEmisor: "N/A", emisor: "N/A", rfcReceptor: "N/A", receptor: "N/A",
    total: "N/A", fechaExpedicion: "N/A", formaPago: "N/A", metodoPago: "N/A",
    usoCfdi: "N/A", folio: "N/A", uuid: "N/A", descripcionXml: "N/A"
  };
  
  if (!xmlString) return meta;

  // Extracción rápida del UUID mediante RegEx por seguridad en la consistencia de datos
  const matchUuid = xmlString.match(/UUID="([A-Fa-f0-9-]{36})"/i);
  if (matchUuid) meta.uuid = matchUuid[1].toLowerCase();

  try {
    const doc  = XmlService.parse(xmlString);
    const root = doc.getRootElement();
    const ns   = root.getNamespace();
    
    // Helper inline para leer atributos raíz de forma segura
    const attr = (name) => { const a = root.getAttribute(name); return a ? a.getValue() : "N/A"; };

    meta.total           = attr('Total');
    meta.fechaExpedicion = attr('Fecha');
    meta.metodoPago      = attr('MetodoPago');
    meta.usoCfdi         = attr('UsoCFDI');

    // Construcción inteligente de la Serie-Folio comercial
    const serie = root.getAttribute('Serie') ? root.getAttribute('Serie').getValue() : "";
    const folio = root.getAttribute('Folio') ? root.getAttribute('Folio').getValue() : "";
    meta.folio  = serie ? `${serie}-${folio}` : (folio || "N/A");

    // Homologación de la forma de pago basada en el catálogo global de 0_Config
    const cFormaPago = root.getAttribute('FormaPago') ? root.getAttribute('FormaPago').getValue() : "";
    meta.formaPago   = FORMAS_DE_PAGO_CATALOG[cFormaPago]
      ? `${cFormaPago} - ${FORMAS_DE_PAGO_CATALOG[cFormaPago]}`
      : (cFormaPago || "N/A");

    // Extracción segura del nodo Emisor
    const emisorEl = root.getChild('Emisor', ns);
    if (emisorEl) {
      meta.rfcEmisor = emisorEl.getAttribute('Rfc')    ? emisorEl.getAttribute('Rfc').getValue()    : "N/A";
      meta.emisor    = emisorEl.getAttribute('Nombre') ? emisorEl.getAttribute('Nombre').getValue() : "N/A";
    }

    // Extracción segura del nodo Receptor
    const receptorEl = root.getChild('Receptor', ns);
    if (receptorEl) {
      meta.rfcReceptor = receptorEl.getAttribute('Rfc')    ? receptorEl.getAttribute('Rfc').getValue()    : "N/A";
      meta.receptor    = receptorEl.getAttribute('Nombre') ? receptorEl.getAttribute('Nombre').getValue() : "N/A";
    }

// === EXTRACCIÓN EXACTA DE CONCEPTOS DESDE EL XML (v7.2 - Con Inteligencia Anti-Basura) ===
    const conceptosParent = root.getChild('Conceptos', ns);
    if (conceptosParent) {
      const listaConceptos = conceptosParent.getChildren('Concepto', ns);
      if (listaConceptos && listaConceptos.length > 0) {
        // Recorre cada partida, limpia códigos numéricos iniciales y espacios redundantes
        meta.descripcionXml = listaConceptos.map(nodo => {
          let desc = nodo.getAttribute('Descripcion') ? nodo.getAttribute('Descripcion').getValue() : "";
          
          // APLICA INTELIGENCIA: Remueve los 10 dígitos iniciales y espacios, o patrones como "[4306030006]"
          return desc.replace(/^\d{10}\s*/, "")      // Quita "4306030006 " al inicio
                     .replace(/^\[\d+\]\s*/i, "")   // Quita "[4306030006] " si viniera entre corchetes
                     .trim()
                     .toUpperCase();
        }).join(', '); // Los concatena de forma limpia separados por comas
      }
    }
  } catch (e) {
    // Fallback de contingencia: si el parseo estricto del árbol XML falla, se conserva lo rescatado por el UUID
  }

  return meta;
}

/**
 * LECTOR ÓPTICO DE CARACTERES (Nativo Google Drive API v3)
 * Envía el PDF de forma síncrona a la API de Drive con la bandera de indexación OCR encendida.
 * Genera un archivo de texto volátil y lo destruye inmediatamente en la cláusula 'finally'.
 * * @param {Blob} pdfAttachment - Archivo PDF adjunto extraído de Gmail.
 * @param {Sheet} hojaErrores - Referencia de la hoja de cálculo para logs de contingencia.
 * @return {string|null} Todo el texto en bruto recuperado del PDF, o null si falla.
 */
function extraerTextoDelPdfConOCR(pdfAttachment, hojaErrores) {
  if (!pdfAttachment) return null;
  let ocrDocId = null;
  
  try {
    let blob;
    if (typeof pdfAttachment.getBlob === 'function') {
      blob = pdfAttachment.getBlob();
    } else if (typeof pdfAttachment.copyBlob === 'function') {
      blob = pdfAttachment.copyBlob();
    } else {
      blob = pdfAttachment; // Asumir que ya es un Blob
    }
    
    const nombreArchivo = (blob && typeof blob.getName === 'function') ? blob.getName() : "archivo.pdf";
    const token    = ScriptApp.getOAuthToken();
    const boundary = "FormBoundary" + Utilities.getUuid().replace(/-/g, "");

    const metadataJson = JSON.stringify({
      name    : `OCR_TMP_${nombreArchivo}`,
      mimeType: "application/vnd.google-apps.document"
    });

    const enc        = (s) => Utilities.newBlob(s).getBytes();
    const metaPart   = enc(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n`);
    const fileHeader = enc(`--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`);
    const closing    = enc(`\r\n--${boundary}--`);
    
    const bodyBytes  = metaPart.concat(fileHeader).concat(blob.getBytes()).concat(closing);

    // Llamada HTTP Multipart a los servidores de Google Workspace Drive API v3
    const response = UrlFetchApp.fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocr=true&ocrLanguage=es",
      {
        method            : "POST",
        contentType       : `multipart/form-data; boundary=${boundary}`,
        headers           : { Authorization: "Bearer " + token },
        payload           : Utilities.newBlob(bodyBytes).getBytes(),
        muteHttpExceptions: true
      }
    );

    if (response.getResponseCode() !== 200) {
      const msg = `HTTP ${response.getResponseCode()}: ${response.getContentText().substring(0, 300)}`;
      if (hojaErrores) hojaErrores.appendRow([new Date(), "OCR_HTTP_ERROR", pdfAttachment.getName(), msg]);
      return null;
    }

    const fileData = JSON.parse(response.getContentText());
    ocrDocId = fileData.id;
    if (!ocrDocId) return null;

    // Pausa técnica de estabilización para asegurar que el motor de Drive terminó de volcar el texto (QA v7.5)
    Utilities.sleep(1500); 
    
    let doc = null;
    let intentos = 0;
    while (intentos < 3) {
      try {
        doc = DocumentApp.openById(ocrDocId);
        break; // Abre con éxito
      } catch (errOpen) {
        intentos++;
        if (intentos === 3) throw errOpen; // Excedió reintentos
        Utilities.sleep(1000 * intentos); // Pausa incremental (1s, 2s)
      }
    }
    
    return doc.getBody().getText();
    
  } catch (e) {
    if (hojaErrores) hojaErrores.appendRow([new Date(), "OCR_EXCEPCION", pdfAttachment.getName(), e.toString()]);
    return null;
  } finally {
    // CLÁUSULA DE HIGIENE: Destrucción absoluta del archivo temporal para evitar basura en el Drive del usuario
    if (ocrDocId) {
      try {
        UrlFetchApp.fetch(
          `https://www.googleapis.com/drive/v3/files/${ocrDocId}`,
          {
            method            : "DELETE",
            headers           : { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
            muteHttpExceptions: true
          }
        );
      } catch (cleanupErr) {}
    }
  }
}

/**
 * ANALIZADOR INVERSIVO DE TEXTO (RegEx Engine)
 * Inspecciona el string crudo arrojado por el OCR buscando los patrones y anclas comerciales.
 * Versión v7.1: Calibrado con patrones planos para tablas de conceptos municipales.
 * * @param {string} textoPdf - Texto plano recuperado del proceso de OCR.
 * @return {Object} Objeto con las extracciones mapeadas de forma individual.
 */
function analizarTextoPdfInversivo(textoPdf, municipioClave = null) {
  let datos = { folio: "N/A", total: "N/A", claveCatastral: "N/A", fechaLimitePago: "N/A", referenciaCliente: "N/A", descripcionPdf: "N/A" };
  if (!textoPdf) return datos;

  // 1. Extracción de Folio/Factura Comercial [cite: 28]
  const matchFolio = textoPdf.match(/(?:Folio|Factura\s*No\.?|Serie-Folio|No\.\s*Factura)\s*[:\s]?\s*([A-Z0-9][A-Z0-9-]{0,20})/i);
  if (matchFolio && matchFolio[1]) datos.folio = matchFolio[1].trim();

  // 2. Extracción del Total Líquido Facturado [cite: 36]
  const matchTotal = textoPdf.match(/(?:Total|Importe\s*Total|Neto\s*a\s*Pagar)\s*[:\$]?\s*([\d,]+\.\d{2})/i);
  if (matchTotal && matchTotal[1]) datos.total = matchTotal[1].replace(/,/g, '');

    // 3. Extracción de la Clave Catastral del Inmueble (QA v8.12 - Bucle de Validación de Candidatos para evitar falsos positivos)
    let posibleClave = null;
    
    // Intento 1: Buscar por etiquetas indicadoras (Clave Catastral, C.C., etc.)
    const regexCatastral = /(?:Clave\s*Catastral|Reg\.\s*Catastral|C\.?\s*C\.?|Catastro|NÚMERO\s*CATASTRAL|Clave\s*Inmueble)\s*[:\-\.\s]*\s*([a-z0-9\-]{15,22}|[\d ]{15,25})/gi;
    let matchEtiqueta;
    while ((matchEtiqueta = regexCatastral.exec(textoPdf)) !== null) {
      const candidate = matchEtiqueta[1].trim().replace(/\s+/g, '');
      if (esClaveCatastralValida(candidate)) {
        posibleClave = candidate;
        break;
      }
    }
    
    // Intento 2: Caída Estructural Segura - Cancún (con escaneo de bloques alfanuméricos para tolerar fallas de espacios de OCR)
    if (!posibleClave) {
      let textoCancun = textoPdf;
      const idxObs = textoPdf.toLowerCase().search(/observaci\u00f3n|observacion|observaciones/i);
      if (idxObs !== -1) {
        textoCancun = textoPdf.substring(idxObs);
      }
      
      const blocks = textoCancun.match(/[A-Z0-9]+/gi) || textoPdf.match(/[A-Z0-9]+/gi);
      if (blocks) {
        for (let block of blocks) {
          const cleanBlock = block.trim().toUpperCase();
          
          if (cleanBlock.length >= 17 && cleanBlock.length <= 18) {
            if (esClaveCatastralValida(cleanBlock)) {
              posibleClave = cleanBlock;
              break;
            }
          } else if (cleanBlock.length > 18 && cleanBlock.length < 40) {
            // Si el OCR unió números por falta de espacios, probar sub-cadenas de 17 y 18 caracteres
            for (let len = 17; len <= 18; len++) {
              for (let start = 0; start <= cleanBlock.length - len; start++) {
                const subStr = cleanBlock.substring(start, start + len);
                if (esClaveCatastralValida(subStr)) {
                  posibleClave = subStr;
                  break;
                }
              }
              if (posibleClave) break;
            }
            if (posibleClave) break;
          }
        }
      }
    }
    
    // Intento 3: Caída Estructural Segura - Playa/Tulum (15 dígitos base que no inician con 0, con guión y sufijo opcional)
    if (!posibleClave) {
      const matchesPlaya = textoPdf.match(/\b[1-9]\d{14}(?:-\d{1,3})?\b/g);
      if (matchesPlaya) {
        for (let m of matchesPlaya) {
          const candidate = m.trim().replace(/\s+/g, '');
          if (esClaveCatastralValida(candidate)) {
            posibleClave = candidate;
            break;
          }
        }
      }
    }
    
    // Intento 4: Expresión estructural general con guiones obligatorios
    if (!posibleClave) {
      const matchesEstructural = textoPdf.match(/\b(\d{3,}-\d{2,}-\d{2,}-\d{3,})\b/g) || textoPdf.match(/\b(\d{9,}-\d{2,})\b/g);
      if (matchesEstructural) {
        for (let m of matchesEstructural) {
          const candidate = m.trim().replace(/\s+/g, '');
          if (esClaveCatastralValida(candidate)) {
            posibleClave = candidate;
            break;
          }
        }
      }
    }
    
    // Guardar el resultado validado
    if (posibleClave) {
      datos.claveCatastral = posibleClave;
    } else {
      datos.claveCatastral = "N/A";
    }

  // 4. Extracción de Fecha Límite de Vencimiento / Pago
  // QA v8.7: Soportar "Fecha límite de pago" con posibles saltos de línea intermedios
  const matchFechaLimite = textoPdf.match(/(?:Fecha\s*l\u00edmite\s*de\s*pago|L\u00edmite\s*de\s*Pago|P\u00e1guese\s*antes\s*del|Fecha\s*Vencimiento|Vence\s*el)\s*[:\-\.\s]*\s*([\d]{2}[-\/][\d]{2}[-\/][\d]{4}|[\d]{4}[-\/][\d]{2}[-\/][\d]{2}|[\d]{2}\s*de\s*[a-zA-Z]+\s*de\s*[\d]{4})/i);
  if (matchFechaLimite && matchFechaLimite[1]) datos.fechaLimitePago = matchFechaLimite[1].trim();

  // 5. Extracción de Referencia Bancaria o de Captura
  // QA v8.7: Reglas dinámicas por municipio para Cancún y Playa/Tulum
  const muniLimpio = municipioClave ? municipioClave.toString().toUpperCase().trim() : "";
  
  if (muniLimpio === "CANCUN") {
    // Exclusivo Cancún: Buscar identificador de Recibo de Pago relacionado
    const matchRecibo = textoPdf.match(/(?:RECIBO\s*DE\s*PAGO)\s*[:\-\.\s]*\s*([A-Z0-9\-]+)/i);
    if (matchRecibo && matchRecibo[1]) {
      datos.referenciaCliente = matchRecibo[1].trim();
    }
  } else if (muniLimpio === "PLAYA" || muniLimpio === "TULUM") {
    // Exclusivo Playa/Tulum: Buscar "Referencia del cliente" e ignorar saltos de línea/espacios intermedios
    const idx = textoPdf.toLowerCase().indexOf("referencia del cliente");
    if (idx !== -1) {
      const sub = textoPdf.substring(idx + "referencia del cliente".length, idx + "referencia del cliente".length + 60);
      const subLimpio = sub.replace(/[\s\r\n]+/g, '');
      const matchPlayaRef = subLimpio.match(/^(?:[:\-\.\s]*)(?:\d{8}-)?([A-Z]+)-?(\d+)/i);
      if (matchPlayaRef && matchPlayaRef[1] && matchPlayaRef[2]) {
        datos.referenciaCliente = matchPlayaRef[1].toUpperCase() + "-" + matchPlayaRef[2];
      }
    }
  }
  
  // Fallback de contingencia si no se cumplió la regla específica o no se pasó municipio
  if (datos.referenciaCliente === "N/A" || !datos.referenciaCliente) {
    const matchRef = textoPdf.match(/(?:Referencia|L\u00ednea\s*de\s*Captura|Ref\.\s*Bancaria)\s*[:\s]?\s*([0-9A-Z\s-]{10,30})/i);
    if (matchRef && matchRef[1]) datos.referenciaCliente = matchRef[1].replace(/\s+/g, '').trim();
  }

// 6. CORRECCIÓN EXCLUSIVA PARA EL DETALLE DE CONCEPTOS DEL PDF (v7.2 - Con Inteligencia Anti-Basura)
  // Busca cadenas de texto en mayúsculas que se sitúen justo después de códigos contables municipales
  const regexConceptosPlanos = /\b\d{10}\s+(?:\[\d{10}\]\s+)?([A-Z\s]{4,100})(?=\s+\d{8}|\s+\d+\.\d{3})/g;
  let conceptosEncontrados = [];
  let iterador = [...textoPdf.matchAll(regexConceptosPlanos)];
  
  if (iterador.length > 0) {
    conceptosEncontrados = iterador.map(m => {
      let descPdf = m[1].replace(/\s+/g, ' ').trim();
      // Aplica la misma inteligencia para asegurar que no se arrastren números remanentes
      return descPdf.replace(/^\d{10}\s*/, "").toUpperCase();
    });
    datos.descripcionPdf = conceptosEncontrados.join(', ');
  } else {
    // Plan de rescate secundario: Captura las descripciones libres y les remueve códigos de 10 dígitos si existen
    const matchComentarios = textoPdf.match(/(?:Comentarios\s*Adicionales|Observaciones|Descripción|Concepto)\s*\n?([A-Z\s,]{4,100})/i);
    if (matchComentarios && matchComentarios[1]) {
      datos.descripcionPdf = matchComentarios[1].replace(/\s+/g, ' ')
                                               .replace(/\b\d{10}\s*/g, "") // Remueve códigos de 10 dígitos en cualquier parte del fallback
                                               .trim()
                                               .toUpperCase();
    }
  }

  return datos;
}